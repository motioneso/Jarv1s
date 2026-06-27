import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowUpRight,
  BookOpen,
  CalendarDays,
  Check,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  Cpu,
  FileText,
  Flag,
  GitCommitHorizontal,
  HeartPulse,
  Image as ImageIcon,
  Info,
  Leaf,
  MessageSquareText,
  Megaphone,
  Newspaper,
  Pill,
  Target
} from "lucide-react";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router";

import type { CalendarEventDto, MeResponse, TaskDto } from "@jarv1s/shared";

import {
  createWellnessCheckin,
  getMedicationSchedule,
  listCalendarEvents,
  listBriefingDefinitions,
  listBriefingRuns,
  listTaskLists,
  listTasks,
  startEveningInterview,
  updateTask
} from "../api/client";
import { findDefinition } from "../briefings/briefing-settings-model";
import { useChatControls } from "../shell/chat-controls-context";
import { MedToday } from "../wellness/wellness-today";
import { ManageMedsModal } from "../wellness/manage-meds-modal";
import { CheckinModal, type CheckinFormValue } from "../wellness/checkin-modal";
import { queryKeys } from "../api/query-keys";
import { BriefingFeedbackMenu } from "./briefing-feedback-menu";
import { TaskDetailsDialog } from "../tasks/task-details-dialog";
import { createEmptyTodayFeed, type FeedTone, type TodayFeed } from "./feed-source";
import { isAtRisk, isDoFirst, isDoneToday } from "../tasks/focus";
import "../styles/wellness-1.css";
import "../styles/wellness-2.css";
import "../styles/wellness-3.css";
import "../styles/kit-tasks-modal.css";
import "../styles/kit-today.css";
import "../styles/kit-today-feeds.css";
import "../styles/kit-today-misc.css";

/** Today — the all-day home: an editorial brief over the user's real tasks + calendar. */
export function TodayPage(props: {
  readonly me: MeResponse;
  readonly feed?: TodayFeed;
  readonly wellnessEnabled?: boolean;
}) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const chatControls = useChatControls();
  const feed = props.feed ?? createEmptyTodayFeed();
  const wellnessEnabled = props.wellnessEnabled ?? false;
  const [dialog, setDialog] = useState<{ readonly id: string } | null>(null);
  const tasksQuery = useQuery({ queryKey: queryKeys.tasks.list, queryFn: () => listTasks() });
  const listsQuery = useQuery({ queryKey: queryKeys.tasks.lists, queryFn: listTaskLists });
  const eventsQuery = useQuery({
    queryKey: queryKeys.calendar.list,
    queryFn: () => listCalendarEvents()
  });
  const briefingDefinitionsQuery = useQuery({
    queryKey: queryKeys.briefings.definitions,
    queryFn: listBriefingDefinitions
  });
  const eveningDefinition = findDefinition(
    briefingDefinitionsQuery.data?.definitions ?? [],
    "evening"
  );
  const eveningRunsQuery = useQuery({
    queryKey: queryKeys.briefings.runs(eveningDefinition?.id ?? null),
    queryFn: () => listBriefingRuns(eveningDefinition!.id),
    enabled: eveningDefinition !== undefined
  });
  const latestEveningRun =
    eveningRunsQuery.data?.runs.find((run) => run.briefingType === "evening") ?? null;
  const eveningInterviewMutation = useMutation({
    mutationFn: () => startEveningInterview({ briefingRunId: latestEveningRun?.id }),
    onSuccess: () => {
      chatControls.openChat();
      void queryClient.invalidateQueries({ queryKey: queryKeys.chat.threads });
    }
  });
  const toggleMutation = useMutation({
    mutationFn: (task: TaskDto) =>
      updateTask(task.id, { status: task.status === "done" ? "todo" : "done" }),
    onSuccess: () => {
      setTimeout(() => {
        void queryClient.invalidateQueries({ queryKey: queryKeys.tasks.list });
      }, 500);
    }
  });

  const theme = document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
  const [medsModalOpen, setMedsModalOpen] = useState(false);
  const [manageMedsOpen, setManageMedsOpen] = useState(false);
  const [checkinModalOpen, setCheckinModalOpen] = useState(false);
  // Soft med reminder is dismissed CLIENT-SIDE ONLY (ephemeral state — reappears on reload).
  // No server-persisted "dismissed" flag: that would need a new endpoint/storage and trip the
  // spec-before-build + no-new-endpoint guardrails for this lane.
  const [medReminderDismissed, setMedReminderDismissed] = useState(false);

  const medScheduleQuery = useQuery({
    queryKey: queryKeys.wellness.schedule(todayKey()),
    queryFn: () => getMedicationSchedule(todayKey()),
    enabled: wellnessEnabled
  });
  const medScheduledSlots = (medScheduleQuery.data?.slots ?? []).filter((s) => !s.asNeeded);
  const medTaken = medScheduledSlots.filter((s) => s.status === "taken").length;
  const medTotal = medScheduledSlots.length;
  const medsAllTaken = medTotal > 0 && medTaken === medTotal;
  const medsNoneLogged = medTotal > 0 && medTaken === 0;
  // Only nudge when a SCHEDULED dose is still outstanding; PRN-only / no-meds users never get one.
  const showMedReminder = wellnessEnabled && medTotal > 0 && medTaken < medTotal;

  const createCheckinMutation = useMutation({
    mutationFn: (val: CheckinFormValue) =>
      createWellnessCheckin({
        feelingCore: val.emotion,
        feelingSecondary: val.feeling,
        feelingTertiary: null,
        sensations: val.sensations,
        intensity: val.intensity,
        note: val.note || null,
        identifiedVia: "wheel"
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.wellness.checkins });
      void queryClient.invalidateQueries({ queryKey: queryKeys.wellness.insights });
      setCheckinModalOpen(false);
    }
  });

  const tasks = tasksQuery.data?.tasks ?? [];
  const events = eventsQuery.data?.events ?? [];
  const lists = listsQuery.data?.lists ?? [];

  const open = tasks.filter((t) => t.parentTaskId === null && t.status === "todo");
  // "Priorities" = Do First (important + urgent); "At risk" = due today/soon or overdue.
  const priorities = open.filter(isDoFirst);
  const atRisk = open.filter(isAtRisk);
  const todayEvents = useMemo(() => events.filter(isToday).sort(byStart), [events]);
  const upcoming = useMemo(
    () => todayEvents.filter((e) => new Date(e.endsAt).getTime() >= Date.now()),
    [todayEvents]
  );
  const doneToday = tasks.filter(isDoneToday).length;

  // "Start here": top open tasks by priority, then nearest due.
  const startHere = [...open]
    .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0) || dueTs(a) - dueTs(b))
    .slice(0, 3);
  const looseEnds = atRisk.slice(0, 5);

  const name = firstName(props.me.user.name, props.me.user.email);
  const lede = buildLede(priorities.length, atRisk.length, todayEvents.length);
  // A row of four zeros is noise, not signal — the hero lede already says the day
  // is clear. Show the stat shortcuts only once at least one tile carries a count.
  const hasStatSignal =
    priorities.length > 0 || atRisk.length > 0 || todayEvents.length > 0 || doneToday > 0;

  return (
    <div className="cmd-wrap">
      <header className="cmd-hero">
        <h1 className="cmd-hello">
          {greeting()}, <span className="nm">{name}</span>.
        </h1>
        <p className="cmd-lede" dangerouslySetInnerHTML={{ __html: lede }} />
      </header>

      {hasStatSignal ? (
        <div className="cmd-stats">
          <Stat
            k="Priorities"
            v={priorities.length}
            icon={<Target size={12} />}
            onClick={() => navigate("/tasks?focus=priorities")}
          />
          <Stat
            k="At risk"
            v={atRisk.length}
            warn={atRisk.length > 0}
            icon={<Clock size={12} />}
            onClick={() => navigate("/tasks?focus=atrisk")}
          />
          <Stat
            k="Events"
            v={todayEvents.length}
            icon={<CalendarDays size={12} />}
            onClick={() => navigate("/calendar")}
          />
          <Stat
            k="Done today"
            v={doneToday}
            icon={<CheckCircle2 size={12} />}
            onClick={() => navigate("/tasks?focus=donetoday")}
          />
        </div>
      ) : null}

      <div className="cmd-grid">
        <div>
          <section className="jds-brief">
            <div className="jds-brief__head">
              <span className="jds-brief__kicker">Start here</span>
            </div>
            <div className="jds-brief__title">The few things that matter most</div>
            <p className="cmd-leadin">
              Pulled from your tasks and recent notes: sources are noted for each.
            </p>
            <div className="top3" style={{ marginTop: 4 }}>
              {startHere.length > 0 ? (
                startHere.map((task) => (
                  <BriefTaskRow
                    key={task.id}
                    task={task}
                    onToggle={() => toggleMutation.mutate(task)}
                    onOpen={() => setDialog({ id: task.id })}
                  />
                ))
              ) : (
                <p className="cmd-empty">Nothing pressing right now.</p>
              )}
            </div>
            {startHere.length > 0 ? (
              <div style={{ marginTop: 12 }}>
                <span className="jds-why">
                  <Info size={12} aria-hidden="true" />
                  Ranked by priority, then by what&apos;s due first.
                </span>
              </div>
            ) : null}
          </section>

          {feed.overnight.length > 0 ? <OvernightSection items={feed.overnight} /> : null}

          <section className="jds-brief">
            <div className="jds-brief__head">
              <span className="jds-brief__kicker">Walking the day</span>
            </div>
            <div className="jds-brief__title">What's on the calendar</div>
            {todayEvents.length > 0 ? (
              <div className="day-list">
                {todayEvents.map((event) => (
                  <div className="day-ev" key={event.id}>
                    <div className="day-ev__t">
                      {timeLabel(event.startsAt)}
                      <span className="ap"> {ampm(event.startsAt)}</span>
                    </div>
                    <div>
                      <div className="day-ev__title">{event.title}</div>
                      {event.location ? (
                        <div className="day-ev__where">{event.location}</div>
                      ) : null}
                    </div>
                    <div className="day-ev__who">{durationLabel(event)}</div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="cmd-empty">No events today.</p>
            )}
          </section>

          {feed.sports.items.length > 0 ? (
            <SportsDesk items={feed.sports.items} quietTeams={feed.sports.quietTeams} />
          ) : null}
          {feed.news.length > 0 || feed.interests.length > 0 ? (
            <NewsDesk news={feed.news} interests={feed.interests} />
          ) : null}

          {looseEnds.length > 0 ? (
            <section className="jds-brief">
              <div className="jds-brief__head">
                <span className="jds-brief__kicker">Loose ends</span>
              </div>
              <div className="jds-brief__title">Things I'm keeping an eye on</div>
              <div className="loose">
                {looseEnds.map((task) => {
                  const drift = driftOf(task);
                  return (
                    <button
                      type="button"
                      className="loose-row"
                      key={task.id}
                      onClick={() => setDialog({ id: task.id })}
                    >
                      <span className="loose-row__ic">
                        <Flag size={15} aria-hidden="true" />
                      </span>
                      <div className="loose-row__main">
                        <div className="loose-row__title">{task.title}</div>
                        <div className="loose-row__meta">{task.source}</div>
                      </div>
                      <div className="loose-row__act">
                        <span className={`jds-drift jds-drift--${drift}`}>
                          <span className="jds-drift__dot" />
                          {drift === "overdue" ? "Overdue" : "At risk"}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </section>
          ) : null}
        </div>

        <aside className="cmd-aside">
          <div className="inst">
            <div className="inst__head">
              <span className="inst__title">Today's agenda</span>
              <span className="inst__meta">{upcoming.length} left</span>
            </div>
            {upcoming.length > 0 ? (
              <div>
                {upcoming.map((event, index) => (
                  <div
                    className={`sched-row ${index === 0 ? "sched-row--now" : ""}`}
                    key={event.id}
                  >
                    <div className="sched-row__t">{timeLabel(event.startsAt)}</div>
                    <div className="sched-row__body">
                      <div className="sched-row__title">{event.title}</div>
                      {event.location ? (
                        <div className="sched-row__sub">{event.location}</div>
                      ) : null}
                      {index === 0 ? (
                        <span className="sched-now">
                          <span
                            style={{
                              width: 5,
                              height: 5,
                              borderRadius: 9,
                              background: "var(--accent)"
                            }}
                          />
                          Next up
                        </span>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="agenda-clear">
                Nothing left on the calendar today. <b>Enjoy the evening.</b>
              </div>
            )}
          </div>

          {eveningDefinition?.enabled ? (
            <div className="inst">
              <div className="inst__head">
                <span className="inst__title">Evening review</span>
                <span className="inst__meta">
                  {latestEveningRun ? shortDate(latestEveningRun.createdAt) : "Ready at 7 PM"}
                </span>
              </div>
              {latestEveningRun ? (
                <>
                  <p className="cmd-empty">{compactSummary(latestEveningRun.summaryText)}</p>
                  <BriefingFeedbackMenu
                    targetRef={latestEveningRun.id}
                    onChanged={() =>
                      void queryClient.invalidateQueries({
                        queryKey: queryKeys.briefings.runs(eveningDefinition.id)
                      })
                    }
                  />
                </>
              ) : (
                <div className="agenda-clear">No evening review yet.</div>
              )}
              <button
                type="button"
                className="primary-button"
                disabled={eveningInterviewMutation.isPending}
                onClick={() => eveningInterviewMutation.mutate()}
              >
                <MessageSquareText size={14} aria-hidden="true" />
                Prep for tomorrow
              </button>
            </div>
          ) : null}

          {wellnessEnabled ? (
            <div className="well">
              <div className="well__head">
                <span className="ic">
                  <HeartPulse size={15} aria-hidden="true" />
                </span>
                <span className="well__title">Wellness</span>
              </div>
              {medTotal > 0 ? (
                <div className="well__line">
                  {medsAllTaken ? (
                    <>
                      <Check size={14} aria-hidden="true" /> <b>All meds taken</b> today.
                    </>
                  ) : medsNoneLogged ? (
                    <>
                      No meds logged yet today — <b>{medTotal}</b> to go.
                    </>
                  ) : (
                    <>
                      <b>
                        {medTaken} of {medTotal}
                      </b>{" "}
                      meds logged today.
                    </>
                  )}
                </div>
              ) : null}
              {showMedReminder && !medReminderDismissed ? (
                <div className="well__nudge" role="status">
                  <span className="well__nudge-tx">
                    A gentle nudge: {medTotal - medTaken} dose
                    {medTotal - medTaken === 1 ? "" : "s"} left to log today.
                  </span>
                  <button
                    type="button"
                    className="well__nudge-x"
                    aria-label="Dismiss reminder"
                    onClick={() => setMedReminderDismissed(true)}
                  >
                    <XIcon />
                  </button>
                </div>
              ) : null}
              <div className="well__actions">
                <button
                  className="well__btn well__btn--meds"
                  onClick={() => setMedsModalOpen(true)}
                >
                  <span className="lead">
                    <span className="ic">
                      <Pill size={15} aria-hidden="true" />
                    </span>
                    Meds
                  </span>
                  {medTotal > 0 ? (
                    <span className={`well__ct${medsAllTaken ? " is-done" : ""}`}>
                      {medTaken}/{medTotal}
                    </span>
                  ) : null}
                </button>
                <button className="well__btn" onClick={() => setCheckinModalOpen(true)}>
                  <span className="ic">
                    <ClipboardCheck size={15} aria-hidden="true" />
                  </span>
                  Check in
                </button>
              </div>
            </div>
          ) : null}
        </aside>
      </div>
      {wellnessEnabled && medsModalOpen ? (
        <div
          className="wl-modal-scrim"
          onMouseDown={(ev) => {
            if (ev.target === ev.currentTarget) setMedsModalOpen(false);
          }}
        >
          <div
            className="wl-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="today-meds-title"
            style={{ maxWidth: 480 }}
          >
            <div className="wl-modal__head">
              <div className="hm">
                <div className="wl-modal__eyebrow">Today</div>
                <div className="wl-modal__title" id="today-meds-title">
                  Medications
                </div>
              </div>
              <button
                type="button"
                className="wl-modal__x"
                aria-label="Close"
                onClick={() => setMedsModalOpen(false)}
              >
                <XIcon />
              </button>
            </div>
            <div className="wl-modal__body" style={{ padding: "0 0 8px" }}>
              <MedToday
                theme={theme}
                onManage={() => {
                  setMedsModalOpen(false);
                  setManageMedsOpen(true);
                }}
              />
            </div>
            <div className="wl-modal__foot">
              <span className="spacer" />
              <button
                type="button"
                className="primary-button"
                onClick={() => setMedsModalOpen(false)}
              >
                Done
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {wellnessEnabled ? (
        <ManageMedsModal
          open={manageMedsOpen}
          onClose={() => setManageMedsOpen(false)}
          theme={theme}
        />
      ) : null}

      {wellnessEnabled ? (
        <CheckinModal
          open={checkinModalOpen}
          onClose={() => setCheckinModalOpen(false)}
          onSave={(val) => createCheckinMutation.mutate(val)}
          initial={null}
          seedEmotion={null}
          theme={theme}
        />
      ) : null}

      {dialog ? (
        <TaskDetailsDialog
          open
          taskId={dialog.id}
          currentUserLabel="You"
          lists={lists}
          onClose={() => setDialog(null)}
        />
      ) : null}
    </div>
  );
}

function XIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
    >
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}

function Stat(props: {
  readonly k: string;
  readonly v: number;
  readonly icon: React.ReactNode;
  readonly warn?: boolean;
  readonly onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`cmd-stat ${props.warn ? "cmd-stat--warn" : ""}`}
      onClick={props.onClick}
    >
      <div className="k">
        {props.icon}
        {props.k}
        <span className="cmd-stat__go">
          <ArrowUpRight size={13} aria-hidden="true" />
        </span>
      </div>
      <div className="v">{props.v}</div>
    </button>
  );
}

function BriefTaskRow(props: {
  readonly task: TaskDto;
  readonly onToggle: () => void;
  readonly onOpen: () => void;
}) {
  const { task } = props;
  const [optimisticDone, setOptimisticDone] = useState(task.status === "done");
  const done = optimisticDone;
  const drift = driftOf(task);
  const p1 = (task.priority ?? 0) >= 4;
  return (
    <div
      className={`jds-task ${p1 ? "jds-task--p1" : "jds-task--p2"} ${done ? "jds-task--done" : ""}`}
    >
      <span className="jds-task__prio" />
      <span className="jds-task__check">
        <label className="jds-check">
          <input
            type="checkbox"
            checked={done}
            onChange={() => {
              setOptimisticDone(!optimisticDone);
              props.onToggle();
            }}
            aria-label={done ? `Reopen ${task.title}` : `Complete ${task.title}`}
          />
          <span className="jds-check__box">
            <Check size={13} aria-hidden="true" />
          </span>
        </label>
      </span>
      <button type="button" className="jds-task__main" onClick={props.onOpen}>
        <div className="jds-task__title">{task.title}</div>
        <div className="jds-task__meta">
          {drift ? (
            <span className={`jds-drift jds-drift--${drift}`}>
              <span className="jds-drift__dot" />
              {drift === "overdue" ? "Overdue" : "At risk"}
            </span>
          ) : null}
          <span className="jds-task__source">
            <GitCommitHorizontal size={12} aria-hidden="true" />
            {task.source}
          </span>
          {task.dueAt ? <span className="jds-task__time">{shortDate(task.dueAt)}</span> : null}
        </div>
      </button>
    </div>
  );
}

// ---- editorial feed sections (demo data; no backend yet) ----
const FEED_BADGE: Record<FeedTone, string> = {
  pine: "jds-badge--pine",
  amber: "jds-badge--amber",
  steel: "jds-badge--steel",
  red: "jds-badge--red",
  neutral: "jds-badge--neutral"
};

function OvernightSection(props: { readonly items: TodayFeed["overnight"] }) {
  return (
    <section className="jds-brief">
      <div className="jds-brief__head">
        <span className="jds-brief__kicker">Overnight</span>
      </div>
      <div className="jds-brief__title">What changed since last night</div>
      <div className="overnight">
        {props.items.map((item) => (
          <div className="overnight__row" key={item.tag + item.text}>
            <span className={`jds-badge ${FEED_BADGE[item.tone]}`}>{item.tag}</span>
            <span className="tx">{item.text}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function SportsDesk(props: {
  readonly items: TodayFeed["sports"]["items"];
  readonly quietTeams: TodayFeed["sports"]["quietTeams"];
}) {
  const hero = props.items[0];
  const rest = props.items.slice(1);
  if (!hero) return null;
  const crest = (team: string) => team.slice(0, 2).toUpperCase();
  const outClass = (s: TodayFeed["sports"]["items"][number]) =>
    s.kind === "news" ? "news" : s.outcome === "W" ? "w" : s.outcome === "L" ? "l" : "d";
  return (
    <section className="jds-brief">
      <div className="jds-brief__head">
        <span className="jds-brief__kicker">Sports desk</span>
      </div>
      <div className="jds-brief__title">From your teams, last night</div>
      <div className="np-hero">
        <div className="np-photo">
          <div className="np-photo__ph">
            <ImageIcon size={22} aria-hidden="true" />
            <span className="np-photo__cap">Match photo</span>
          </div>
          <div className="np-photo__crest" style={{ background: hero.color }}>
            {crest(hero.team)}
          </div>
        </div>
        <div className="np-hero__body">
          <div className="np-kicker">
            {hero.team} · {hero.league}{" "}
            <span className="out">
              {hero.outcome === "D" ? "DRAW" : hero.outcome === "W" ? "WIN" : ""}
            </span>
          </div>
          <h3 className="np-headline">{hero.headline}</h3>
          {hero.score ? <div className="np-score">{hero.score}</div> : null}
          {hero.detail ? <p className="np-dek">{hero.detail}</p> : null}
        </div>
      </div>
      <div className="np-list">
        {rest.map((s) => (
          <div className="np-row" key={s.headline}>
            <div className="np-row__lead crest" style={{ background: s.color }}>
              {crest(s.team)}
            </div>
            <div className="np-row__main">
              <div className="np-row__title">{s.headline}</div>
              <div className="np-row__sub">
                {s.team} · {s.league}
                {s.score ? ` — ${s.score}` : ""}
              </div>
            </div>
            <div className={`np-row__out ${outClass(s)}`}>
              {s.kind === "news" ? <Megaphone size={12} aria-hidden="true" /> : s.outcome}
            </div>
          </div>
        ))}
      </div>
      {props.quietTeams.length > 0 ? (
        <div className="np-quiet">Quiet night for {props.quietTeams.join(" and ")}.</div>
      ) : null}
    </section>
  );
}

const INTEREST_ICONS = { cpu: Cpu, leaf: Leaf, book: BookOpen } as const;

function NewsDesk(props: {
  readonly news: TodayFeed["news"];
  readonly interests: TodayFeed["interests"];
}) {
  const hero = props.news[0];
  const rest = props.news.slice(1);
  return (
    <section className="jds-brief">
      <div className="jds-brief__head">
        <span className="jds-brief__kicker">The desk</span>
      </div>
      <div className="jds-brief__title">News &amp; your interests</div>
      {hero ? (
        <div className="np-hero">
          <div className="np-photo np-photo--news">
            <div className="np-photo__ph">
              <Newspaper size={22} aria-hidden="true" />
              <span className="np-photo__cap">Story image</span>
            </div>
          </div>
          <div className="np-hero__body">
            <div className="np-kicker">{hero.source}</div>
            <h3 className="np-headline">{hero.title}</h3>
            {hero.dek ? <p className="np-dek">{hero.dek}</p> : null}
            <div className="np-meta">{hero.meta}</div>
          </div>
        </div>
      ) : null}
      <div className="np-list">
        {rest.map((n) => (
          <div className="np-row" key={n.title}>
            <div className="np-row__lead src">
              <FileText size={15} aria-hidden="true" />
            </div>
            <div className="np-row__main">
              <div className="np-row__title">{n.title}</div>
              <div className="np-row__sub">
                <span className="src">{n.source}</span> · {n.meta}
              </div>
            </div>
          </div>
        ))}
        {props.interests.map((n) => {
          const Ico = INTEREST_ICONS[n.icon];
          return (
            <div className="np-row" key={n.title}>
              <div className="np-row__lead src">
                <Ico size={15} aria-hidden="true" />
              </div>
              <div className="np-row__main">
                <div className="np-row__title">{n.title}</div>
                <div className="np-row__sub">
                  <span className="np-topic">Following · {n.topic}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ---- helpers ----
function firstName(name: string, email: string): string {
  const source = name.trim() || email.split("@")[0] || "there";
  const base = source.split(/\s+/)[0] ?? source;
  return base.charAt(0).toUpperCase() + base.slice(1);
}

function compactSummary(value: string): string {
  const text = value.replace(/\s+/g, " ").trim();
  if (text.length <= 220) return text;
  return `${text.slice(0, 217).trimEnd()}...`;
}

function todayKey(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

function buildLede(priorities: number, atRisk: number, events: number): string {
  const parts: string[] = [];
  parts.push(
    priorities > 0
      ? `You have <b>${priorities} ${priorities === 1 ? "priority" : "priorities"}</b> to move today`
      : "Nothing pressing right now"
  );
  if (events > 0) parts.push(`${events} ${events === 1 ? "event" : "events"} on the calendar`);
  if (atRisk > 0)
    parts.push(
      `${atRisk} ${atRisk === 1 ? "thing has" : "things have"} slipped: we can reset without rushing`
    );
  return `${parts.join(", and ")}.`;
}

function driftOf(task: TaskDto): "atrisk" | "overdue" | null {
  if (!task.dueAt || task.status === "done") return null;
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const due = new Date(task.dueAt);
  const startDue = new Date(due.getFullYear(), due.getMonth(), due.getDate()).getTime();
  if (startDue < startToday) return "overdue";
  if (startDue - startToday <= 86_400_000 * 2) return "atrisk";
  return null;
}

function dueTs(task: TaskDto): number {
  return task.dueAt ? new Date(task.dueAt).getTime() : Number.MAX_SAFE_INTEGER;
}

function isSameDay(date: Date, ref: Date = new Date()): boolean {
  return (
    date.getFullYear() === ref.getFullYear() &&
    date.getMonth() === ref.getMonth() &&
    date.getDate() === ref.getDate()
  );
}

function isToday(event: CalendarEventDto): boolean {
  return isSameDay(new Date(event.startsAt));
}

function byStart(a: CalendarEventDto, b: CalendarEventDto): number {
  return new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime();
}

function timeLabel(iso: string): string {
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit", hour12: true })
    .format(new Date(iso))
    .replace(/\s?[AP]M$/i, "");
}

function ampm(iso: string): string {
  return new Date(iso).getHours() < 12 ? "am" : "pm";
}

function durationLabel(event: CalendarEventDto): string {
  const mins = Math.round(
    (new Date(event.endsAt).getTime() - new Date(event.startsAt).getTime()) / 60000
  );
  if (mins <= 0) return "";
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

function shortDate(iso: string): string {
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(
    new Date(iso)
  );
}
