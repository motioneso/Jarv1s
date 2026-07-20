# Build Handoff — #1185 News caption/excerpt polish

**Spec (approved):** `docs/superpowers/specs/2026-07-19-1185-news-caption-excerpt.md`  
**GitHub issue:** #1185  
**Risk tier:** `routine`  
**Worktree:** `~/Jarv1s/.claude/worktrees/feedback-1185-news-layout`  
**Branch:** `feedback/1185-news-layout`, based on the live `coord/1179-pdf` staging branch  
**Build skill:** `~/Jarv1s/.claude/skills/coordinated-build/SKILL.md`  
**Coordinator:** label `Coordinator`, session `019f7c33-1d00-76c3-97ae-b637ff77faa9`

## Build contract

1. Run `[ -d node_modules ] || pnpm install`.
2. Follow `coordinated-build`; send the smallest plan to the Coordinator before editing.
3. Prefer the CSS-only fix: bind the existing image/kicker adjacency, remove the text-only clamp,
   and match Sports top spacing. Do not add a content field, parser, component abstraction, or image
   pipeline.
4. Add only the smallest structural regression check justified by the existing test seam.
5. Use explicit-path staging only. Never edit `docs/coordination/`, run repo-wide formatting, merge,
   or resolve Agentation comments.

## Collision notes

- #1190 owns future News topic behavior. Do not touch topic state/navigation.
- #1182 is fully parallel and has no shared files.
- A separate low-cost visual-QA agent will test desktop/narrow layout and click story links on `5178`;
  do not claim live acceptance from CSS or unit tests.
