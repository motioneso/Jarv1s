# Jarv1s Development Standards

Date: 2026-06-06

Jarv1s uses a strict maintainability bar based on the `thermo-nuclear-code-quality-review` standard. Passing tests is required, but it is not enough. A change should leave the codebase simpler to reason about, not merely working.

## Approval Bar

A change is not ready if it introduces any clear structural regression:

- preserves incidental complexity when a simpler model could delete it
- adds ad-hoc branches, scattered special cases, or mode flags into unrelated flows
- leaks feature logic into shared infrastructure or the wrong package boundary
- adds thin wrappers, identity abstractions, or cast-heavy contracts that obscure the real invariant
- duplicates an existing canonical helper instead of reusing or improving it
- makes orchestration more sequential or less atomic without a clear reason
- pushes a file from under 1000 lines to over 1000 lines without a strong structural justification

Treat these as presumptive blockers until the author can justify them clearly.

## Required Checks

Run the maintainability gate before broad feature work is considered ready:

```txt
pnpm lint
pnpm format:check
pnpm check:file-size
pnpm typecheck
```

`pnpm verify:foundation` includes these checks before migrations and integration tests.

## Structural Standard

Be ambitious about simplification. Look for restructurings that preserve behavior while making the implementation dramatically smaller, more direct, and more obvious.

Prefer changes that delete complexity:

- reframe the state model so conditionals disappear
- move logic to the package, module, or layer that owns the concept
- collapse duplicate branches into one explicit flow
- extract focused helpers or modules when a file starts mixing concerns
- replace condition chains with a typed model or dispatcher when that makes the flow clearer
- delete wrappers or generic mechanisms that do not earn their indirection

Do not accept a refactor that only moves complexity around.

## File Size

Do not let a PR push a file from below 1000 lines to above 1000 lines without a very strong reason.

Crossing that threshold is a code-quality smell by default. Prefer decomposing into focused modules, helpers, subcomponents, repositories, services, or test fixtures before allowing the file to sprawl. A waiver requires a compelling structural reason and the resulting file must still be easy to scan.

The 1000-line threshold is not a target. Files should be much smaller when the domain naturally decomposes.

## Branching And Spaghetti

Be highly suspicious of new one-off conditionals in existing flows. If a change adds special cases in random places, treat that as a design problem.

Prefer:

- a dedicated abstraction, policy object, state machine, or module
- a clearer default flow with fewer exceptions
- a typed boundary that makes invalid states unrepresentable
- a pure helper when the same condition appears in multiple places

Do not normalize temporary branching that is likely to become permanent debt.

## Types And Boundaries

Prefer explicit contracts over loosely shaped objects.

Push back on:

- unnecessary `any`, `unknown`, casts, nullable modes, and optional parameters
- silent fallbacks that hide unclear invariants
- feature-specific objects crossing shared API boundaries
- repository or worker code bypassing canonical context wrappers

If the type boundary is fuzzy, make the invariant explicit instead of papering over it with runtime branching.

## Canonical Layers

Keep logic where the architecture says it belongs.

- Protected data access goes through `AccessContext`, `withDataContext()`, and repositories that require `DataContextDb`.
- Module-owned behavior belongs in the owning module unless it is a declared public API or event.
- Shared packages should contain general primitives, not product-specific special cases.
- Worker jobs carry metadata only and enter the normal data context before touching protected data.

When a change needs a helper, search for the canonical helper first. Do not create a near-duplicate.

## Review Order

When reviewing changes, prioritize findings in this order:

1. Structural code-quality regressions
2. Missed opportunities for dramatic simplification
3. Spaghetti or branching complexity increases
4. Boundary, abstraction, and type-contract problems
5. File-size and decomposition concerns
6. Modularity and abstraction issues
7. Legibility and maintainability concerns

Keep review comments focused on high-conviction issues. Do not flood a review with cosmetic notes when the real issue is structural.
