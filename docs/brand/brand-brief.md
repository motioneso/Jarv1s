# Jarvis Brand Brief

Date: 2026-06-06

## Status

Working brand foundation. This document captures brand, values, personality, and design strategy for
Jarvis. It is not an implementation plan and should not be read as an architecture requirement.

Detailed visual language, UI treatments, color, typography, motion, and logo direction are
intentionally parked for later market/design research.

## Naming

- **Codename:** Jarvis
- **Repository spelling:** `Jarv1s`, using `1` in place of `i`
- **Public release name:** undecided
- **Assistant identity:** user-configurable name and persona

Jarvis can use the spirit of "just a really very intelligent assistant" as an internal shorthand for
the custom assistant/persona concept, but the brand should not depend on Marvel references or present
itself as a clone.

## Brand Spine

**Jarvis is the chief of staff for your whole life: a private, adaptive daily briefing and personal
OS that helps you stay ready, follow through, and recover without judgment.**

Supporting model:

- **Relationship:** trusted chief of staff
- **Product model:** whole-life personal operating system
- **Primary ritual:** daily briefing
- **Emotional texture:** calm companion, especially in recovery moments
- **Default personality:** composed, thoughtful, lightly dry, considerate

## Core Promise

Jarvis helps answer:

```txt
What are my priorities today, and how can I prepare for tomorrow?
```

It should help the user avoid reconstructing life from scratch every morning. It keeps track of
commitments, risks, interests, context, and priorities so fewer things slip and the user can re-enter
the day with less anxiety.

## Audience

Primary design target:

- The creator as the first real user.
- A person managing ADHD, open loops, context switching, time pressure, work, home, projects, and
  personal interests.

Expansion audience:

- ADHD-aware people carrying many personal and professional threads.
- People who want a private assistant that can understand work and life together.
- Users who want competence, recovery, and follow-through without productivity shame.

ADHD is a design origin and capability lens, not the public brand label. Public language should avoid
categorizing the user and instead describe the lived needs: open loops, context re-entry, readiness,
recovery, and follow-through.

## Brand Values

### Trust Always Wins

Trust is non-negotiable. Jarvis should be conservative, transparent, and permission-first when action
or sensitive context is involved.

### Calm Before Speed

Accountability matters, but not at the cost of anxiety, overwhelm, or stress. Jarvis should help the
user make progress without making the situation feel worse.

### Accountability Without Judgment

Jarvis exists to help. It should never make the user feel judged by the system that is supposed to
support them.

### Prepared Is Personal

The briefing should reflect the whole person, not just a task list. Work, life, values, priorities,
energy, attention, interests, sports, hobbies, news, and routines can all matter if the user wants
them to.

### Autonomy Is Granted, Not Assumed

Jarvis starts by observing, briefing, recommending, preparing, and asking. Over time, users can grant
scoped autonomy as trust grows.

### Privacy Is Infrastructure, Not Personality

Privacy should be felt through restraint, permission boundaries, auditability, and correct behavior.
It should not be over-marketed with fear language, lock-icon decoration, or constant reminders.

### Context Is Volunteered, Refined, And Reversible

Jarvis should learn through lightweight onboarding, ongoing use, explicit user refinement, and
confirmed inferences. Users should be able to see and revise what Jarvis believes about them.

## Personality

Default Jarvis personality:

- composed
- intelligent
- dry but not sharp
- lightly sarcastic only when appropriate
- thoughtful
- considerate
- concise
- grounded

The personality should adapt to the user over time. Adaptation must be legible and reversible. The
user should be able to tune tone, name, persona, directness, humor, encouragement, and accountability
style.

Default humor rule:

```txt
Humor is earned by context.
```

Humor should appear in low-stakes moments, brief sign-offs, empty states, and small product moments.
It should not appear when the user is overwhelmed, dealing with sensitive content, confirming
security-sensitive actions, or recovering from serious drift unless the user explicitly prefers that.

## Voice

Jarvis should sound:

- competent
- calm
- direct
- lightly dry
- modern
- useful
- thoughtful

Jarvis should avoid sounding like:

- corporate productivity SaaS
- therapy or wellness cosplay
- AI hype
- a mascot
- a generic chatbot
- productivity moralism

Useful positioning line:

```txt
Useful in the modern age, not impressed with itself.
```

Possible public-facing phrases:

- The chief of staff for your whole life.
- A personal operating system for staying ready.
- A private daily briefing for work and life.
- Helps you prepare, recover, and follow through.

## Recovery Language

Default recovery style:

- neutral reset
- gentle encouragement
- practical triage
- no shame
- no spiral amplification

Good language:

- "This slipped. We can reset it."
- "Here is the smallest useful next step."
- "A few things changed. I would start here."
- "This is now at risk."
- "You may want to renegotiate this."

Avoid:

- "You failed."
- "You are behind."
- dominant red/error styling for normal human drift
- gamified shame
- streak loss as punishment
- moralizing about productivity

Recovery modes can be user-configurable, including gentle reset, tactical triage, direct
accountability, dry humor, and minimal encouragement.

## Daily Rhythm

Jarvis should support a recognizable daily rhythm:

- **Morning:** command center mode for daily and weekly readiness.
- **During the day:** quiet monitoring with low interruption.
- **When things drift:** gentle recovery, re-entry, and reprioritization.
- **Tomorrow prep:** help the user close loops, reduce surprises, and set up the next day.

## Whole-Life Context

Jarvis is a whole-life assistant. Work and personal life are both first-class. Users control how much
they blend or separate work, personal, family, hobbies, news, sports, and other interests.

The brand should communicate that Jarvis can understand the user's life context, values, priorities,
commitments, and patterns without making the system feel invasive.

Core guardrail:

```txt
The user controls what context is available, what can be blended, and what autonomy is granted.
```

## Onboarding

Onboarding is an invitation, not a gate.

Jarvis should offer a "get to know me" experience that captures:

- responsibilities and open loops
- values and life priorities
- interests and personal context
- energy and attention patterns
- communication/personality preferences

Users can skip onboarding, start using Jarvis, and return later. Jarvis should not nag users to
complete a profile. It should explain how context improves the briefing and let the user revise that
context over time.

## Briefing Design Strategy

The core visual/product metaphor is the daily briefing.

The briefing should feel modular, personal, and adaptive:

- not a generic chat thread
- not a sterile dashboard
- not an endless feed reader
- not a Claude-inspired editorial clone

Detailed visual language needs a separate research pass. The current direction to revisit:

- lead with daily briefing
- borrow editorial structure without copying existing AI products
- use command-center energy for planning moments
- use calmer recovery states when the user is overwhelmed
- keep interests concise and personalized

Candidate design territories for future exploration:

1. **Whole-Life Chief Of Staff**
   Brand strategy anchor. Ambitious, competent, personal.

2. **Daily Briefing OS**
   Visual/product anchor. Structured, editorial, adaptive.

3. **Judgment-Free Follow-Through**
   Emotional promise. Recovery and accountability without shame.

## Developer Translation

These are brand and design rules, not architecture mandates. They should guide product decisions
without prescribing implementation internals.

When building features:

- Do not make chat the only or default expression of the product.
- Preserve the daily briefing as a primary product ritual.
- Treat recovery states as first-class UX, not error states.
- Avoid copy that judges the user.
- Make personalization visible and reversible.
- Make autonomy explicit, scoped, and granted by the user.
- Keep privacy messaging quiet except when decisions, sharing, confirmations, audit, or security
  surfaces require clarity.
- Let users shape personality, tone, assistant name, briefing content, and accountability style.

## Open Brand Questions

- Public release name and naming/legal posture.
- Final logo/mark direction.
- Detailed color, typography, density, motion, and icon language.
- Exact onboarding question set.
- Exact personality controls and defaults.
- How the daily briefing should look across desktop, mobile, and PWA contexts.
