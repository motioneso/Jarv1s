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
import { useEffect, useRef, useState } from "react";

import { useFeedback } from "./settings-feedback";
import { type SampleSession, type SessionDeviceKind } from "./settings-sample-data";
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

const KIND_ICON: Record<SessionDeviceKind, LucideIcon> = {
  laptop: Laptop,
  phone: Smartphone,
  tablet: Tablet,
  desktop: Monitor
};

// BACKEND-TODO: list-sessions endpoint (device / browser·OS / IP / last-seen from the auth session
// table); wire per-device + bulk revoke to it. The list below is sample data.
export function Sessions() {
  const { toast, confirm } = useFeedback();
  const [sessions, setSessions] = useState<readonly SampleSession[]>([]);
  const others = sessions.filter((s) => !s.current);

  const revoke = (s: SampleSession) =>
    confirm({
      title: `Sign out ${s.device}?`,
      description:
        "That device will need to sign in again to reach Jarvis. Anyone using it right now is signed out immediately.",
      confirmLabel: "Sign out device",
      danger: true,
      onConfirm: () => {
        setSessions((xs) => xs.filter((x) => x.id !== s.id));
        toast(`Signed out ${s.device}`, { tone: "drift", icon: <LogOut size={17} /> });
      }
    });
  const revokeAll = () =>
    confirm({
      title: "Sign out all other devices?",
      description:
        "Every device except this one is signed out immediately. You stay signed in here.",
      confirmLabel: `Sign out ${others.length} device${others.length === 1 ? "" : "s"}`,
      danger: true,
      onConfirm: () => {
        setSessions((xs) => xs.filter((x) => x.current));
        toast("Signed out all other devices", { tone: "drift", icon: <LogOut size={17} /> });
      }
    });

  return (
    <Group
      title="Active sessions"
      desc="Devices signed in to your account. Sign out any you don't recognise."
      action={
        others.length ? (
          <button type="button" className="jds-btn jds-btn--quiet jds-btn--sm" onClick={revokeAll}>
            <span className="jds-btn__icon">
              <LogOut size={15} />
            </span>
            Sign out all others
          </button>
        ) : undefined
      }
    >
      <NotWired>The session list isn't available yet — no devices are shown.</NotWired>
      <div className="sess">
        {sessions.length === 0 ? (
          <Row
            name="No sessions to show"
            desc="Your signed-in devices will appear here once the session list is wired up."
          />
        ) : null}
        {sessions.map((s) => {
          const Icon = KIND_ICON[s.kind];
          return (
            <div className="sess__row" key={s.id}>
              <div className="sess__ic">
                <Icon size={19} aria-hidden="true" />
              </div>
              <div className="sess__main">
                <div className="sess__dev">
                  {s.device}
                  {s.current ? (
                    <Badge tone="pine" dot>
                      This device
                    </Badge>
                  ) : null}
                </div>
                <div className="sess__meta">
                  {s.browser} · {s.os}
                </div>
                <div className="sess__where">
                  <MapPin size={12} aria-hidden="true" />
                  {s.where} · {s.ip}
                </div>
              </div>
              <div className="sess__act">
                <div className={`sess__last${s.current ? " sess__last--now" : ""}`}>{s.last}</div>
                {s.current ? (
                  <span className="sess__you">Current session</span>
                ) : (
                  <button type="button" className="sess__revoke" onClick={() => revoke(s)}>
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
