import {
  Brain,
  CalendarDays,
  Download,
  FileArchive,
  FileText,
  Laptop,
  ListChecks,
  LoaderCircle,
  LogOut,
  MapPin,
  MessagesSquare,
  Monitor,
  ShieldCheck,
  SlidersHorizontal,
  Smartphone,
  Tablet,
  UserRound,
  type LucideIcon
} from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

import { type MeSessionDeviceKind, type MeSessionDto } from "@jarv1s/shared";

import { listMySessions, revokeMyOtherSessions, revokeMySession } from "../api/client";
import { queryKeys } from "../api/query-keys";
import { useFeedback } from "./settings-feedback";
import { Badge, Group, NotWired, Note, Row } from "./settings-ui";

/* ----------------------------------------------------------- Data export */

type ExportPhase = "idle" | "preparing" | "ready";

const INCLUDED: readonly { readonly icon: LucideIcon; readonly name: string }[] = [
  { icon: UserRound, name: "Profile & account" },
  { icon: Brain, name: "Memory — facts, patterns & corrections" },
  { icon: ListChecks, name: "Tasks & commitments" },
  { icon: CalendarDays, name: "Calendar cache" },
  { icon: FileText, name: "Notes & vault index" },
  { icon: MessagesSquare, name: "Conversations" },
  { icon: SlidersHorizontal, name: "Settings & persona" }
];

const STAGES = [
  "Gathering your memory",
  "Collecting tasks & calendar",
  "Packaging notes",
  "Compressing archive"
];

const TODAY = "2026-06-14";

export function DataExport() {
  const { toast } = useFeedback();
  const [phase, setPhase] = useState<ExportPhase>("idle");
  const [pct, setPct] = useState(0);
  const [stageIx, setStageIx] = useState(0);
  const timer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (timer.current) window.clearInterval(timer.current);
    },
    []
  );

  const prepare = () => {
    setPhase("preparing");
    setPct(0);
    setStageIx(0);
    timer.current = window.setInterval(() => {
      setPct((p) => {
        const np = Math.min(100, p + 9);
        setStageIx(Math.min(STAGES.length - 1, Math.floor((np / 100) * STAGES.length)));
        if (np >= 100) {
          if (timer.current) window.clearInterval(timer.current);
          window.setTimeout(() => setPhase("ready"), 420);
        }
        return np;
      });
    }, 230);
  };
  const reset = () => {
    if (timer.current) window.clearInterval(timer.current);
    setPhase("idle");
    setPct(0);
  };
  // BACKEND-TODO: server-side archive build → poll-for-ready → signed download URL. Today the job
  // is simulated and this emits a fixed-content JSON, not a real export.
  const download = () => {
    const manifest = {
      generated: `${TODAY}T00:00:00.000Z`,
      format: "jarvis-archive/v1",
      contents: INCLUDED.map((i) => i.name)
    };
    const blob = new Blob([JSON.stringify(manifest, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `jarvis-export-${TODAY}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast("Download started", { icon: <Download size={17} /> });
  };

  return (
    <Group
      title="Your data"
      desc="Everything Jarvis holds about you, packaged as a portable archive you can keep or take elsewhere."
    >
      <NotWired>The job is simulated and Download emits a fixed JSON, not a real export.</NotWired>
      {phase === "idle" ? (
        <>
          <div className="dexp__inc">
            {INCLUDED.map((i) => {
              const Icon = i.icon;
              return (
                <div className="dexp__chip" key={i.name}>
                  <Icon size={14} aria-hidden="true" />
                  {i.name}
                </div>
              );
            })}
          </div>
          <div className="dexp__bar">
            <div className="dexp__note">
              <FileArchive size={13} aria-hidden="true" />A single archive — structured JSON plus
              your original note files. Yours, in an open format.
            </div>
            <button
              type="button"
              className="jds-btn jds-btn--primary jds-btn--sm"
              onClick={prepare}
            >
              <span className="jds-btn__icon">
                <Download size={15} />
              </span>
              Prepare export
            </button>
          </div>
        </>
      ) : null}

      {phase === "preparing" ? (
        <div className="dexp__job">
          <div className="dexp__jobhd">
            <span className="dexp__spin">
              <LoaderCircle size={16} aria-hidden="true" />
            </span>
            <div className="dexp__jobmain">
              <div className="dexp__jobt">{STAGES[stageIx]}…</div>
              <div className="dexp__jobd">
                Preparing your archive — you can leave this page, we'll keep it ready.
              </div>
            </div>
            <div className="dexp__pct">{Math.round(pct)}%</div>
          </div>
          <div className="dexp__track">
            <div className="dexp__fill" style={{ width: `${pct}%` }} />
          </div>
        </div>
      ) : null}

      {phase === "ready" ? (
        <>
          <div className="dexp__ready">
            <span className="dexp__file">
              <FileArchive size={20} aria-hidden="true" />
            </span>
            <div className="dexp__readymain">
              <div className="dexp__readyt">jarvis-export-{TODAY}.zip</div>
              <div className="dexp__readymeta">
                48.2 MB · generated just now ·{" "}
                <span className="dexp__expire">link expires in 24 hours</span>
              </div>
            </div>
            <button
              type="button"
              className="jds-btn jds-btn--primary jds-btn--sm"
              onClick={download}
            >
              <span className="jds-btn__icon">
                <Download size={15} />
              </span>
              Download
            </button>
          </div>
          <div className="dexp__bar">
            <div className="dexp__note">
              <ShieldCheck size={13} aria-hidden="true" />
              The archive is built on this server and never leaves it until you download it.
            </div>
            <button type="button" className="jds-btn jds-btn--quiet jds-btn--sm" onClick={reset}>
              Prepare a new export
            </button>
          </div>
        </>
      ) : null}
    </Group>
  );
}

/* ----------------------------------------------------------- Active sessions */

const KIND_ICON: Record<MeSessionDeviceKind, LucideIcon> = {
  laptop: Laptop,
  phone: Smartphone,
  tablet: Tablet,
  desktop: Monitor
};

function metaLine(s: MeSessionDto): string {
  return [s.browser, s.os].filter(Boolean).join(" · ") || "Unknown browser";
}

function formatLastSeen(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "Unknown";
  const diffMs = Date.now() - then;
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return "Active now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

export function Sessions() {
  const { toast, confirm } = useFeedback();
  const queryClient = useQueryClient();
  const sessionsQuery = useQuery({
    queryKey: queryKeys.settings.sessions,
    queryFn: listMySessions
  });
  const sessions = sessionsQuery.data?.sessions ?? [];
  const others = sessions.filter((s) => !s.isCurrent);

  const refresh = () => queryClient.invalidateQueries({ queryKey: queryKeys.settings.sessions });

  const revokeOne = useMutation({
    mutationFn: (id: string) => revokeMySession(id),
    onSuccess: (_data, _id) => {
      void refresh();
      toast("Signed out device", { tone: "drift", icon: <LogOut size={17} /> });
    },
    onError: () => toast("Couldn't sign out that device", { icon: <LogOut size={17} /> })
  });
  const revokeAllOthers = useMutation({
    mutationFn: () => revokeMyOtherSessions(),
    onSuccess: (data) => {
      void refresh();
      toast(`Signed out ${data.count} device${data.count === 1 ? "" : "s"}`, {
        tone: "drift",
        icon: <LogOut size={17} />
      });
    },
    onError: () => toast("Couldn't sign out other devices", { icon: <LogOut size={17} /> })
  });

  // Confirm callbacks call mutate() directly — never inside a setState updater, which would
  // double-fire the destructive action under StrictMode.
  const revoke = (s: MeSessionDto) =>
    confirm({
      title: `Sign out ${s.deviceLabel}?`,
      description:
        "That device will need to sign in again to reach Jarvis. Anyone using it right now is signed out immediately.",
      confirmLabel: "Sign out device",
      danger: true,
      onConfirm: () => revokeOne.mutate(s.id)
    });
  const revokeAll = () =>
    confirm({
      title: "Sign out all other devices?",
      description:
        "Every device except this one is signed out immediately. You stay signed in here.",
      confirmLabel: `Sign out ${others.length} device${others.length === 1 ? "" : "s"}`,
      danger: true,
      onConfirm: () => revokeAllOthers.mutate()
    });

  const busy = revokeOne.isPending || revokeAllOthers.isPending;

  return (
    <Group
      title="Active sessions"
      desc="Devices signed in to your account. Sign out any you don't recognise."
      action={
        others.length ? (
          <button
            type="button"
            className="jds-btn jds-btn--quiet jds-btn--sm"
            onClick={revokeAll}
            disabled={busy}
          >
            <span className="jds-btn__icon">
              <LogOut size={15} />
            </span>
            Sign out all others
          </button>
        ) : undefined
      }
    >
      <div className="sess">
        {sessionsQuery.isLoading ? (
          <Row name="Loading sessions…" desc="Fetching the devices signed in to your account." />
        ) : null}
        {sessionsQuery.isError ? (
          <Row
            name="Couldn't load sessions"
            desc="Something went wrong fetching your active sessions. Try again shortly."
          />
        ) : null}
        {!sessionsQuery.isLoading && !sessionsQuery.isError && sessions.length === 0 ? (
          <Row name="No active sessions" desc="There are no signed-in devices to show." />
        ) : null}
        {sessions.map((s) => {
          const Icon = KIND_ICON[s.deviceKind];
          return (
            <div className="sess__row" key={s.id}>
              <div className="sess__ic">
                <Icon size={19} aria-hidden="true" />
              </div>
              <div className="sess__main">
                <div className="sess__dev">
                  {s.deviceLabel}
                  {s.isCurrent ? (
                    <Badge tone="pine" dot>
                      This device
                    </Badge>
                  ) : null}
                </div>
                <div className="sess__meta">{metaLine(s)}</div>
                {s.ipAddress ? (
                  <div className="sess__where">
                    <MapPin size={12} aria-hidden="true" />
                    {s.ipAddress}
                  </div>
                ) : null}
              </div>
              <div className="sess__act">
                <div className={`sess__last${s.isCurrent ? " sess__last--now" : ""}`}>
                  {formatLastSeen(s.lastSeenAt)}
                </div>
                {s.isCurrent ? (
                  <span className="sess__you">Current session</span>
                ) : (
                  <button
                    type="button"
                    className="sess__revoke"
                    onClick={() => revoke(s)}
                    disabled={busy}
                  >
                    <LogOut size={14} aria-hidden="true" />
                    Sign out
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <Note icon={<ShieldCheck size={13} />}>
        Sessions are bound to this instance on your network. Signing a device out takes effect
        immediately.
      </Note>
    </Group>
  );
}
