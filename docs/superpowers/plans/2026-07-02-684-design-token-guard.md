# Plan: 684 Design Token Guard (Revised)

## 1. Replace Phantom Tokens & Fix Guards

Canonical replacements for all current phantom and undefined tokens:

- **`apps/web/src/wellness/manage-meds-modal.tsx`**: Replace `var(--color-error, #e53e3e)` with `var(--danger)` for borders and `var(--danger-fg)` for text color.
- **`apps/web/src/settings/settings-personal-panes.tsx`**: Replace `var(--color-error)` with `var(--danger-fg)` (for text).
- **`apps/web/src/settings/settings-people-pane.tsx`**: Replace `var(--color-border)` with `var(--border)`.
- **`apps/web/src/settings/settings-activity-pane.tsx`**: Replace `var(--jds-border)` with `var(--border)`.
- **`apps/web/src/styles/settings-panes-2.css`**: Replace `var(--surface-warning, var(--surface-2))` with `var(--warn-soft)`.
- **`apps/web/src/styles/kit-today-misc.css`**: Replace `var(--surface-warn, var(--surface-2))` with `var(--warn-soft)` and `var(--border-warn, var(--border-subtle))` with `var(--warn)`.
- **`apps/web/src/styles/onboarding.css`**: Replace `var(--warning-soft, var(--pine-soft))` with `var(--warn-soft)` and `var(--warning-fg, var(--accent))` with `var(--warn-fg)`.
- **`apps/web/src/tasks/tasks.css`**: Replace `var(--text-main)` with `var(--text)`.

No new tokens will be added to `tokens.css` as existing ones adequately express the required roles.

## 2. Enhance Token Guard (`scripts/check-design-tokens.ts`)

- **Extend File Coverage**: Update `walk` to process `.css`, `.ts`, and `.tsx` files.
- **Parse Definitions**: Read and parse `apps/web/src/styles/tokens.css` dynamically to build a `Set` of all valid `--*` tokens.
- **Enforce Usage**: Scan files for `var(--xyz)` usages using a regex and flag any `--xyz` that is not in the valid Set.
- **Allowlist**: Maintain a tiny, explicit allowlist array in the script for any necessary exemptions (e.g., specific external lib tokens), keeping it as strict as possible.

## 3. Concrete Negative Check

- **Implementation**: Add an explicit self-check test block directly inside `scripts/check-design-tokens.ts`.
- **Behavior**: Before processing real files, the script will invoke its checking logic against a hardcoded mock string containing `var(--intentionally-undefined-test-var)`. It will assert that exactly one violation is produced. If the self-test fails to catch the missing token, the script will instantly throw an error and exit `1`. This guarantees the regex and parser are functional before every run.
