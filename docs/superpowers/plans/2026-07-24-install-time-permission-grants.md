# Install-Time Permission Grants — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop Jarvis raising an Approve/Deny card for every ordinary write a module makes doing its own declared job, while keeping a hard confirm on destructive, outbound, and consequential calls — then make JS-03 (#1234) conform so its UAT is friction-free.

**Architecture:** Consent moves to install time. A module earns silent writes only by _explicitly_ declaring an action family with `defaultTier: "trusted_auto"` **and** marking the tool `executionPolicy: "auto"` — a greppable, reviewable pair of lines in its manifest. Today external modules cannot do this at all: `assistantActionFamilies` sits in `FORBIDDEN_FIELDS` (rejected at validation) and the external tool adapter drops `actionFamilyId`/`executionPolicy` on the floor, so every external write tool falls through `resolvePolicy` to `confirm`. This plan promotes action families to a positively-validated first-class external surface, passes the policy fields through the adapter, adds a declarative `confirmWhen`/`confirmWhenKeys` form (JSON manifests cannot carry a TS predicate), and adds a `risk: "outbound"` class.

**Tech Stack:** TypeScript (strict), pnpm workspaces, Vitest (unit), Playwright (e2e), Fastify.

**Spec:** `docs/superpowers/specs/2026-07-24-install-time-permission-grants.md` (Approved 2026-07-24)
**Issue:** #1246 (task). Blocks JS-03 (#1234).
**Branch:** `build/js-03-perms`, forked from `build/js-03-build` so the platform change and JS-03's conformance land together.

## Global Constraints

- **Never weaken authorization.** This changes a UX gate only. RLS, `DataContextDb`, owner-only-by-default are untouched. A silently-run write is still RLS-scoped to the actor.
- **No blanket write default.** A write tool with no `actionFamilyId`, or whose family is absent/unresolvable, **still confirms**. Silent writes are opt-in per tool, never by omission.
- **Stored user prefs always win.** The grant applies only when the per-user pref at `assistant.action_policy.v1.${moduleId}.${familyId}` is absent. Existing code already does `tier ?? manifest.defaultTier` — do not change that precedence.
- **Precedence in `resolvePolicy`:** `destructive` > `outbound` > `requiresConfirmation(input)` > `write`.
- **`confirmWhen` semantics are input-only key/value presence.** The hook never sees stored KV, so it detects a field's presence/value _in this call_, not a _flip_ from a stored value. Module guidance must tell the LLM to include such fields only when actually changing them.
- **No admin/RLS bypass, secrets never escape, metadata-only job payloads** — repo hard invariants, unchanged.
- File-size gate caps every source file at 1000 lines (`pnpm check:file-size`). `validate.ts` is ~700 lines; if Task 3 pushes it near the cap, extract the new validator into a sibling file rather than trimming logic.
- Full gate: `pnpm verify:foundation` on a **fresh** gate DB (drop/create before running — a prior run's uat-seed rows break the next).

## File Structure

**Modify:**

- `packages/module-sdk/src/index.ts` — risk enum, `defaultTier` widening, external tool declaration fields, `JsonJarvisModuleManifest.assistantActionFamilies`, new `ExternalModuleConfirmWhenClause`.
- `packages/ai/src/gateway/policy.ts` — `outbound` → confirm.
- `packages/module-registry/src/external/validate.ts` — promote `assistantActionFamilies` out of `FORBIDDEN_FIELDS` with positive validation; accept `outbound`; validate the new tool fields and the auto-grant coupling rule.
- `packages/module-registry/src/external/tool-manifests.ts` — pass `actionFamilyId`/`executionPolicy` through, synthesize `requiresConfirmation`, surface `assistantActionFamilies` on the produced manifest.
- `external-modules/job-search/jarvis.module.json` — declare the family, mark the three write tools, add `confirmWhen`/`confirmWhenKeys`, rewrite onboarding guidance.

**Create:**

- `tests/unit/external-module-action-families.test.ts` — validation of the new external surface.
- `tests/unit/external-module-tool-manifest-policy.test.ts` — adapter pass-through + `confirmWhen` synthesis.

**Modify (tests):**

- `tests/unit/gateway-policy.test.ts` — `outbound`, `trusted_auto` defaultTier, stored-pref veto.
- `tests/unit/external-module-job-search-manifest.test.ts` — JS-03 conformance.
- `tests/e2e/job-search-profile-builder.spec.ts` — assert zero approval cards for ordinary fields.

---

### Task 1: SDK types for the grant

**Files:**

- Modify: `packages/module-sdk/src/index.ts:18` (risk enum), `:26` (`defaultTier`), `:695-703` (`ExternalModuleAssistantToolDeclaration`), `:740-780` (`JsonJarvisModuleManifest`)
- Test: `tests/unit/gateway-policy.test.ts` (compile-time consumer; Task 2 asserts behaviour)

**Interfaces:**

- Consumes: nothing (first task).
- Produces: `ModuleAssistantToolRisk` including `"outbound"`; `ExternalModuleConfirmWhenClause { key: string; equals: string | number | boolean }`; `ExternalModuleAssistantToolDeclaration` gaining optional `actionFamilyId`, `executionPolicy`, `confirmWhen`, `confirmWhenKeys`; `JsonJarvisModuleManifest` gaining optional `assistantActionFamilies`; `ModuleAssistantActionFamilyManifest.defaultTier` widened to `JarvisActionPermissionTier`.

- [ ] **Step 1: Widen the risk enum**

In `packages/module-sdk/src/index.ts`, replace line 18:

```ts
export type ModuleAssistantToolRisk = "read" | "write" | "destructive";
```

with:

```ts
/**
 * #1246: `outbound` is a first-class risk class, not a manifest flag, so `resolvePolicy`
 * stays a single declarative switch and the class flows into audit rows. An outbound tool
 * touches the world beyond the user's own data — sends mail, spends money, shares off-box —
 * and ALWAYS confirms, even under an install-time grant. A tool that both sends and writes
 * declares `outbound`.
 *
 * Honesty gap (logged, not solved here): module workers have full Node network access, so
 * this label is honor-system today. Near-term mitigation is the first-party review gate;
 * the long-term follow-up is tying network egress to declared `outbound` tools.
 */
export type ModuleAssistantToolRisk = "read" | "write" | "destructive" | "outbound";
```

- [ ] **Step 2: Widen `defaultTier` so a module can declare an install-time grant**

Replace line 26 (`readonly defaultTier: "ask_each_time" | "always_confirm";`) inside `ModuleAssistantActionFamilyManifest` with:

```ts
  /**
   * #1246: deliberately re-opened to include `trusted_auto`. This previously excluded it to
   * enforce "modules cannot self-default to auto". We reverse that ONLY behind the explicit,
   * greppable pair — family `defaultTier: "trusted_auto"` AND tool `executionPolicy: "auto"` —
   * which validate.ts enforces for external modules. A stored per-user tier still overrides
   * this (see resolvePolicy: `tier ?? manifest.defaultTier`), so the user always keeps the veto.
   */
  readonly defaultTier: JarvisActionPermissionTier;
```

- [ ] **Step 3: Add the declarative confirm clause type**

Immediately above `export interface ExternalModuleAssistantToolDeclaration {` (line ~695), insert:

```ts
/**
 * #1246: declarative stand-in for `requiresConfirmation`. External modules ship a JSON
 * manifest, which cannot carry a TS predicate, but some calls must confirm even under an
 * install-time grant (activation, data-at-rest changes). The host synthesizes a real
 * `requiresConfirmation` from these in tool-manifests.ts.
 *
 * Semantics are INPUT-ONLY presence/value: the hook never sees stored KV, so this detects
 * "this call carries status=active", not "status changed to active". Module guidance must
 * instruct the model to include such fields only when actually changing them.
 */
export interface ExternalModuleConfirmWhenClause {
  readonly key: string;
  readonly equals: string | number | boolean;
}
```

- [ ] **Step 4: Add the policy fields to the external tool declaration**

Inside `ExternalModuleAssistantToolDeclaration`, after `readonly risk: ModuleAssistantToolRisk;`, add:

```ts
  /** #1246: opts this tool into an install-time grant. Must name a family declared in
   *  `assistantActionFamilies`; validated in module-registry/src/external/validate.ts. */
  readonly actionFamilyId?: string;
  /** #1246: required (with a trusted_auto family) for the tool to run without a card. */
  readonly executionPolicy?: ModuleAssistantToolExecutionPolicy;
  /** #1246: confirm when the call carries this key AND it equals this value. */
  readonly confirmWhen?: readonly ExternalModuleConfirmWhenClause[];
  /** #1246: confirm when the call carries this key at all, whatever the value. */
  readonly confirmWhenKeys?: readonly string[];
```

- [ ] **Step 5: Allow external manifests to declare families**

Inside `JsonJarvisModuleManifest`, after `readonly assistantTools?: ...` (line ~761), add:

```ts
  /**
   * #1246: action families an external module declares, promoted out of FORBIDDEN_FIELDS
   * and positively validated in validate.ts. Without this an external module could never
   * qualify for an install-time grant, so every one of its write tools confirmed forever.
   */
  readonly assistantActionFamilies?: readonly ModuleAssistantActionFamilyManifest[];
```

- [ ] **Step 6: Typecheck**

Run: `cd /home/ben/Jarv1s/.claude/worktrees/js-03-perms && pnpm typecheck`
Expected: PASS. If `defaultTier` widening breaks a built-in manifest that relied on the narrow type, that is a genuine site to inspect — built-ins keep `ask_each_time`/`always_confirm`; do not flip any built-in to `trusted_auto` in this task.

- [ ] **Step 7: Commit**

```bash
cd /home/ben/Jarv1s/.claude/worktrees/js-03-perms
git add packages/module-sdk/src/index.ts
git commit -m "feat(module-sdk): types for install-time permission grants (#1246)"
```

---

### Task 2: `resolvePolicy` honors `outbound`

**Files:**

- Modify: `packages/ai/src/gateway/policy.ts:29-57`
- Test: `tests/unit/gateway-policy.test.ts`

**Interfaces:**

- Consumes: `ModuleAssistantToolRisk` with `"outbound"`, widened `defaultTier` (Task 1).
- Produces: `resolvePolicy(tool, moduleId, input, lookup): Promise<"run" | "confirm">` — unchanged signature; `outbound` now always confirms, and a family whose resolved tier is `trusted_auto` (whether from a stored pref or from `defaultTier`) plus `executionPolicy: "auto"` returns `run`.

- [ ] **Step 1: Write the failing tests**

Append inside the existing `describe("gateway policy resolver", …)` block in `tests/unit/gateway-policy.test.ts`:

```ts
it("outbound tools always confirm, even under a trusted_auto grant", async () => {
  const tool: ModuleAssistantToolManifest = {
    name: "mock.send",
    description: "Send something outward",
    permissionId: "mock.send",
    actionFamilyId: "mock_family",
    risk: "outbound",
    executionPolicy: "auto",
    inputSchema: {},
    outputSchema: {},
    execute: async () => ({ data: {} })
  };
  const manifest: ModuleAssistantActionFamilyManifest = {
    ...baseManifest,
    defaultTier: "trusted_auto",
    allowedTiers: ["ask_each_time", "trusted_auto"]
  };
  const decision = await resolvePolicy(
    tool,
    "mock_module",
    {},
    createMockLookup("trusted_auto", manifest)
  );
  expect(decision).toBe("confirm");
});

it("install grant: family defaultTier trusted_auto + auto + no stored pref runs silently", async () => {
  const tool: ModuleAssistantToolManifest = {
    name: "mock.write",
    description: "Ordinary declared write",
    permissionId: "mock.write",
    actionFamilyId: "mock_family",
    risk: "write",
    executionPolicy: "auto",
    inputSchema: {},
    outputSchema: {},
    execute: async () => ({ data: {} })
  };
  const manifest: ModuleAssistantActionFamilyManifest = {
    ...baseManifest,
    defaultTier: "trusted_auto",
    allowedTiers: ["ask_each_time", "trusted_auto"]
  };
  // null tier = user has expressed no preference → the install grant applies.
  const decision = await resolvePolicy(tool, "mock_module", {}, createMockLookup(null, manifest));
  expect(decision).toBe("run");
});

it("a stored ask_each_time pref vetoes the install grant", async () => {
  const tool: ModuleAssistantToolManifest = {
    name: "mock.write",
    description: "Ordinary declared write",
    permissionId: "mock.write",
    actionFamilyId: "mock_family",
    risk: "write",
    executionPolicy: "auto",
    inputSchema: {},
    outputSchema: {},
    execute: async () => ({ data: {} })
  };
  const manifest: ModuleAssistantActionFamilyManifest = {
    ...baseManifest,
    defaultTier: "trusted_auto",
    allowedTiers: ["ask_each_time", "trusted_auto"]
  };
  const decision = await resolvePolicy(
    tool,
    "mock_module",
    {},
    createMockLookup("ask_each_time", manifest)
  );
  expect(decision).toBe("confirm");
});

it("requiresConfirmation still beats the install grant", async () => {
  const tool: ModuleAssistantToolManifest = {
    name: "mock.write",
    description: "Ordinary declared write",
    permissionId: "mock.write",
    actionFamilyId: "mock_family",
    risk: "write",
    executionPolicy: "auto",
    requiresConfirmation: (input) => input.status === "active",
    inputSchema: {},
    outputSchema: {},
    execute: async () => ({ data: {} })
  };
  const manifest: ModuleAssistantActionFamilyManifest = {
    ...baseManifest,
    defaultTier: "trusted_auto",
    allowedTiers: ["ask_each_time", "trusted_auto"]
  };
  expect(
    await resolvePolicy(tool, "mock_module", { status: "active" }, createMockLookup(null, manifest))
  ).toBe("confirm");
  expect(
    await resolvePolicy(tool, "mock_module", { titles: ["x"] }, createMockLookup(null, manifest))
  ).toBe("run");
});
```

- [ ] **Step 2: Run to verify the outbound test fails**

Run: `pnpm vitest run tests/unit/gateway-policy.test.ts`
Expected: the `outbound` test FAILS (currently `outbound` is not special-cased, so it falls through to the family branch and returns `run`). The other three should already pass — they encode behaviour the existing resolver has once Task 1's types allow `trusted_auto` as a `defaultTier`. If any of those three fails, stop and read the resolver before changing it.

- [ ] **Step 3: Add the outbound branch**

In `packages/ai/src/gateway/policy.ts`, replace the doc comment and the first three guards of `resolvePolicy`:

```ts
/**
 * Reads run. Writes default to confirm unless the owning module explicitly
 * declares auto agency (or tier = trusted_auto) and the user promoted that module. Destructive tools
 * always confirm — as does any write tool whose `requiresConfirmation(input)` hook returns true
 * for this specific call, even when the tool's family has been promoted to trusted_auto.
 */
```

with:

```ts
/**
 * Decides whether a tool call runs silently or raises an Approve/Deny card.
 *
 * #1246 (install-time permission grants): consent lives at install, so a module doing its own
 * declared job on the user's own data runs silently — but ONLY when it explicitly opted in
 * (family + `executionPolicy: "auto"`). Precedence, highest first:
 *
 *   destructive > outbound > requiresConfirmation(input) > write
 *
 * A familyless write, or one whose family manifest is missing, still confirms — silent writes
 * are never granted by omission. A stored per-user tier always overrides the module's
 * `defaultTier`, so the user keeps both the promotion and the veto.
 */
```

Then, inside the function, replace:

```ts
if (tool.risk === "read") return "run";
if (tool.risk === "destructive") return "confirm";
if (tool.requiresConfirmation?.(input) === true) return "confirm";
```

with:

```ts
if (tool.risk === "read") return "run";
if (tool.risk === "destructive") return "confirm";
// #1246: outbound touches the world beyond the user's own data — an install grant never
// covers it, so this sits above the requiresConfirmation/family branches.
if (tool.risk === "outbound") return "confirm";
if (tool.requiresConfirmation?.(input) === true) return "confirm";
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run tests/unit/gateway-policy.test.ts`
Expected: PASS, all cases.

- [ ] **Step 5: Commit**

```bash
git add packages/ai/src/gateway/policy.ts tests/unit/gateway-policy.test.ts
git commit -m "feat(ai): outbound risk class and install-grant policy resolution (#1246)"
```

---

### Task 3: Promote `assistantActionFamilies` to a validated external surface

**Files:**

- Modify: `packages/module-registry/src/external/validate.ts` (FORBIDDEN_FIELDS ~line 58; assistantTools validation ~lines 421-450; manifest return ~lines 660-685)
- Test: `tests/unit/external-module-action-families.test.ts` (create)

**Interfaces:**

- Consumes: Task 1's `ExternalModuleConfirmWhenClause`, widened `defaultTier`, `JsonJarvisModuleManifest.assistantActionFamilies`.
- Produces: `validateExternalModuleManifest` accepting a well-formed `assistantActionFamilies` array and the four new tool fields, and returning them on the validated manifest. Rejects: unknown `actionFamilyId`, `executionPolicy: "auto"` without a `trusted_auto`-allowing family, `defaultTier` outside `allowedTiers`, malformed clauses.

- [ ] **Step 1: Find and update any test asserting the field is forbidden**

Run: `grep -rn "assistantActionFamilies" tests/ packages/module-registry/src/external/*.test.ts 2>/dev/null`
Any existing test asserting rejection of `assistantActionFamilies` encodes the old rule and must be **retargeted**, not deleted — change it to assert that a _malformed_ families block is rejected. Note what you changed in the commit body.

- [ ] **Step 2: Write the failing tests**

Create `tests/unit/external-module-action-families.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { validateExternalModuleManifest } from "../../packages/module-registry/src/external/validate.js";

// #1246: external modules must be able to declare action families — without this every
// external write tool falls through resolvePolicy to "confirm" forever.
const base = {
  schemaVersion: 1,
  id: "demo",
  name: "Demo",
  version: "0.1.0",
  publisher: "Test",
  lifecycle: "optional",
  compatibility: { jarv1s: ">=0.1.0" },
  runtime: { workerEntrypoint: "dist/worker.js", workerContractVersion: 1 }
};

const family = {
  id: "demo_changes",
  label: "Demo changes",
  description: "Demo writes its own records in your private workspace.",
  defaultTier: "trusted_auto",
  allowedTiers: ["ask_each_time", "trusted_auto", "always_confirm"]
};

const grantedTool = {
  name: "demo.update",
  permissionId: "demo.update",
  description: "Update a demo record.",
  risk: "write",
  actionFamilyId: "demo_changes",
  executionPolicy: "auto",
  inputSchema: { type: "object", additionalProperties: false },
  handler: "demo.update"
};

describe("external module action families (#1246)", () => {
  it("accepts a well-formed families block and returns it on the manifest", () => {
    const result = validateExternalModuleManifest({
      ...base,
      assistantActionFamilies: [family],
      assistantTools: [grantedTool]
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.manifest.assistantActionFamilies).toHaveLength(1);
    expect(result.manifest.assistantActionFamilies?.[0]?.defaultTier).toBe("trusted_auto");
    expect(result.manifest.assistantTools?.[0]?.actionFamilyId).toBe("demo_changes");
    expect(result.manifest.assistantTools?.[0]?.executionPolicy).toBe("auto");
  });

  it("rejects a tool naming a family that was never declared", () => {
    const result = validateExternalModuleManifest({
      ...base,
      assistantTools: [grantedTool]
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join(" ")).toContain("demo_changes");
  });

  it("rejects executionPolicy auto when the family does not allow trusted_auto", () => {
    const result = validateExternalModuleManifest({
      ...base,
      assistantActionFamilies: [
        { ...family, defaultTier: "ask_each_time", allowedTiers: ["ask_each_time"] }
      ],
      assistantTools: [grantedTool]
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join(" ")).toContain("trusted_auto");
  });

  it("rejects a defaultTier outside allowedTiers", () => {
    const result = validateExternalModuleManifest({
      ...base,
      assistantActionFamilies: [{ ...family, allowedTiers: ["ask_each_time"] }],
      assistantTools: [grantedTool]
    });
    expect(result.ok).toBe(false);
  });

  it("accepts risk outbound and declarative confirm clauses", () => {
    const result = validateExternalModuleManifest({
      ...base,
      assistantActionFamilies: [family],
      assistantTools: [
        {
          ...grantedTool,
          risk: "outbound",
          confirmWhen: [{ key: "status", equals: "active" }],
          confirmWhenKeys: ["vaultEnabled"]
        }
      ]
    });
    expect(result.ok).toBe(true);
  });

  it("rejects a malformed confirmWhen clause", () => {
    const result = validateExternalModuleManifest({
      ...base,
      assistantActionFamilies: [family],
      assistantTools: [{ ...grantedTool, confirmWhen: [{ key: "status" }] }]
    });
    expect(result.ok).toBe(false);
  });
});
```

- [ ] **Step 3: Run to verify they fail**

Run: `pnpm vitest run tests/unit/external-module-action-families.test.ts`
Expected: FAIL — the first test fails because `assistantActionFamilies` is currently in `FORBIDDEN_FIELDS` and rejected outright.

- [ ] **Step 4: Remove the field from the forbidden list**

In `packages/module-registry/src/external/validate.ts`, delete the line `  "assistantActionFamilies",` from `FORBIDDEN_FIELDS` (~line 58), and update the block comment above the list to record the promotion, matching how prior slices documented theirs:

```ts
// Every field of the compiled JarvisModuleManifest that carries executable behavior
// or a UI/data surface. Presence of ANY of these in an external manifest is a
// rejection. `auth`/`storage`/`web` are first-class as of #918 Slice 2, `database` as
// of #964, `navigation` as of #1019, and `assistantActionFamilies` as of #1246 (each
// validated positively below) and are deliberately absent from this list.
```

- [ ] **Step 5: Add the families validator**

Add this function next to the other `validate*` helpers in the same file:

```ts
const PERMISSION_TIERS: readonly JarvisActionPermissionTier[] = [
  "ask_each_time",
  "trusted_auto",
  "always_confirm"
];

/**
 * #1246: action families are the ONLY way an external module can earn silent writes, so
 * validate them positively and strictly. The security-relevant rule is the coupling check
 * in validateAssistantToolPolicy below: a `trusted_auto` default is inert unless a tool
 * also declares `executionPolicy: "auto"`, and that pairing is what a reviewer greps for.
 */
function validateActionFamilies(
  raw: unknown,
  errors: string[]
): readonly ModuleAssistantActionFamilyManifest[] | undefined {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw) || raw.length === 0) {
    errors.push("assistantActionFamilies must be a non-empty array");
    return undefined;
  }
  const families: ModuleAssistantActionFamilyManifest[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      errors.push("assistantActionFamilies entries must be objects");
      continue;
    }
    const family = entry as Record<string, unknown>;
    if (!isNonEmptyString(family.id) || !MODULE_ID_RE.test(family.id as string)) {
      errors.push("action family id must be a lowercase kebab/alphanumeric slug");
      continue;
    }
    if (seen.has(family.id as string)) {
      errors.push(`duplicate action family id: ${family.id as string}`);
      continue;
    }
    seen.add(family.id as string);
    if (!isNonEmptyString(family.label) || !isNonEmptyString(family.description)) {
      errors.push(`action family ${family.id as string} needs a label and description`);
      continue;
    }
    if (
      !Array.isArray(family.allowedTiers) ||
      family.allowedTiers.length === 0 ||
      !family.allowedTiers.every((t) => PERMISSION_TIERS.includes(t as JarvisActionPermissionTier))
    ) {
      errors.push(`action family ${family.id as string} has invalid allowedTiers`);
      continue;
    }
    if (!PERMISSION_TIERS.includes(family.defaultTier as JarvisActionPermissionTier)) {
      errors.push(`action family ${family.id as string} has an invalid defaultTier`);
      continue;
    }
    // A default the family itself forbids would be silently unreachable — reject it loudly.
    if (!(family.allowedTiers as readonly unknown[]).includes(family.defaultTier)) {
      errors.push(`action family ${family.id as string} defaultTier must appear in allowedTiers`);
      continue;
    }
    families.push({
      id: family.id as string,
      label: family.label as string,
      description: family.description as string,
      defaultTier: family.defaultTier as JarvisActionPermissionTier,
      allowedTiers: family.allowedTiers as readonly JarvisActionPermissionTier[]
    });
  }
  return families.length > 0 ? families : undefined;
}

/**
 * #1246: per-tool policy fields. Enforces that a tool can only reference a family the
 * manifest actually declares, and that `executionPolicy: "auto"` (the silent-write request)
 * is backed by a family permitting `trusted_auto`. Without this coupling a module could ask
 * for auto execution against a family that can never grant it and look granted at a glance.
 */
function validateAssistantToolPolicy(
  tool: Record<string, unknown>,
  families: readonly ModuleAssistantActionFamilyManifest[] | undefined,
  errors: string[]
): void {
  const familyId = tool.actionFamilyId;
  if (familyId !== undefined) {
    if (!isNonEmptyString(familyId)) {
      errors.push("assistant tool actionFamilyId must be a non-empty string");
    } else {
      const family = families?.find((f) => f.id === familyId);
      if (!family) {
        errors.push(`assistant tool references undeclared action family: ${familyId}`);
      } else if (tool.executionPolicy === "auto" && !family.allowedTiers.includes("trusted_auto")) {
        errors.push(
          `assistant tool executionPolicy "auto" requires family ${familyId} to allow trusted_auto`
        );
      }
    }
  }
  if (tool.executionPolicy !== undefined) {
    if (tool.executionPolicy !== "auto" && tool.executionPolicy !== "confirm") {
      errors.push('assistant tool executionPolicy must be "auto" or "confirm"');
    } else if (tool.executionPolicy === "auto" && familyId === undefined) {
      errors.push('assistant tool executionPolicy "auto" requires an actionFamilyId');
    }
  }
  if (tool.confirmWhenKeys !== undefined) {
    if (
      !Array.isArray(tool.confirmWhenKeys) ||
      !tool.confirmWhenKeys.every((k) => isNonEmptyString(k))
    ) {
      errors.push("assistant tool confirmWhenKeys must be an array of non-empty strings");
    }
  }
  if (tool.confirmWhen !== undefined) {
    if (!Array.isArray(tool.confirmWhen)) {
      errors.push("assistant tool confirmWhen must be an array");
    } else {
      for (const clause of tool.confirmWhen) {
        if (!clause || typeof clause !== "object" || Array.isArray(clause)) {
          errors.push("assistant tool confirmWhen entries must be objects");
          continue;
        }
        const c = clause as Record<string, unknown>;
        const valueType = typeof c.equals;
        if (
          !isNonEmptyString(c.key) ||
          !(valueType === "string" || valueType === "number" || valueType === "boolean")
        ) {
          errors.push(
            "assistant tool confirmWhen entries need key:string and equals:string|number|boolean"
          );
        }
      }
    }
  }
}
```

Import `JarvisActionPermissionTier` and `ModuleAssistantActionFamilyManifest` as types at the top of the file alongside the existing `@jarv1s/module-sdk` type imports.

- [ ] **Step 6: Wire the validators in and accept `outbound`**

Near the start of the manifest validation body (before the `assistantTools` block at ~line 421), add:

```ts
const assistantActionFamilies = validateActionFamilies(obj.assistantActionFamilies, errors);
```

At ~line 446, replace the risk check:

```ts
        if (tool.risk !== "read" && tool.risk !== "write" && tool.risk !== "destructive") {
          errors.push('assistant tool risk must be "read", "write", or "destructive"');
```

with:

```ts
        if (
          tool.risk !== "read" &&
          tool.risk !== "write" &&
          tool.risk !== "destructive" &&
          tool.risk !== "outbound"
        ) {
          errors.push(
            'assistant tool risk must be "read", "write", "destructive", or "outbound"'
          );
```

Then, inside the same per-tool loop after the risk check, add:

```ts
validateAssistantToolPolicy(tool, assistantActionFamilies, errors);
```

- [ ] **Step 7: Return the families on the validated manifest**

In the manifest return object (~line 675), immediately after the `assistantTools` spread, add:

```ts
    ...(assistantActionFamilies !== undefined ? { assistantActionFamilies } : {}),
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `pnpm vitest run tests/unit/external-module-action-families.test.ts`
Expected: PASS, all six cases.

- [ ] **Step 9: Check the file-size gate**

Run: `pnpm check:file-size`
Expected: PASS. If `validate.ts` now exceeds 1000 lines, move both new functions into `packages/module-registry/src/external/validate-action-policy.ts`, export them, and import them back — do not shrink the validation to fit.

- [ ] **Step 10: Commit**

```bash
git add packages/module-registry/src/external/validate.ts tests/unit/external-module-action-families.test.ts
git commit -m "feat(module-registry): validate external action families and tool policy (#1246)"
```

---

### Task 4: Adapter passes policy through and synthesizes `requiresConfirmation`

**Files:**

- Modify: `packages/module-registry/src/external/tool-manifests.ts`
- Test: `tests/unit/external-module-tool-manifest-policy.test.ts` (create)

**Interfaces:**

- Consumes: Tasks 1 and 3.
- Produces: `createExternalToolManifests(discoveries, invoke)` emitting `JarvisModuleManifest[]` whose tools carry `actionFamilyId`, `executionPolicy`, and a synthesized `requiresConfirmation`, and whose manifest carries `assistantActionFamilies` (so chat's `getFamilyManifest`, which reads `manifest.assistantActionFamilies` via `resolveActiveModules`, can resolve them).

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/external-module-tool-manifest-policy.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { createExternalToolManifests } from "../../packages/module-registry/src/external/tool-manifests.js";

// #1246: before this, the adapter mapped only name/description/permissionId/risk/schemas,
// so external tools reached resolvePolicy with no actionFamilyId and ALWAYS confirmed.
const discovery = {
  id: "demo",
  manifest: {
    schemaVersion: 1 as const,
    id: "demo",
    name: "Demo",
    version: "0.1.0",
    publisher: "Test",
    lifecycle: "optional" as const,
    compatibility: { jarv1s: ">=0.1.0" },
    runtime: { workerEntrypoint: "dist/worker.js", workerContractVersion: 1 },
    assistantActionFamilies: [
      {
        id: "demo_changes",
        label: "Demo changes",
        description: "Demo writes its own records.",
        defaultTier: "trusted_auto" as const,
        allowedTiers: ["ask_each_time", "trusted_auto"] as const
      }
    ],
    assistantTools: [
      {
        name: "demo.update",
        permissionId: "demo.update",
        description: "Update a demo record.",
        risk: "write" as const,
        actionFamilyId: "demo_changes",
        executionPolicy: "auto" as const,
        confirmWhen: [{ key: "status", equals: "active" }],
        confirmWhenKeys: ["vaultEnabled"],
        inputSchema: { type: "object" },
        handler: "demo.update"
      }
    ]
  }
} as never;

const invoke = async () => ({ data: {} });

describe("external tool manifest policy mapping (#1246)", () => {
  const [manifest] = createExternalToolManifests([discovery], invoke);
  const tool = manifest?.assistantTools?.[0];

  it("surfaces action families on the produced manifest", () => {
    expect(manifest?.assistantActionFamilies).toHaveLength(1);
    expect(manifest?.assistantActionFamilies?.[0]?.id).toBe("demo_changes");
  });

  it("passes actionFamilyId and executionPolicy through", () => {
    expect(tool?.actionFamilyId).toBe("demo_changes");
    expect(tool?.executionPolicy).toBe("auto");
  });

  it("synthesizes requiresConfirmation from confirmWhen", () => {
    expect(tool?.requiresConfirmation?.({ status: "active" })).toBe(true);
    expect(tool?.requiresConfirmation?.({ status: "building" })).toBe(false);
  });

  it("synthesizes requiresConfirmation from confirmWhenKeys on presence alone", () => {
    expect(tool?.requiresConfirmation?.({ vaultEnabled: false })).toBe(true);
    expect(tool?.requiresConfirmation?.({ vaultEnabled: true })).toBe(true);
  });

  it("leaves ordinary field updates unconfirmed", () => {
    expect(tool?.requiresConfirmation?.({ titles: ["Staff Engineer"] })).toBe(false);
  });

  it("omits requiresConfirmation when a tool declares no clauses", () => {
    const plain = structuredClone(discovery) as never as typeof discovery;
    // @ts-expect-error test fixture mutation
    delete plain.manifest.assistantTools[0].confirmWhen;
    // @ts-expect-error test fixture mutation
    delete plain.manifest.assistantTools[0].confirmWhenKeys;
    const [m] = createExternalToolManifests([plain], invoke);
    expect(m?.assistantTools?.[0]?.requiresConfirmation).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm vitest run tests/unit/external-module-tool-manifest-policy.test.ts`
Expected: FAIL — `actionFamilyId`, `executionPolicy`, `requiresConfirmation`, and `assistantActionFamilies` are all currently dropped by the adapter.

- [ ] **Step 3: Implement the mapping**

Replace the whole body of `packages/module-registry/src/external/tool-manifests.ts` below the imports with:

```ts
export type ExternalToolInvoker = (
  module: ExternalModuleDiscovery,
  tool: ExternalModuleAssistantToolDeclaration,
  input: ToolInput,
  context: ToolContext
) => Promise<ToolResult>;

/**
 * #1246: build the host-side `requiresConfirmation` predicate a JSON manifest cannot express.
 *
 * Semantics are INPUT-ONLY. The hook never sees stored KV, so `confirmWhenKeys` fires on the
 * key being PRESENT in this call — not on it changing value. That is deliberate and is why
 * module guidance must tell the model to send such fields only when actually changing them:
 * a false negative here would silently skip a confirm the user is entitled to.
 */
function synthesizeRequiresConfirmation(
  tool: ExternalModuleAssistantToolDeclaration
): ((input: ToolInput) => boolean) | undefined {
  const clauses = tool.confirmWhen ?? [];
  const keys = tool.confirmWhenKeys ?? [];
  if (clauses.length === 0 && keys.length === 0) return undefined;
  return (input: ToolInput): boolean => {
    for (const key of keys) {
      if (Object.hasOwn(input, key)) return true;
    }
    for (const clause of clauses) {
      if (Object.hasOwn(input, clause.key) && input[clause.key] === clause.equals) return true;
    }
    return false;
  };
}

export function createExternalToolManifests(
  discoveries: readonly ExternalModuleDiscovery[],
  invoke: ExternalToolInvoker
): JarvisModuleManifest[] {
  return discoveries
    .filter((module) => module.manifest.runtime && module.manifest.assistantTools?.length)
    .map((module) => ({
      id: module.id,
      name: module.manifest.name,
      version: module.manifest.version,
      publisher: module.manifest.publisher,
      lifecycle: module.manifest.lifecycle,
      compatibility: module.manifest.compatibility,
      assistantOnboarding: module.manifest.assistantOnboarding,
      // #1246: chat's getFamilyManifest resolves families off the ACTIVE MODULE MANIFEST
      // (packages/chat/src/routes.ts). Dropping this here is what made every external write
      // tool unresolvable — and therefore permanently confirm-gated.
      ...(module.manifest.assistantActionFamilies
        ? { assistantActionFamilies: module.manifest.assistantActionFamilies }
        : {}),
      availability: {
        defaultEnabled: false,
        supportsUserDisable: module.manifest.lifecycle === "user-toggleable"
      },
      assistantTools: module.manifest.assistantTools?.map((tool) => {
        const requiresConfirmation = synthesizeRequiresConfirmation(tool);
        return {
          name: tool.name,
          description: tool.description,
          permissionId: tool.permissionId,
          risk: tool.risk,
          // #1246: these two together are the install-time grant. Validation (validate.ts)
          // guarantees the family exists and permits trusted_auto before we get here.
          ...(tool.actionFamilyId ? { actionFamilyId: tool.actionFamilyId } : {}),
          ...(tool.executionPolicy ? { executionPolicy: tool.executionPolicy } : {}),
          ...(requiresConfirmation ? { requiresConfirmation } : {}),
          inputSchema: tool.inputSchema,
          outputSchema: tool.outputSchema,
          execute: (_scopedDb, input, context) => invoke(module, tool, input, context)
        };
      })
    }));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run tests/unit/external-module-tool-manifest-policy.test.ts`
Expected: PASS, all six cases.

- [ ] **Step 5: Commit**

```bash
git add packages/module-registry/src/external/tool-manifests.ts tests/unit/external-module-tool-manifest-policy.test.ts
git commit -m "feat(module-registry): map action policy through the external tool adapter (#1246)"
```

---

### Task 5: JS-03 conformance — job-search declares its grant

**Files:**

- Modify: `external-modules/job-search/jarvis.module.json`
- Test: `tests/unit/external-module-job-search-manifest.test.ts`

**Interfaces:**

- Consumes: Tasks 1, 3, 4.
- Produces: a job-search manifest whose three write tools (`job-search.profile.update`, `job-search.resume.intake`, `job-search.resume.critique`) run silently, while `status: "active"` and any `vaultEnabled` key still confirm.

- [ ] **Step 1: Write the failing tests**

Append to `tests/unit/external-module-job-search-manifest.test.ts` (match the file's existing manifest-loading helper — reuse it rather than re-reading the JSON a second way):

```ts
// #1246: the JS-03 UAT raised a card per profile field. These assertions are the
// regression guard for the install-time grant.
it("declares an action family that permits silent core writes", () => {
  const families = manifest.assistantActionFamilies ?? [];
  expect(families).toHaveLength(1);
  expect(families[0]?.id).toBe("profile_changes");
  expect(families[0]?.defaultTier).toBe("trusted_auto");
  expect(families[0]?.allowedTiers).toContain("trusted_auto");
});

it("marks every write tool for auto execution under that family", () => {
  const writes = (manifest.assistantTools ?? []).filter((t) => t.risk === "write");
  expect(writes.length).toBeGreaterThan(0);
  for (const tool of writes) {
    expect(tool.actionFamilyId).toBe("profile_changes");
    expect(tool.executionPolicy).toBe("auto");
  }
});

it("still forces a confirm on activation and vault changes", () => {
  const update = (manifest.assistantTools ?? []).find(
    (t) => t.name === "job-search.profile.update"
  );
  expect(update?.confirmWhen).toEqual([{ key: "status", equals: "active" }]);
  expect(update?.confirmWhenKeys).toEqual(["vaultEnabled"]);
});

it("no longer instructs the model to wait for approval cards", () => {
  const guidance = manifest.assistantOnboarding?.guidance ?? "";
  expect(guidance).not.toContain("wait for the card");
  expect(guidance).not.toContain("needs the user's approval");
  expect(guidance).not.toContain("never retry a denied write");
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm vitest run tests/unit/external-module-job-search-manifest.test.ts`
Expected: FAIL — the manifest declares no families and its guidance still contains the card language.

- [ ] **Step 3: Declare the action family**

In `external-modules/job-search/jarvis.module.json`, insert immediately before `"assistantTools": [`:

```json
  "assistantActionFamilies": [
    {
      "id": "profile_changes",
      "label": "Job-search profile updates",
      "description": "Save your resume and job-search profile details in your own private workspace.",
      "defaultTier": "trusted_auto",
      "allowedTiers": ["ask_each_time", "trusted_auto", "always_confirm"]
    }
  ],
```

- [ ] **Step 4: Mark the three write tools**

For `job-search.profile.update`, `job-search.resume.intake`, and `job-search.resume.critique`, add these two fields immediately after each tool's `"risk": "write",` line:

```json
      "actionFamilyId": "profile_changes",
      "executionPolicy": "auto",
```

- [ ] **Step 5: Keep the consequential calls gated**

For `job-search.profile.update` **only**, add after its `"executionPolicy": "auto",` line:

```json
      "confirmWhen": [{ "key": "status", "equals": "active" }],
      "confirmWhenKeys": ["vaultEnabled"],
```

- [ ] **Step 6: Rewrite the onboarding guidance**

Replace the entire `assistantOnboarding.guidance` string with:

```
Start every Job Search conversation with: Let's get your resume solid first. Guide resume intake before profile details, then build the search profile through a soft, tangent-friendly interview. The onboarding state lists saved profiles and each profile's completeness; notice the unfilled fields and steer back to one of them after following a tangent. As the user supplies grounded facts, call job-search.profile.update with only those facts. Updates save immediately and the progress rail reflects them, so keep the conversation moving rather than announcing each save. The progress fields are resume, titles, compFloor, location, and dealBreakers; industries and keywords are useful optional context. Include the status or vaultEnabled fields ONLY when you are actually changing them, because those two ask the user to confirm. When the required fields are filled and a current resume exists, propose activation in conversation, and only after the user agrees call job-search.profile.update with status active. Never invent profile or resume details.
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `pnpm vitest run tests/unit/external-module-job-search-manifest.test.ts`
Expected: PASS.

- [ ] **Step 8: Check the module version and web onboarding copy**

Run: `grep -rn "approval\|approve\|card" external-modules/job-search/src/web/onboarding.tsx`
Any UI copy promising an approval card for ordinary field writes is now false — update the wording to match silent saves. Leave copy about the activation confirm intact. Bump `"version"` in `jarvis.module.json` (0.3.0 → 0.3.1) so the installed-module version reflects the behaviour change.

- [ ] **Step 9: Commit**

```bash
git add external-modules/job-search/jarvis.module.json external-modules/job-search/src/web/onboarding.tsx tests/unit/external-module-job-search-manifest.test.ts
git commit -m "feat(job-search): adopt install-time permission grant for profile writes (#1234, #1246)"
```

---

### Task 6: Prove it end to end

**Files:**

- Modify: `tests/e2e/job-search-profile-builder.spec.ts`

**Interfaces:**

- Consumes: Tasks 1-5.
- Produces: e2e evidence that an ordinary interview raises zero approval cards while activation still raises exactly one.

- [ ] **Step 1: Add the zero-card assertion**

Read the existing spec first and reuse its own page objects, selectors, and seeding helpers — do not invent new ones. Add a case asserting that after the interview writes ordinary fields (titles, compFloor, location, dealBreakers), **no** approval card appears, using whatever locator the existing suite already uses for the card surface. Then assert that proposing `status: "active"` surfaces exactly one card. If the current spec asserts cards appear for ordinary fields, that assertion encodes the old behaviour and must be inverted.

- [ ] **Step 2: Run the e2e spec**

Run: `pnpm test:e2e tests/e2e/job-search-profile-builder.spec.ts`
Expected: PASS. This needs a running dev instance — see the JS-03 UAT instance recipe in memory (`job-search-js03-uat-instance`) for env gaps that otherwise fake regressions (`JARVIS_VAULT_ROOT`, `pnpm db:migrate`, an active chat model for the actor).

- [ ] **Step 3: Run the full gate on a fresh DB**

```bash
# fresh gate DB — a prior run's uat-seed rows will otherwise break this one
dropdb --if-exists jarvis_gate && createdb jarvis_gate
pnpm verify:foundation
```

Expected: exit 0. Record the real exit code; never pipe the gate through `tail`.

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/job-search-profile-builder.spec.ts
git commit -m "test(job-search): assert zero approval cards for ordinary profile writes (#1246)"
```

- [ ] **Step 5: Hand back to Ben for UAT — do not push or merge**

JS-03 (#1234) still needs Ben's UAT sign-off, and this branch now carries both JS-03 and its conformance change. Report: the gate's exit code, the e2e result, and the fact that `build/js-03-perms` is unpushed and awaiting his run.

---

## Verification Summary

| Requirement (spec §)                                                     | Covered by                                                                  |
| ------------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| Explicit manifest opt-in, no blanket write default (Design 1)            | Task 3 Step 5 coupling check; Task 2 familyless-write test                  |
| `defaultTier` re-opened to `trusted_auto`, openly noted (Design 1)       | Task 1 Step 2                                                               |
| Reserve confirm for destructive/outbound/requiresConfirmation (Design 2) | Task 2                                                                      |
| Consent = install, no approval card (Design 3)                           | Task 5 (guidance rewrite); no first-use card added anywhere                 |
| Mandatory confirm on `status:"active"` and `vaultEnabled` (Design 4)     | Task 4 synthesis; Task 5 Step 5; Task 6                                     |
| Declarative `confirmWhen`/`confirmWhenKeys` mechanism (Design 4)         | Tasks 1, 3, 4 — **this plan lands the shared mechanism**; #1247 consumes it |
| `risk: "outbound"` as an enum value (Design 5)                           | Tasks 1, 2, 3                                                               |
| Stored user prefs always win (Design 6)                                  | Task 2 stored-`ask_each_time` test (existing resolver precedence preserved) |
| Authorization untouched (Not changed)                                    | No RLS/DataContextDb/AccessContext file is modified by any task             |
| JS-03 blast radius (a)(b)(c)                                             | Task 5 Steps 3-6                                                            |
