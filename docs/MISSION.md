# Jarv1s Mission

Jarv1s is a **privacy-first, self-hostable AI personal assistant OS** built around your own
knowledge and life.

## What it does

Jarv1s is grounded in **your vault of notes** — the accumulated record of your work, projects,
commitments, relationships, and areas of life. From that foundation it:

- Gives you **daily briefings** that cut through noise and surface what actually matters today.
- Tracks your **commitments and tasks** across all life areas, watching for drift before it becomes
  a problem.
- Monitors your **mental and physical wellbeing** so you can see patterns over time.
- Connects to your **calendar and email** so context is always current.
- Acts as a **capable assistant** that knows your context — with a confirmation gate on every
  action so you stay in control.

## What it isn't

Jarv1s is not a general-purpose chatbot or a cloud service. It runs on your infrastructure, keeps
your data private by default, and never sends private content to an AI provider without your
explicit configuration. Every AI capability is BYO-provider: you bring your own API key or run a
local model. Nothing is hardcoded to a single vendor.

## Design principles

- **Private by default.** Data is owner-only unless you explicitly share it. No admin bypass.
- **Modular.** Every product surface is a module following the same SDK contract — built-in and
  future modules are peers.
- **Spec before build.** Every milestone begins with a written design spec and exits only when
  tests pass and invariants hold.
- **Provider-agnostic AI.** Features request capabilities; the capability router selects your
  configured model. Provider-specific code is extension, not core.

## The honest acceptance test

Jarv1s is working when you genuinely use the morning briefing — grounded in your real vault,
synthesized by a real model, useful enough that you'd miss it if it stopped.
