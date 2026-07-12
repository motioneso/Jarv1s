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
  Info,
  Leaf,
  Newspaper,
  Pill,
  Target
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";

import { localDay, type MeResponse, type TaskDto } from "@jarv1s/shared";

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
import { findDefinition, targetTimeFor } from "../briefings/briefing-settings-model";
import { useUserLocale } from "../locale/locale-format";
import { useChatControls } from "../shell/chat-controls-context";
import { MedToday } from "../wellness/wellness-today";
import { ManageMedsModal } from "../wellness/manage-meds-modal";
import { CheckinModal, type CheckinFormValue } from "../wellness/checkin-modal";
import { queryKeys } from "../api/query-keys";
import {
  addDaysToKey,
  buildEveningLede,
  deriveTodayMode,
  effectiveEveningTimeZone,
  EveningPrepCard,
  EveningReviewSection,
  EveningSupportSections,
  latestEveningRunForToday,
  scheduleTodayModeRefresh
} from "./evening-mode";
import { ProactiveCards } from "./proactive-cards";
import { SuggestedFromEmailSection } from "./today-suggested-email";
import { TaskDetailsDialog } from "../tasks/task-details-dialog";
import { createEmptyTodayFeed, type FeedTone, type TodayFeed } from "./feed-source";
import { ModuleTodayWidgets } from "./module-today-widgets";
import {
  ampm,
  buildHeadline,
  buildLede,
  byStart,
  countdownLabel,
  datelineLabel,
  driftOf,
  dueTs,
  durationLabel,
  firstName,
  greeting,
  isToday,
  shortDate,
  timeLabel
} from "./today-labels";
import { isAtRisk, isDoFirst, isDoneToday } from "../tasks/focus";
import "../styles/wellness-1.css";
import "../styles/wellness-2.css";
import "../styles/wellness-3.css";
import "../styles/kit-tasks-modal.css";
import "../styles/kit-today.css";
import "../styles/kit-today-feeds.css";
import "../styles/kit-today-misc.css";
import { GoalsSection } from "./goals-section.js";

/** Today — the all-day home: an editorial brief over the user's real tasks + calendar. */
export function TodayPage(props: {
  readonly me: MeResponse;
  readonly feed?: TodayFeed;
  readonly wellnessEnabled?: boolean;
  readonly disabledModuleIds?: readonly string[];
}) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const chatControls = useChatControls();
  const locale = useUserLocale();
  const feed = props.feed ?? createEmptyTodayFeed();
  const disabledModuleIds = props.disabledModuleIds ?? [];
  const wellnessEnabled = props.wellnessEnabled ?? false;
  const [dialog, setDialog] = useState<{ readonly id: string } | null>(null);
  const [, forceTodayModeRefresh] = useState(0);
  // The masthead clock and next-event countdown read `now`; tick a re-render each
  // half-minute so they stay honest while the page sits open.
  const [, forceClockTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => forceClockTick((value) => value + 1), 30_000);
    return () => window.clearInterval(id);
  }, []);
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
  const now = new Date(Date.now());
  const todayMode = deriveTodayMode(eveningDefinition, locale, now);
  const eveningTimeZone = effectiveEveningTimeZone(eveningDefinition, locale);
  const latestEveningRun = latestEveningRunForToday(
    eveningRunsQuery.data?.runs ?? [],
    eveningTimeZone,
    now
  );
  useEffect(
    () =>
      scheduleTodayModeRefresh(eveningDefinition, locale, () => {
        forceTodayModeRefresh((value) => value + 1);
      }),
    [
      eveningDefinition?.enabled,
      eveningDefinition?.id,
      eveningDefinition?.scheduleMetadata.targetTime,
      eveningDefinition?.scheduleMetadata.timezone,
      locale.timezone,
      todayMode
    ]
  );
  const eveningInterviewMutation = useMutation({
    mutationFn: () => startEveningInterview({ briefingRunId: latestEveningRun?.id }),
    onSuccess: () => {
      // The seeded interview turn arrives via the global chat SSE stream; just
      // refresh the thread list. The drawer is already open (see onPrep below).
      void queryClient.invalidateQueries({ queryKey: queryKeys.chat.threads });
    },
    // #891: the seed POST reaches submitTurn, which needs a configured chat model
    // and can reject (unconfigured model, provider error, rate limit). Keep a
    // console trail; the drawer is already open regardless, so the failure is not
    // a silent no-op the way it was when opening was gated behind onSuccess.
    onError: (error) => {
      console.error("evening interview failed to start", error);
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
  const medScheduleQuery = useQuery({
    queryKey: queryKeys.wellness.schedule(localDay(new Date(), locale.timezone)),
    queryFn: () => getMedicationSchedule(localDay(new Date(), locale.timezone)),
    enabled: wellnessEnabled
  });
  const medScheduledSlots = (medScheduleQuery.data?.slots ?? []).filter((s) => !s.asNeeded);
  const medTaken = medScheduledSlots.filter((s) => s.status === "taken").length;
  const medTotal = medScheduledSlots.length;
  const medsAllTaken = medTotal > 0 && medTaken === medTotal;
  const medsNoneLogged = medTotal > 0 && medTaken === 0;
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
  const suggestedTasks = tasks.filter((t) => t.status === "suggested");
  // "Priorities" = Do First (important + urgent); "At risk" = due today/soon or overdue.
  const priorities = open.filter(isDoFirst);
  const atRisk = open.filter((t) => isAtRisk(t, locale.timezone));
  const completedToday = tasks.filter((t) => isDoneToday(t, locale.timezone));
  const todayEvents = useMemo(
    () => events.filter((e) => isToday(e, locale.timezone)).sort(byStart),
    [events, locale.timezone]
  );
  const tomorrowKey = addDaysToKey(localDay(now, locale.timezone), 1);
  const tomorrowEvents = useMemo(
    () => events.filter((e) => localDay(e.startsAt, locale.timezone) === tomorrowKey).sort(byStart),
    [events, locale.timezone, tomorrowKey]
  );
  const tomorrowTasks = tasks
    .filter(
      (task) =>
        task.status === "todo" &&
        task.dueAt !== null &&
        localDay(task.dueAt, locale.timezone) === tomorrowKey
    )
    .slice(0, 3);
  const upcoming = useMemo(
    () => todayEvents.filter((e) => new Date(e.endsAt).getTime() >= Date.now()),
    [todayEvents]
  );
  const doneToday = completedToday.length;

  // "Start here": top open tasks by priority, then nearest due.
  const startHere = [...open]
    .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0) || dueTs(a) - dueTs(b))
    .slice(0, 3);
  const looseEnds = atRisk.slice(0, 5);

  const name = firstName(props.me.user.name, props.me.user.email);
  const lede =
    todayMode === "evening"
      ? buildEveningLede(doneToday, atRisk.length, tomorrowEvents.length)
      : buildLede(priorities.length, atRisk.length, todayEvents.length);
  // A row of four zeros is noise, not signal — the hero lede already says the day
  // is clear. Show the stat shortcuts only once at least one tile carries a count.
  const hasStatSignal =
    priorities.length > 0 || atRisk.length > 0 || todayEvents.length > 0 || doneToday > 0;
  // Priorities and at-risk overlap (a Do First task can also be due today), so the
  // masthead count dedupes by id: it reads as "N need you", not a double-counted sum.
  const needsYou = new Set([...priorities, ...atRisk].map((t) => t.id)).size;
  const upcomingLeft = upcoming.filter((e) => new Date(e.startsAt).getTime() >= now.getTime());
  const headline = buildHeadline(todayMode, needsYou, upcomingLeft.length, doneToday);
  const nextEvent = upcoming[0];
  const nextStarted = nextEvent ? new Date(nextEvent.startsAt).getTime() <= now.getTime() : false;

  return (
    <div className="cmd-wrap">
      <header className="cmd-masthead">
        <div className="cmd-masthead__row">
          <div className="cmd-masthead__main">
            <p className="cmd-eyebrow">
              {greeting()}, {name}
            </p>
            <h1 className="cmd-title">
              <span>{headline.top}</span>
              <span className="cmd-title__accent">{headline.accent}</span>
            </h1>
            <p className="cmd-lede" dangerouslySetInnerHTML={{ __html: lede }} />
          </div>
          {/* Folio column (Ben 2026-07-09 /today): the dateline moved OUT of its own line above
              the row and INTO the header row as a top-right folio, stacked over the clock — the
              eyebrow/title/lede reclaim the vacated top band and rise slightly. Aside pins the
              dateline to the top and the clock to the bottom (see .cmd-masthead__aside). */}
          <div className="cmd-masthead__aside">
            <div className="cmd-dateline">{datelineLabel(now, locale)}</div>
            {/* PM is shown as a dot floating left of the first digit rather than an "am/pm"
                suffix (Ben 2026-07-08). AM shows no dot; the dot marks anything past 11:59am. */}
            <div className="cmd-clock" aria-hidden="true">
              <span className="cmd-clock__time">
                {ampm(now.toISOString(), locale) === "pm" ? (
                  // Real element (not a ::before) so it can carry a native "PM" hover tooltip
                  // (Ben 2026-07-08). title is discoverable on hover even under aria-hidden.
                  <span className="cmd-clock__pm" title="PM" />
                ) : null}
                {timeLabel(now.toISOString(), locale)}
              </span>
            </div>
          </div>
        </div>
      </header>

      <div className="cmd-grid">
        <div>
          {todayMode === "evening" && eveningDefinition?.enabled ? (
            <>
              <EveningReviewSection
                kind="primary"
                run={latestEveningRun}
                locale={locale}
                targetTime={targetTimeFor(eveningDefinition, "evening")}
                onFeedbackChanged={() =>
                  void queryClient.invalidateQueries({
                    queryKey: queryKeys.briefings.runs(eveningDefinition.id)
                  })
                }
              />
              <EveningSupportSections
                completedToday={completedToday}
                carryingForward={looseEnds}
                tomorrowEvents={tomorrowEvents}
                tomorrowTasks={tomorrowTasks}
                locale={locale}
                renderTask={(task) => (
                  <BriefTaskRow
                    key={task.id}
                    task={task}
                    onToggle={() => toggleMutation.mutate(task)}
                    onOpen={() => setDialog({ id: task.id })}
                  />
                )}
              />
            </>
          ) : null}

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

          <SuggestedFromEmailSection
            tasks={suggestedTasks}
            locale={locale}
            onOpen={(id) => setDialog({ id })}
          />

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
                      {timeLabel(event.startsAt, locale)}
                      <span className="ap"> {ampm(event.startsAt, locale)}</span>
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

          <ModuleTodayWidgets disabledModuleIds={disabledModuleIds} />
          {feed.news.length > 0 || feed.interests.length > 0 ? (
            <NewsDesk news={feed.news} interests={feed.interests} />
          ) : null}

          <GoalsSection />

          {looseEnds.length > 0 ? (
            <section className="jds-brief">
              <div className="jds-brief__head">
                <span className="jds-brief__kicker">Loose ends</span>
              </div>
              <div className="jds-brief__title">Things I'm keeping an eye on</div>
              <div className="loose">
                {looseEnds.map((task) => {
                  const drift = driftOf(task, locale.timezone);
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

          <ProactiveCards />
        </div>

        {/* .cmd-aside is the full-height rail carrying the column keyline; the sticky
            content lives in __inner so the border grows to the main column's bottom while
            the cards stay pinned at top (Ben 2026-07-07: border stopped mid-scroll). */}
        <aside className="cmd-aside">
          <div className="cmd-aside__inner">
            {nextEvent ? (
              <div className="cmd-next">
                <div className="cmd-next__k">{nextStarted ? "Now · ends in" : "Next event in"}</div>
                <div className="cmd-next__v">
                  {countdownLabel(nextStarted ? nextEvent.endsAt : nextEvent.startsAt, now)}
                </div>
                <div className="cmd-next__what">
                  {nextEvent.title} · {timeLabel(nextEvent.startsAt, locale)}
                  {ampm(nextEvent.startsAt, locale)}
                </div>
              </div>
            ) : null}

            {hasStatSignal ? (
              <div className="cmd-glance">
                <div className="cmd-glance__title">At a glance</div>
                <div className="cmd-glance__grid">
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
              </div>
            ) : null}

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
                      <div className="sched-row__t">{timeLabel(event.startsAt, locale)}</div>
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

            {eveningDefinition?.enabled && todayMode === "day" ? (
              <EveningReviewSection
                kind="compact"
                run={latestEveningRun}
                locale={locale}
                targetTime={targetTimeFor(eveningDefinition, "evening")}
                onFeedbackChanged={() =>
                  void queryClient.invalidateQueries({
                    queryKey: queryKeys.briefings.runs(eveningDefinition.id)
                  })
                }
              />
            ) : null}

            {eveningDefinition?.enabled && todayMode === "evening" ? (
              <EveningPrepCard
                interviewPending={eveningInterviewMutation.isPending}
                onPrep={() => {
                  // #891: open the drawer immediately (like the topbar chat button and
                  // openChatWith) rather than waiting for the seed POST to resolve.
                  // Previously openChat lived in the mutation's onSuccess, so a slow or
                  // failing /api/chat/evening-interview left the button doing nothing —
                  // the drawer never opened. The seeded turn streams into the now-open
                  // drawer via the global chat SSE stream.
                  chatControls.openChat();
                  eveningInterviewMutation.mutate();
                }}
              />
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
          </div>
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
                timeZone={locale.timezone}
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
  const locale = useUserLocale();
  const [optimisticDone, setOptimisticDone] = useState(task.status === "done");
  const done = optimisticDone;
  const drift = driftOf(task, locale.timezone);
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
          {task.dueAt ? (
            <span className="jds-task__time">{shortDate(task.dueAt, locale)}</span>
          ) : null}
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
