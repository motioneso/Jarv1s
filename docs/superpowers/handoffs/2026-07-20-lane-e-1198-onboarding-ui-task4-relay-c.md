# Lane E #1198 onboarding UI — Task 4 relay (c)

Same worktree/branch (`feat/1198-onboarding-ui`), do not create a new one. Supervisor: pane
label `Coord 1193 Supervisor 5` — re-resolve fresh via `herdr pane list`, never reuse a pane_id
from any doc. No push/PR without explicit supervisor grant.

Full Task 4 assertion list + Task 5 gate command block: read relay (b)
(`docs/superpowers/handoffs/2026-07-20-lane-e-1198-onboarding-ui-task4-relay-b.md`) — unchanged,
still authoritative. Don't re-read the design mockup or plan beyond that; everything needed from
them is captured below (extracted via targeted `grep`, not a full read).

## State

HEAD `74832a6d` — RED Step 0 composition test committed and confirmed RED for the right reason
(`activeControl` is `undefined`, not an import/syntax error):
`tests/unit/job-search-web-onboarding.test.tsx`, describe block "Job Search onboarding
composition (#1198 Task 4 Step 0)".

**Uncommitted:** `index.tsx` has new imports added (not yet used) —
`CritiqueCard, MultiControl, RESUME_ACCEPT, MAX_RESUME_BYTES, ResumeDropzone, SourcesControl,
Summary, SourcesSelection` from `./controls`, `parseCompensation` from `./model`. Will fail
lint/typecheck until the body below is wired — that's expected, finish the wiring first.

## Step 0 wiring plan (fully worked out — implement directly, no more research)

In `JobsOnboarding`'s render (replace the bare `<Surface composer={{placeholder:...}}/>`):
```
const phase = derivePhase(outcome.data.snapshot);
return <Surface
  localRows={buildLocalRows(phase, outcome.data)}
  activeControl={buildActiveControl(phase, outcome.data, props.handle)}
  composer={{ placeholder: "Tell us more", onSubmitText: buildComposerSubmit(phase, props.handle) }}
  typing={phase === "resume_critique"}
/>;
```
(`buildComposerSubmit` already exported/unused at index.tsx:189-198 — just wire it.)

**Phase → activeControl:**
- `resume_intake`: `<ResumeDropzone showPaste={showPaste} error={resumeError} onFile={onFile} onPaste={onPaste} />` (local `useState` for `resumeError`/`showPaste`, both start `null`/`false`).
  - `onFile(file)`: validate `RESUME_ACCEPT` (mime or `/\.(pdf|docx)$/i` on filename) and `file.size <= MAX_RESUME_BYTES` — invalid → `setResumeError(...)`, `setShowPaste(true)`, return (never upload). Valid → `try { const u = await handle.uploadAttachment(file); await handle.submitTurn({text: u.fileName, attachmentIds:[u.id], controlContext:{step:"resume_intake", action:"upload", fileName: u.fileName}}); } catch { setResumeError(...); setShowPaste(true); }`
  - `onPaste(text)`: `handle.submitTurn({text, controlContext:{step:"resume_intake", action:"paste"}})` — assistant turn only, never a module-web write (Task 4 requirement).
- `resume_critique`: `null` (transient — AI is drafting the critique; `typing` prop covers it).
- `resume_approval`: two inline `jds-btn` buttons (NOT a new exported control — plain composition, matches every other control's own button markup): "Looks right — use it" → `handle.submitTurn({text:"Looks right — use it", controlContext:{step:"resume_approval", action:"approve"}})`; "Let's refine it" → same shape with `action:"deny"`. (No dedicated confirm/yes-no component exists in `controls.tsx` or `kit.tsx` — checked both; this was a judgment call, not an escalation, since it's two buttons not a new abstraction. Flag to supervisor in report if they want it as a real exported control instead.)
- `titles|comp|workmode|locations|dealbreakers`: `MultiControl`, values from `outcome.data.snapshot.profileProgress.fields` where already set, else the mockup's seed defaults below. `onSubmit` → `props.handle.submitTurn(buildProfileSubmit(phase, {...}))` (already exported, index.tsx:164-177).
  - titles: `options=["Staff Product Designer","Principal Designer","Design Engineer"]`, `initial=["Staff Product Designer","Principal Designer"]`, `inferred=["Design Engineer"]`, `addPlaceholder="Add a title"`, `cta="Track these titles"`, `min=1`. Submit: `{targetTitles: values}`.
  - comp: `options=["$175k","$195k","$215k"]`, `addPlaceholder="Enter an amount"`, `cta="Set comp floor"`, `min=1`. Submit: take `values[0]`, `parseCompensation(value)` (already handles `$`/commas) → `{compensation}` (skip if null).
  - workmode: `options=["Remote-first","Hybrid ok","On-site ok"]`, `cta="Continue"`, `min=1`. Submit: `{remotePreference: values}`.
  - locations: `options=["Remote — US","San Francisco, CA"]`, `initial=["Remote — US"]`, `addPlaceholder="Add a location"`, `cta="Search these"`, `min=1`. Submit: `{locations: values}`.
  - dealbreakers: `options=["On-site 5 days/week","Below comp floor","No equity"]`, `initial=["On-site 5 days/week","Below comp floor"]`, `addPlaceholder="Add a dealbreaker"`, `cta="Set dealbreakers"`, `skip="None of these"` (no `min`). Submit: `{dealbreakers: values}`.
- `sources_schedule`: `<SourcesControl sources={outcome.data.sources} initialRunTime="07:00" onSubmit={(sel) => props.handle.submitTurn({text: "<names> · <dueTime>", controlContext:{step:"sources_schedule", action:"schedule", boards: sel.boards, dueTime: sel.dueTime}})} />`. Track `sel.dueTime` in local state for `done`'s `Summary`.
- `done`: `<Summary runTime={dueTimeState ?? "07:00"} onContinue={() => window.location.reload()} onReset={() => props.handle.submitTurn({text:"Start over", controlContext:{step:"done", action:"reset"}})} />`.

**localRows** (scripted copy, verbatim from the mockup, extracted via grep at
`docs/superpowers/design/job-search-onboarding/JobsOnboarding.jsx.txt:261-337` — do not re-read
the file, this is complete):
- resume_intake (2 rows): "I'll get your job search set up — should take a couple of minutes, and you can change any of it later just by asking." / "Let's start with your resume. Drop it in and I'll read it: I'll pull out the strengths I can actually stand behind and store an approved copy to score matches against. I never apply on your behalf."
- resume_approval: append one row whose `content` is `<CritiqueCard summary={resume.critiqueSummary ?? ""} strengths={(resume.evidence ?? []).map(e => e.claimText)} cautions={[]} />` (backend never persists unsupported claims — truth-guard invariant, confirmed via `worker/handlers/resume.ts` + `domain/truth-guard.ts` — so `cautions` is always `[]`, not an omission).
- titles: "Good. From your resume, here are the titles I'd track. Keep the ones that fit, drop what doesn't, add anything I missed."
- comp: "What's your base comp floor? Below this I won't waste your time surfacing anything."
- workmode: "And how do you want to work?"
- locations: "Where should I look? Add any regions or cities — I'll take remote as global unless you tell me otherwise."
- dealbreakers: "Last thing about the role itself — anything that's an automatic no? A match that trips any of these gets filtered out before it reaches you."
- sources_schedule: "Now the sources. I'll check these boards every morning — they're read-only public APIs, so I read postings and score them but never submit anything. Adjust the boards or the run time."
- done (2 rows): "That's everything I need. Monitoring is on and your first run is queued for {runTime} — I'll scan, score against your profile, and bring the credible matches into your morning briefing." / "You can change any of this later just by telling me. Ready when you are."

Build `buildLocalRows(phase, data)` by walking a `PHASE_ORDER` array (`resume_intake,
resume_critique, resume_approval, titles, comp, workmode, locations, dealbreakers,
sources_schedule, done`) up to and including the current phase index, emitting each prior/current
phase's row(s) above (skip `resume_critique`, it has no copy of its own) with stable ids like
`${phase}-0`.

## After wiring

1. `pnpm vitest run tests/unit/job-search-web-onboarding.test.tsx -t "composition"` → GREEN. Commit
   small (`feat(job-search): wire onboarding Step 0 phase/control composition`).
2. Continue relay (b)'s next steps 5-9 unchanged: fix `js06-module-surface.spec.ts:291-305`'s
   first-run assertion → commit; RED `tests/e2e/js1198-job-search-onboarding.spec.ts` skeleton →
   commit the moment it's RED for the right reason; fixtures → all 3 e2e specs green → commit
   (`test(job-search): cover guided onboarding flow`, exact body in relay (b)); full Task 5 gate,
   all commands exit 0; report gate-ready to `Coord 1193 Supervisor 5` (re-resolved fresh) with
   full commit list + command evidence, including the resume_approval judgment call above.

## Constraints (unchanged)

DB-less only, no `verify:foundation`. Read plan/spec BY SECTION only if you truly need something
not already captured above — the phase/copy/control mapping here is complete, don't re-derive it.
