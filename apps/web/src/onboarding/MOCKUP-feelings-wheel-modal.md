# Mockup / scope note — feelings-wheel modal (NOT in this slice)

**Status:** intentionally NOT built in Phase 4 secondary-user onboarding.

The Phase-4 secondary-user-onboarding spec
(`docs/superpowers/specs/2026-06-13-p4-secondary-user-onboarding-design.md`) does NOT include
a Wellness module, a feelings-wheel modal, check-ins, medications, surfacing tools, or a
readiness signal. There is no approved Wellness spec, so per the CLAUDE.md "Spec before build"
hard gate, none of that may be built here.

In this slice, "Wellness" appears only as:

1. One informational line in the client-only `SectionTourStep` — and that line is OMITTED
   client-side if no wellness module/route exists (it does not exist as of this slice).
2. A DEFERRED multi-user-isolation test case (spec §Open risks "Wellness surface assumption"):
   the wellness isolation assertion is skipped/commented until a wellness module ships with
   real owner-scoped tables.

If/when a Wellness module is specced and built (its own milestone + spec), a feelings-wheel
modal mockup belongs in THAT plan, not here.
