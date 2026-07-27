# Awaiting Ben — parking lot

Decisions that need Ben and must not be silently resolved by an agent. Coordinator keeps this
current; nothing here blocks the #1264/#1265 lanes.

_Last updated: 2026-07-27, during epic #1262 (module self-operation)._

## 1. #1263 merged under verbal delegation — please confirm after the fact

Ben said "I need to sleep, lets push to get this completed without me". PR #1268 was squash-merged
as `73e50847` on that basis, **not on a fresh approval**. The limit held: merge GREEN only, never
lower the bar. Worth a retroactive nod so the record is unambiguous, and worth deciding whether the
same delegation extends to #1264 and #1265 (both also `security` tier).

## 2. Task decomposition sizing — the one real process question

#1263 took **three relays on a single task**. That is the signature of tasks decomposed past what
one context can hold, not of an agent underperforming. Options: smaller task units, fatter handoffs,
or accept relays as normal cost. This is a judgement call about how the fleet is run, so it is yours.

## 3. #1266 — user-facing "always confirm" override for any granted permission

**Deliberately not spawned.** It has no approved spec, and "spec before build" is a hard gate. It is
also the natural counterpart to what #1263 shipped: users can currently promote a `user_promotable`
tool, but there is no single switch to demand the prompt back across the board. Needs your call on
whether it gets a spec now or waits until #1264/#1265 land.

## 3b. Digest settings — the #1264 spec contradicts itself, and I stopped rather than pick

**Blocking one item of #1264 only; the rest of that lane is proceeding.**

The settings spec says two incompatible things about digest:

- line 42 classifies **digest settings** as `granted_at_install` ("unscheduling and rescheduling
  delivery jobs is symmetric"),
- line 82 lists **digest scheduling** under exclusion category 7, external effect,

and the shipped denylist implements line 82 — `settings.digest.` is a centrally excluded prefix at
`packages/ai/src/gateway/self-operation.ts:153`. A tool named `settings.digest.*` is therefore
unreachable by the assistant no matter what tier it declares.

The build agent proposed naming it `settings.notificationDigest.*` instead. **I refused.** The
denylist is prefix-matched on the tool name, so a rename resolves a security exclusion by choosing a
different string — if that works, the denylist is decorative. Narrowing the prefix to
`settings.digest.schedule.` is the honest version of the same move, but it loosens a security control,
which is your call and not one I will make while you are asleep.

So digest is **dropped from #1264's scope** and everything else in the round-one classification
proceeds. Your options when you pick this up: (a) leave digest excluded and delete it from the spec's
`granted_at_install` list, (b) split the prefix so digest *configuration* is reachable while digest
*scheduling* stays excluded, or (c) decide the whole external-effect category is over-broad. My read
is (b) is what the spec intended, but it needs you to say so.

## 4. #1267 — external-module tools cannot declare an action family

Out of scope for the whole of epic #1262 and **needs its own spec**. Today an external write tool
with no family always confirms (`packages/ai/src/gateway/policy.ts:40`), so the current behaviour is
safe-by-default, not broken — it just means an external module can never be granted anything.

## 5. `web.read` still asks every time — by design, but the design is missing

`web.read` is `confirm_always` at `risk: "write"` with no action family. It is the deliberate fifth
exception, kept that way because reading a URL carries open-internet content into a conversation
that can already see private data, and it is the subject of an open v0.1.0 security-audit finding.
Nothing in the approved design covers web research. Changing it needs its own spec first.

## 6. Dev-instance config gaps (not code defects)

- `ai.service_bindings.module.news` has no json/economy model bound, so news topic/source add
  returns 503 "Topic checking unavailable".
- `onboarding.state` was flagged touched-but-unverified during the #1263 run — worth one manual pass.
- Standing item from memory: flip `JARVIS_EMBED_PROVIDER` from `stub` to `local`.
