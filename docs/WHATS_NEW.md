# What's New in Jarvis

## Latest delivery — 2026-07-20

### Guided Job Search onboarding

Job Search now opens as a guided flow inside Jarvis, with dedicated search screens and an embedded
assistant. Reloading restores the profile step you were on instead of sending you back to the start.

[PR #1204](https://github.com/motioneso/Jarv1s/pull/1204) · [PR #1209](https://github.com/motioneso/Jarv1s/pull/1209) · [PR #1212](https://github.com/motioneso/Jarv1s/pull/1212) · [PR #1214](https://github.com/motioneso/Jarv1s/pull/1214) · [PR #1215](https://github.com/motioneso/Jarv1s/pull/1215)

---

### Attach files and screenshots in chat

You can attach files or paste screenshots directly into the chat drawer, keeping supporting material
with the conversation instead of describing it separately.

[PR #1156](https://github.com/motioneso/Jarv1s/pull/1156)

---

### Finance reports that understand transfers

The Finance module now produces spending, cash-flow, and net-worth reports and automatically pairs
transfers so moving money between accounts does not look like income or spending.

[PR #1163](https://github.com/motioneso/Jarv1s/pull/1163) · [PR #1173](https://github.com/motioneso/Jarv1s/pull/1173)

---

### Jarvis knows which screen you are viewing

Jarvis can now use the current page and app context when answering, making in-app help more relevant
without requiring you to explain where you are first.

[PR #1126](https://github.com/motioneso/Jarv1s/pull/1126)

---

### Weekly delivery reports

A scheduled weekly report now summarizes what shipped, giving you a compact record of recent product
changes without manually reviewing individual pull requests.

[PR #1129](https://github.com/motioneso/Jarv1s/pull/1129)

---

### More resilient live chat

Live chat now recovers from stale sessions, and multiline pasted messages no longer trigger false
delivery failures or attachment-turn errors.

[PR #1160](https://github.com/motioneso/Jarv1s/pull/1160) · [PR #1172](https://github.com/motioneso/Jarv1s/pull/1172) · [PR #1175](https://github.com/motioneso/Jarv1s/pull/1175)

---

### Easier module setup

Settings now shows credential controls for registry-installed modules, so required connections are
visible where you manage the module instead of appearing to be missing.

[PR #1178](https://github.com/motioneso/Jarv1s/pull/1178)

---

## App-grounded help — 2026-07-16

Jarvis can now look up shipped screens, settings, prerequisites, and named fixes from the app's
build artifact. This entry is a narrative summary only; the generated app map remains the
authority for behavior and remediation.

---

## Second run — 2026-06-29

### Your timezone, everywhere (first slice)

Dates and times in chat answers, wellness history, and briefings now render in your configured
timezone instead of UTC. If you are in Auckland and set your timezone to Pacific/Auckland, Jarvis
answers "what's on my calendar tomorrow" and streak counts in wellness use your local midnight, not
the server's. More display surfaces are in progress — this is the first slice of a broader rollout.

[PR #596](https://github.com/motioneso/Jarv1s/pull/596) · closes part of [#579](https://github.com/motioneso/Jarv1s/issues/579)

---

### Cleaner Evening review

The Sources freshness list has been removed from the Evening review. The review itself is unchanged;
it just no longer appends a block of data-staleness details that most people skip past.

[PR #595](https://github.com/motioneso/Jarv1s/pull/595) · [#586](https://github.com/motioneso/Jarv1s/pull/586)

---

### Briefings list their actual sources

The briefings settings page now shows the real names of the sources feeding each briefing instead of
a bare count like "3 sources". You can see at a glance exactly which email accounts, calendars, or
note folders are included.

[PR #594](https://github.com/motioneso/Jarv1s/pull/594) · closes [#506](https://github.com/motioneso/Jarv1s/issues/506)

---

### Mobile menu always reachable

The user menu is now visible on mobile without scrolling. Previously it could scroll off screen on
smaller viewports and become inaccessible.

[PR #591](https://github.com/motioneso/Jarv1s/pull/591) · closes [#524](https://github.com/motioneso/Jarv1s/issues/524)

---

### Wellness notes reach Jarvis

Free-text notes you add during a wellness check-in are now visible to Jarvis when you ask about
your wellbeing or patterns. The wellness export modal and export action are also fixed so your
check-in data downloads correctly.

[PR #582](https://github.com/motioneso/Jarv1s/pull/582) · closes [#505](https://github.com/motioneso/Jarv1s/issues/505) [#509](https://github.com/motioneso/Jarv1s/issues/509)

---

### Cleaner chat actions

The approve/reject confirmation buttons in chat now have correct spacing and labels. The Today view
no longer shows a medication nudge that was not relevant to most users.

[PR #581](https://github.com/motioneso/Jarv1s/pull/581) · closes [#480](https://github.com/motioneso/Jarv1s/issues/480) [#512](https://github.com/motioneso/Jarv1s/issues/512)

---

### Paste a Coolors palette to stage it immediately

In Appearance settings, pasting a Coolors URL or colour list now auto-stages the colours
immediately. The separate "Stage colors" step is gone — paste and the preview updates straight away.

[PR #598](https://github.com/motioneso/Jarv1s/pull/598)

---

## Overnight build — 2026-06-28

### Delete calendar events

Jarvis can now remove events from your calendar, not just read them. Ask it to cancel a meeting,
clear a block, or tidy up stale events and it will handle the deletion directly.

[PR #569](https://github.com/motioneso/Jarv1s/pull/569) · closes [#557](https://github.com/motioneso/Jarv1s/issues/557)

---

### Automatic commitment extraction

When you get an email confirming a dinner, accept a meeting invite, or jot a note with a deadline,
Jarvis now notices and surfaces it as a commitment — no manual entry needed. It watches your email,
calendar, and notes and pulls out things you have agreed to do or attend.

[PR #570](https://github.com/motioneso/Jarv1s/pull/570) · closes [#537](https://github.com/motioneso/Jarv1s/issues/537)

---

### Source-backed answers

Jarvis answers now show where the information came from. When it tells you about a meeting, a
message, or a note, it cites the specific source so you can trace the reasoning and verify it
yourself.

[PR #571](https://github.com/motioneso/Jarv1s/pull/571) · closes [#539](https://github.com/motioneso/Jarv1s/issues/539)

---

### Data freshness indicator

The chat footer now shows how current the data behind each answer is. If Jarvis is drawing on a
sync from two hours ago you can see that at a glance, so you know when a quick manual refresh
would give you a more accurate picture.

[PR #572](https://github.com/motioneso/Jarv1s/pull/572) · closes [#541](https://github.com/motioneso/Jarv1s/issues/541)

---

### Automation audit log

Every action Jarvis takes on your behalf — sending a message, creating a task, running a job — is
now recorded in an audit log. You can review what ran, when, and why, and the log is available for
export if you ever need to check what happened.

[PR #573](https://github.com/motioneso/Jarv1s/pull/573) · closes [#540](https://github.com/motioneso/Jarv1s/issues/540)

---

### People knowledge graph

Jarvis now builds a personal contact model from your data. It links the same person across emails,
calendar events, and notes, resolves duplicates, and gives you seven new tools to query it: find a
person, list their recent interactions, see shared context, and more. The more you use Jarvis, the
richer the picture it builds of the people you work and communicate with.

[PR #574](https://github.com/motioneso/Jarv1s/pull/574) · closes [#538](https://github.com/motioneso/Jarv1s/issues/538)
