// external-modules/finance/src/worker/handlers/connect.ts
//
// FIN-01 (#1146) Task 5: Hosted Link connect flow. Two handlers:
//   connect.start — create a Hosted Link session, hand back the URL;
//   connect.poll  — single-shot poll (D2: no worker-side enqueue; the caller
//                   or the finance.connect-poll queue drives re-polls).
// The load-bearing invariant is the D5 token-map RMW guard: a null tokens
// read while connected items exist on record ABORTS the poll — writing a
// fresh map there would clobber every access token for this user.
import { randomUUID } from "node:crypto";

import type { PlaidClient } from "../../adapters/plaid.js";
import { FinanceFetchError } from "../../adapters/types.js";
import { itemKey, linkKey, NS } from "../../domain/index.js";
import type {
  AccountRecord,
  FinanceKv,
  ItemRecord,
  LinkSessionRecord
} from "../../domain/index.js";
import type { TokenMap, WorkerPorts } from "../ports.js";
import type { ToolFactory } from "../registry.js";
import { InputError, readEnum } from "../validate.js";

const LINK_PREFIX = "link:";
const ITEM_PREFIX = "item:";
const CLIENT_USER_ID_KEY = "client-user-id";
/** Hosted Link sessions the user never finished are dropped after 30 min. */
const ABANDON_AFTER_MS = 30 * 60_000;

// Shared with handlers/sync.ts (Task 6) — one definition of "how a handler
// gets a Plaid client" keeps the needs_config/fetch-degradation story single.
export async function buildPlaid(ports: WorkerPorts, envOverride?: "production" | "sandbox") {
  if (ports.plaid === null) {
    // Older host without ctx.fetch: degrade to a structured error.
    throw new FinanceFetchError("fetch_failed", "network access is unavailable on this host");
  }
  const creds = await ports.creds.get(); // throws needs_config when unset
  return ports.plaid(envOverride ?? (await ports.settings.getEnvironment()), creds);
}

/**
 * Stable per-user Plaid client_user_id, minted once and kept in user-scoped
 * settings. The worker never learns the Jarvis user id (kv is pre-scoped to
 * the actor), so a persisted random id is the stable identifier Plaid needs.
 */
async function ensureClientUserId(kv: FinanceKv): Promise<string> {
  const existing = await kv.get(NS.settings, CLIENT_USER_ID_KEY);
  if (existing && typeof existing.id === "string" && existing.id.length > 0) {
    return existing.id;
  }
  const id = randomUUID();
  await kv.set(NS.settings, CLIENT_USER_ID_KEY, { id });
  return id;
}

// Shared with handlers/sync.ts (Task 6).
export async function loadItems(kv: FinanceKv): Promise<ItemRecord[]> {
  const keys = await kv.list(NS.connections);
  const items: ItemRecord[] = [];
  for (const key of keys) {
    if (!key.startsWith(ITEM_PREFIX)) continue;
    const record = await kv.get(NS.connections, key);
    if (record) items.push(record as unknown as ItemRecord);
  }
  return items;
}

export const connectStartHandler: ToolFactory = (ports) => async (input) => {
  // Admin-gated: non-admins always get the instance-configured environment.
  const override = readEnum(input, "environment", ["production", "sandbox"] as const);
  const plaid = await buildPlaid(ports, ports.isAdmin ? override : undefined);

  const clientUserId = await ensureClientUserId(ports.kv);

  // Reauth (update mode): if an item needs re-login, this start fixes THAT
  // item instead of adding a new one — Plaid requires its access token and
  // rejects a products list in update mode.
  const reauthItem = (await loadItems(ports.kv)).find((item) => item.status === "reauth-required");
  let accessToken: string | undefined;
  if (reauthItem) {
    const tokens = await ports.tokens.read();
    const entry = tokens?.[reauthItem.itemId];
    if (!entry) {
      // D5-adjacent: can't distinguish "missing" from transient read failure;
      // retrying is always safe, so never guess with a fresh link instead.
      throw new InputError("token_read_failed", "credential read failed; retry connect");
    }
    accessToken = entry.accessToken;
  }

  const { linkToken, hostedLinkUrl } = await plaid.linkTokenCreate({
    clientUserId,
    daysRequested: 730,
    ...(accessToken === undefined ? {} : { accessToken })
  });

  const session: LinkSessionRecord = {
    linkToken,
    hostedLinkUrl,
    createdAt: ports.now().toISOString(),
    status: "pending"
  };
  // Hashed key: raw link tokens never become key material (keys are listable).
  await ports.kv.set(NS.connections, linkKey(linkToken), session);

  return {
    status: "pending",
    hostedLinkUrl,
    nextStep:
      "Open the link URL to connect the bank, then run finance.connect.poll to finish the connection."
  };
};

async function completePublicToken(
  ports: WorkerPorts,
  plaid: PlaidClient,
  publicToken: string,
  connectedItemCount: number
): Promise<void> {
  const { accessToken, itemId } = await plaid.itemPublicTokenExchange(publicToken);
  const { institutionId, accounts } = await plaid.accountsGet(accessToken);

  // D5 token-map RMW guard: a null read with items on record could be a
  // transient credential-RPC failure — writing would clobber every stored
  // access token, so abort and let the caller re-poll (exchange is
  // idempotent enough: the session stays pending and re-completes).
  const existing = await ports.tokens.read();
  if (existing === null && connectedItemCount > 0) {
    throw new InputError("token_read_failed", "credential read failed; retry poll");
  }
  const merged: TokenMap = { ...(existing ?? {}), [itemId]: { accessToken, institutionId } };
  await ports.tokens.write(merged);

  const nowIso = ports.now().toISOString();
  for (const account of accounts) {
    const record: AccountRecord = {
      accountId: account.accountId,
      itemId,
      name: account.name,
      officialName: account.officialName,
      type: account.type,
      subtype: account.subtype,
      mask: account.mask,
      balanceCents: account.balanceCents,
      isoCurrency: account.isoCurrency,
      updatedAt: nowIso
    };
    await ports.kv.set(NS.accounts, account.accountId, record);
  }
  const item: ItemRecord = {
    itemId,
    institutionId,
    connectedAt: nowIso,
    status: "connected"
  };
  await ports.kv.set(NS.connections, itemKey(itemId), item);
}

export const connectPollHandler: ToolFactory = (ports) => async () => {
  const keys = await ports.kv.list(NS.connections);
  const sessionKeys = keys.filter((key) => key.startsWith(LINK_PREFIX));
  // Loaded once up front: the D5 guard needs "were there connected items
  // BEFORE this poll started", independent of items this poll adds.
  const connectedItemCount = (await loadItems(ports.kv)).filter(
    (item) => item.status !== "error"
  ).length;

  let plaid: PlaidClient | null = null;
  let completed = 0;
  let pending = 0;
  let abandoned = 0;

  for (const key of sessionKeys) {
    const record = await ports.kv.get(NS.connections, key);
    if (!record || record.status !== "pending") continue;
    const session = record as unknown as LinkSessionRecord;

    const age = ports.now().getTime() - new Date(session.createdAt).getTime();
    if (age > ABANDON_AFTER_MS) {
      await ports.kv.set(NS.connections, key, { ...session, status: "abandoned" });
      abandoned += 1;
      continue;
    }

    plaid ??= await buildPlaid(ports);
    const result = await plaid.linkTokenGet(session.linkToken);
    if (result.status === "expired") {
      await ports.kv.set(NS.connections, key, { ...session, status: "abandoned" });
      abandoned += 1;
      continue;
    }
    if (result.status === "pending" || result.publicTokens.length === 0) {
      pending += 1;
      continue;
    }
    for (const publicToken of result.publicTokens) {
      await completePublicToken(ports, plaid, publicToken, connectedItemCount);
    }
    await ports.kv.set(NS.connections, key, { ...session, status: "completed" });
    completed += 1;
  }

  return {
    status: "ok",
    completed,
    pending,
    abandoned,
    nextStep:
      completed > 0
        ? "Connected. Run finance.sync.run-now to import accounts and transactions."
        : pending > 0
          ? "Still pending — finish the bank login in the opened link, then poll again."
          : "No pending connections. Start one with finance.connect.start."
  };
};
