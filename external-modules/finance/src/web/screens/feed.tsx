// external-modules/finance/src/web/screens/feed.tsx
// FIN-02 (#1147) Task 11: the transaction feed — the module's single screen.
// One read (finance.transactions.query is the one-call feed: transactions +
// categories + accounts); every write rides a manual-run queue (D4): inline
// recategorize → finance.categorize-apply with the four identifier ids only
// (D6), "Sync now" → finance.sync-run, "Finish connecting" →
// finance.connect-poll with a caller-driven 30s re-poll (D2). Queue runs are
// fire-and-forget 202s, so mutations pair an optimistic local override with a
// delayed invalidate-and-refetch; the connect loop's stop signal is the
// refetched account set changing (no read tool exposes link sessions — the
// worker marks them completed/abandoned server-side).
import { runQueue, type RunOutcome } from "../api";
import { currentMonth, dayLabel, formatCents, monthLabel, shiftMonth } from "../format";
import { h, useEffect, useRef, useState, type ReactNodeLike } from "../runtime";
import { announce, EmptyState, outcomeGate } from "../states";
import { invalidateQueries, useToolQuery } from "../store";
import type { HostActions } from "../root";

interface FeedAccount {
  accountId: string;
  name: string;
  mask: string | null;
  balanceCents: number;
  isoCurrency: string;
  itemStatus: string;
  updatedAt: string;
}

interface FeedCategory {
  id: string;
  name: string;
  archived?: boolean;
}

interface FeedTransaction {
  id: string;
  accountId: string;
  date: string;
  amountCents: number;
  isoCurrency: string;
  name: string;
  merchant: string | null;
  categoryId: string | null;
  pending: boolean;
}

interface FeedResult extends Record<string, unknown> {
  month: string;
  transactions?: FeedTransaction[];
  categories?: FeedCategory[];
  accounts?: FeedAccount[];
}

const REFETCH_DELAY_MS = 2000;
const POLL_INTERVAL_MS = 30_000;
// 10 rounds ≈ 5 minutes; the worker abandons link sessions at 30 min, so a
// stuck loop parks with guidance well before that.
const POLL_MAX_ROUNDS = 10;

function afterRun(outcome: RunOutcome, queuedMessage: string): void {
  if (outcome.kind === "queued" || outcome.kind === "already-queued") {
    announce(queuedMessage);
    setTimeout(() => invalidateQueries(), REFETCH_DELAY_MS);
  } else if (outcome.kind === "disabled") {
    announce("Finance is turned off on the server.");
  } else {
    announce(`Request failed: ${outcome.message}`);
  }
}

const STATUS_BADGE: Record<string, { label: string; className: string }> = {
  connected: { label: "Connected", className: "jds-badge jds-badge--forest" },
  "reauth-required": { label: "Needs re-auth", className: "jds-badge jds-badge--amber" },
  error: { label: "Connection error", className: "jds-badge jds-badge--amber" }
};

function AccountPill(props: { account: FeedAccount; key?: string }): ReactNodeLike {
  const badge = STATUS_BADGE[props.account.itemStatus] ?? STATUS_BADGE.error;
  return (
    <span className="jds-card jds-card--flush fnm-pill">
      <span>
        {props.account.mask ? `${props.account.name} ··${props.account.mask}` : props.account.name}
      </span>
      <span className="fnm-amount">
        {formatCents(props.account.balanceCents, props.account.isoCurrency)}
      </span>
      <span className={badge.className}>{badge.label}</span>
    </span>
  );
}

function TransactionRow(props: {
  record: FeedTransaction;
  month: string;
  categories: FeedCategory[];
  overrideCategoryId?: string;
  onRecategorize: (record: FeedTransaction, categoryId: string) => void;
  key?: string;
}): ReactNodeLike {
  const record = props.record;
  const categoryId = props.overrideCategoryId ?? record.categoryId;
  const category = props.categories.find((entry) => entry.id === categoryId);
  return (
    <li className="fnm-txrow">
      <div className="fnm-txmain">
        <span>{record.name}</span>
        {record.merchant && record.merchant !== record.name ? (
          <span className="jds-eyebrow">{record.merchant}</span>
        ) : null}
      </div>
      <span className="fnm-txtags">
        {record.pending ? <span className="jds-badge jds-badge--amber">Pending</span> : null}
        <label className="fnm-catpick">
          <span className="fnm-visually-hidden">{`Category for ${record.name}`}</span>
          <select
            className="jds-select"
            value={categoryId ?? ""}
            onChange={(event: { target: { value: string } }) => {
              if (event.target.value) props.onRecategorize(record, event.target.value);
            }}
          >
            <option value="" disabled>
              {category ? category.name : "Uncategorized"}
            </option>
            {props.categories.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.name}
              </option>
            ))}
          </select>
        </label>
      </span>
      <span className="fnm-amount">{formatCents(record.amountCents, record.isoCurrency)}</span>
    </li>
  );
}

function FeedBody(props: {
  result: FeedResult;
  month: string;
  hostActions: HostActions;
  accountId: string | null;
  overrides: Record<string, string>;
  onRecategorize: (record: FeedTransaction, categoryId: string) => void;
}): ReactNodeLike {
  const transactions = props.result.transactions ?? [];
  const accounts = props.result.accounts ?? [];
  const live = (props.result.categories ?? []).filter((category) => !category.archived);
  if (accounts.length === 0) {
    return (
      <EmptyState
        title="Connect a bank"
        body="Finance syncs accounts and transactions once a bank is connected. Ask Jarvis to connect one — the assistant walks you through the secure Plaid link."
        action={
          <button
            type="button"
            className="jds-btn jds-btn--primary jds-btn--sm"
            onClick={() =>
              props.hostActions.openAssistant({ starterPrompt: "Connect my bank account" })
            }
          >
            Connect with Jarvis
          </button>
        }
      />
    );
  }
  if (transactions.length === 0) {
    return (
      <EmptyState
        title={`No transactions in ${monthLabel(props.month)}`}
        body="Nothing synced for this month and filter. Try another month, clear filters, or run a sync."
      />
    );
  }
  const byDay: Array<{ date: string; rows: FeedTransaction[] }> = [];
  for (const record of transactions) {
    const group = byDay.at(-1);
    if (group && group.date === record.date) group.rows.push(record);
    else byDay.push({ date: record.date, rows: [record] });
  }
  return (
    <div className="fnm-stack">
      {byDay.map((group) => (
        <section key={group.date} aria-label={dayLabel(group.date)}>
          <h3 className="jds-eyebrow">{dayLabel(group.date)}</h3>
          <ul className="fnm-feed jds-card jds-card--flush">
            {group.rows.map((record) => (
              <TransactionRow
                key={record.id}
                record={record}
                month={props.month}
                categories={live}
                overrideCategoryId={props.overrides[record.id]}
                onRecategorize={props.onRecategorize}
              />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

export function FeedScreen(props: { hostActions: HostActions }): ReactNodeLike {
  const [month, setMonth] = useState(currentMonth);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [searchDraft, setSearchDraft] = useState("");
  const [search, setSearch] = useState("");
  const [pendingOnly, setPendingOnly] = useState(false);
  // Optimistic categorize: applied over rows until the refetched feed carries
  // the job's result (stale overrides are harmless — same value).
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  // Connect re-poll loop: null = idle; a number = rounds completed so far.
  const [pollRound, setPollRound] = useState<number | null>(null);
  const pollBaseline = useRef<string | null>(null);

  const feed = useToolQuery<FeedResult>("finance.transactions.query", {
    month,
    limit: 200,
    ...(accountId ? { accountId } : {}),
    ...(categoryId ? { categoryId } : {}),
    ...(search ? { search } : {}),
    ...(pendingOnly ? { pendingOnly } : {})
  });
  const settled =
    feed.status === "settled" && feed.outcome.kind === "ok" ? feed.outcome.result : null;
  const accounts = settled?.accounts ?? [];
  const fingerprint = JSON.stringify(
    accounts.map((account) => `${account.accountId}:${account.itemStatus}`)
  );

  // Drive the connect re-poll (D2: caller-driven, ~30s, bounded). Each round
  // enqueues finance.connect-poll and schedules a refetch; the effect below
  // watches the account fingerprint for the stop signal.
  useEffect(() => {
    if (pollRound === null) return;
    if (pollRound >= POLL_MAX_ROUNDS) {
      setPollRound(null);
      announce("Still pending — finish the bank login in the Plaid tab, then try again.");
      return;
    }
    let cancelled = false;
    void runQueue("finance.connect-poll", "finance.connect-poll-now").then((outcome) => {
      if (cancelled) return;
      if (outcome.kind === "disabled" || outcome.kind === "error") {
        setPollRound(null);
        announce(
          outcome.kind === "disabled"
            ? "Finance is turned off on the server."
            : `Connection check failed: ${outcome.message}`
        );
        return;
      }
      setTimeout(() => invalidateQueries(), REFETCH_DELAY_MS);
    });
    const timer = setTimeout(() => {
      setPollRound((round) => (round === null ? null : round + 1));
    }, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [pollRound]);

  useEffect(() => {
    if (pollRound === null || pollBaseline.current === null) return;
    if (fingerprint !== pollBaseline.current) {
      setPollRound(null);
      pollBaseline.current = null;
      announce("Bank connection updated. Run a sync to pull transactions.");
    }
  }, [fingerprint, pollRound]);

  const recategorize = (record: FeedTransaction, nextCategoryId: string): void => {
    setOverrides((previous) => ({ ...previous, [record.id]: nextCategoryId }));
    // Metadata-only params (D6): the four identifier ids, nothing else. The
    // chunk month is the queried month — that's the key the feed read from.
    void runQueue("finance.categorize-apply", "finance.categorize-apply", {
      transactionId: record.id,
      accountId: record.accountId,
      month,
      categoryId: nextCategoryId
    }).then((outcome) => afterRun(outcome, "Category update queued."));
  };

  const totalsByCurrency = new Map<string, number>();
  for (const account of accounts) {
    totalsByCurrency.set(
      account.isoCurrency,
      (totalsByCurrency.get(account.isoCurrency) ?? 0) + account.balanceCents
    );
  }

  return (
    <section className="fnm-stack" aria-label="Transaction feed">
      <div className="fnm-row">
        <div className="fnm-chips" aria-label="Connected accounts">
          {accounts.map((account) => (
            <AccountPill key={account.accountId} account={account} />
          ))}
          {[...totalsByCurrency].map(([currency, cents]) => (
            <span key={currency} className="jds-badge jds-badge--outline fnm-amount">
              {`Total ${formatCents(cents, currency)}`}
            </span>
          ))}
        </div>
        <div className="fnm-chips">
          <button
            type="button"
            className="jds-btn jds-btn--secondary jds-btn--sm"
            onClick={() => {
              void runQueue("finance.sync-run", "finance.sync-run-now").then((outcome) =>
                afterRun(outcome, "Sync queued — balances refresh shortly.")
              );
            }}
          >
            Sync now
          </button>
          <button
            type="button"
            className="jds-btn jds-btn--ghost jds-btn--sm"
            disabled={pollRound !== null}
            onClick={() => {
              pollBaseline.current = fingerprint;
              setPollRound(0);
              announce("Checking for finished bank connections…");
            }}
          >
            {pollRound !== null ? "Checking connection…" : "Finish connecting"}
          </button>
        </div>
      </div>
      <div className="fnm-row">
        <div className="fnm-chips" role="group" aria-label="Month">
          <button
            type="button"
            className="jds-btn jds-btn--ghost jds-btn--sm"
            aria-label="Previous month"
            onClick={() => setMonth(shiftMonth(month, -1))}
          >
            ←
          </button>
          <span className="jds-eyebrow">{monthLabel(month)}</span>
          <button
            type="button"
            className="jds-btn jds-btn--ghost jds-btn--sm"
            aria-label="Next month"
            onClick={() => setMonth(shiftMonth(month, 1))}
          >
            →
          </button>
        </div>
        <form
          className="fnm-chips"
          onSubmit={(event: { preventDefault: () => void }) => {
            event.preventDefault();
            setSearch(searchDraft.trim());
          }}
        >
          <input
            className="jds-input jds-input--sm"
            type="search"
            placeholder="Search payee"
            aria-label="Search transactions"
            value={searchDraft}
            onChange={(event: { target: { value: string } }) => setSearchDraft(event.target.value)}
          />
          <button type="submit" className="jds-btn jds-btn--secondary jds-btn--sm">
            Search
          </button>
        </form>
      </div>
      <div className="fnm-chips" aria-label="Filters">
        <button
          type="button"
          className={`jds-btn jds-btn--ghost jds-btn--sm${accountId === null ? " jds-btn--secondary" : ""}`}
          aria-pressed={accountId === null}
          onClick={() => setAccountId(null)}
        >
          All accounts
        </button>
        {accounts.map((account) => (
          <button
            key={account.accountId}
            type="button"
            className={`jds-btn jds-btn--ghost jds-btn--sm${accountId === account.accountId ? " jds-btn--secondary" : ""}`}
            aria-pressed={accountId === account.accountId}
            onClick={() => setAccountId(accountId === account.accountId ? null : account.accountId)}
          >
            {account.mask ? `${account.name} ··${account.mask}` : account.name}
          </button>
        ))}
        <label className="fnm-catpick">
          <span className="jds-eyebrow">Category</span>
          <select
            className="jds-select"
            value={categoryId ?? ""}
            onChange={(event: { target: { value: string } }) =>
              setCategoryId(event.target.value || null)
            }
          >
            <option value="">All</option>
            {(settled?.categories ?? [])
              .filter((category) => !category.archived)
              .map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
          </select>
        </label>
        <button
          type="button"
          className={`jds-btn jds-btn--ghost jds-btn--sm${pendingOnly ? " jds-btn--secondary" : ""}`}
          aria-pressed={pendingOnly}
          onClick={() => setPendingOnly(!pendingOnly)}
        >
          Pending only
        </button>
      </div>
      {outcomeGate(
        feed,
        (result) => (
          <FeedBody
            result={result}
            month={month}
            hostActions={props.hostActions}
            accountId={accountId}
            overrides={overrides}
            onRecategorize={recategorize}
          />
        ),
        { loadingLabel: "Loading transactions" }
      )}
    </section>
  );
}
