# What's New in Jarvis

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
