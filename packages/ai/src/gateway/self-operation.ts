import type {
  ModuleAssistantActionFamilyManifest,
  ModuleAssistantToolManifest
} from "@jarv1s/module-sdk";
import type { DataContextDb } from "@jarv1s/db";

import type { AiRepository } from "../repository.js";

export type SelfOperationExclusionCategory =
  | "self_authority"
  | "prompt_shaping"
  | "secrets"
  | "identity_auth_registration"
  | "data_scope_consent"
  | "assistant_brain"
  | "external_effect";

interface SelfOperationExclusionRule {
  readonly id: string;
  readonly category: SelfOperationExclusionCategory;
  readonly reason: string;
  readonly moduleId: string;
  readonly toolNamePrefixes: readonly string[];
}

/**
 * The seven immutable, server-owned self-operation exclusion categories (#1263). Every rule
 * matches ONLY on manifest-owned identity (module id + tool name prefix) — never on runtime
 * tool inputs. Scoped today to the `settings` and `ai` module ids, which own zero built-in write
 * assistantTools as of this task, so there is zero collision risk with the real inventory
 * Tasks 4-13 classify. #1264's settings/AI-admin tools must land under one of these prefixes (or
 * extend this table) before they may exist — declaring a `selfOperationGrant` on an excluded tool
 * is itself a build-time assertion failure (see assertBuiltInSelfOperationManifests below).
 */
export const SELF_OPERATION_EXCLUSIONS: readonly SelfOperationExclusionRule[] = [
  {
    id: "self_authority.settings",
    category: "self_authority",
    reason:
      "Jarvis may never grant or promote its own authority: YOLO, action-policy tier promotion, permissions, module enable/install/remove/purge, connector feature grants, task-agency auto-execution.",
    moduleId: "settings",
    toolNamePrefixes: [
      "settings.yolo.",
      "settings.actionPolicy.tier.",
      "settings.permissions.",
      "settings.module.enable.",
      "settings.module.install.",
      "settings.module.remove.",
      "settings.module.purge.",
      "settings.connector.featureGrant.",
      "settings.taskAgency.autoExecution."
    ]
  },
  {
    id: "self_authority.ai",
    category: "self_authority",
    reason:
      "AI service bindings, default provider, chat-model override, and admin pin are self-authority surfaces.",
    moduleId: "ai",
    toolNamePrefixes: [
      "ai.serviceBinding.",
      "ai.defaultProvider.",
      "ai.chatModelOverride.",
      "ai.adminPin."
    ]
  },
  {
    id: "prompt_shaping.settings",
    category: "prompt_shaping",
    reason:
      "Jarvis may never shape its own persona, memory-fact behavior, priority ranking, source behavior, chat skills, or page-context writes.",
    moduleId: "settings",
    toolNamePrefixes: [
      "settings.persona.",
      "settings.assistantName.",
      "settings.memorySettings.",
      "settings.priorityRanking.",
      "settings.sourceBehavior.",
      "settings.notesSourceSelection.",
      "settings.chatSkill.mutate.",
      "settings.chatSkill.import.",
      "settings.pageContext.write."
    ]
  },
  {
    id: "secrets.settings",
    category: "secrets",
    reason:
      "Credentials, secret registry entries, provider keys, and connector auth flows never self-operate.",
    moduleId: "settings",
    toolNamePrefixes: [
      "settings.secretRegistry.",
      "settings.credential.",
      "settings.webSearchKey.",
      "settings.provider.create.",
      "settings.provider.update.",
      "settings.voiceEndpoint.",
      "settings.connector.authorize.",
      "settings.connector.complete.",
      "settings.connector.connect.",
      "settings.onboarding.login.",
      "settings.onboarding.install.",
      "settings.terminal.password.",
      "settings.terminal.ticket."
    ]
  },
  {
    id: "identity_auth_registration.settings",
    category: "identity_auth_registration",
    reason:
      "Account lifecycle, admin promotion, session revocation, and registration state are identity surfaces.",
    moduleId: "settings",
    toolNamePrefixes: [
      "settings.account.lifecycle.",
      "settings.admin.promote.",
      "settings.session.revoke.",
      "settings.registration.flag.",
      "settings.onboarding.state."
    ]
  },
  {
    id: "data_scope_consent.settings",
    category: "data_scope_consent",
    reason:
      "Wellness AI consent and future prompt-data-widening flags require explicit human consent.",
    moduleId: "settings",
    toolNamePrefixes: ["settings.wellnessAiConsent.", "settings.promptDataWidening."]
  },
  {
    id: "assistant_brain.ai",
    category: "assistant_brain",
    reason:
      "Chat model override, embed provider, provider revoke, model disable, and multiplexer reshape the brain.",
    moduleId: "ai",
    toolNamePrefixes: [
      "ai.chatModelOverride.",
      "ai.embedProvider.",
      "ai.providerRevoke.",
      "ai.modelDisable.",
      "ai.multiplexer."
    ]
  },
  {
    id: "external_effect.settings",
    category: "external_effect",
    reason:
      "Third-party sends, scheduled/cancelled work, digests, briefings, news refresh, transcription, exports, module queue runs, and host install all reach outside Jarvis.",
    moduleId: "settings",
    toolNamePrefixes: [
      "settings.thirdPartySend.",
      "settings.scheduledWork.",
      "settings.cancelledWork.",
      "settings.digest.",
      "settings.proactive.",
      "settings.notesSourceScheduling.",
      "settings.providerTest.",
      "settings.providerDiscovery.",
      "settings.connectorSync.",
      "settings.connectorRevoke.",
      "settings.briefing.mutate.",
      "settings.briefing.run.",
      "settings.newsPreview.",
      "settings.newsRefresh.",
      "settings.transcription.",
      "settings.export.",
      "settings.moduleQueueRun.",
      "settings.hostInstall."
    ]
  }
];

function matchingExclusionRule(
  moduleId: string,
  tool: Pick<ModuleAssistantToolManifest, "name">
): SelfOperationExclusionRule | undefined {
  return SELF_OPERATION_EXCLUSIONS.find(
    (rule) =>
      rule.moduleId === moduleId &&
      rule.toolNamePrefixes.some((prefix) => tool.name.startsWith(prefix))
  );
}

/** True when a module/tool's manifest-owned identity matches a central exclusion category. */
export function isSelfOperationExcluded(
  moduleId: string,
  tool: Pick<ModuleAssistantToolManifest, "name">
): boolean {
  return matchingExclusionRule(moduleId, tool) !== undefined;
}

/**
 * The only tools ever allowed to declare `confirm_always` (planned, per #1263 chassis plan).
 * Five, not four: web.read is the deliberate odd one out, risk "write" not "destructive" — it's
 * here because no approved spec covers web-research and it is the v0.1.0 audit's web.read
 * prompt-injection-to-exfiltration finding; an auto-run family would reopen that HIGH. Do not
 * "tidy" it to risk "destructive" to match the other four, and do not give it a family (Opus
 * security review, PR #1268, #1263).
 */
const PLANNED_CONFIRM_ALWAYS_TOOLS: readonly string[] = [
  "memory.forget",
  "people.merge",
  "people.splitIdentity",
  "email.sendReply",
  "web.read"
];

const GENERIC_INPUT_KEY_NAMES = new Set(["key", "preferenceKey", "settingKey"]);

/** Minimal shape assertBuiltInSelfOperationManifests needs from a built-in JarvisModuleManifest. */
export interface SelfOperationManifestInput {
  readonly id: string;
  readonly assistantTools?: readonly ModuleAssistantToolManifest[];
  readonly assistantActionFamilies?: readonly ModuleAssistantActionFamilyManifest[];
}

function inputSchemaPropertyNames(tool: ModuleAssistantToolManifest): readonly string[] {
  const schema = tool.inputSchema as { readonly properties?: Record<string, unknown> } | undefined;
  return schema?.properties ? Object.keys(schema.properties) : [];
}

export const BUILT_IN_SELF_OPERATION_SCOPE_NOTE =
  "assertBuiltInSelfOperationManifests validates BUILT-IN manifests only; external module tools " +
  "are deferred to #1267 and remain safe today because their ABI cannot declare actionFamilyId, " +
  "so policy.ts:40 confirms every external write unconditionally.";

/**
 * Build-time assertion over built-in module manifests only (see BUILT_IN_SELF_OPERATION_SCOPE_NOTE
 * for why external modules are out of scope and still safe). Not wired into boot until Tasks 4-13
 * have made the real built-in inventory valid. Error messages name the offending module/tool and
 * invariant only — never tool inputs.
 */
export function assertBuiltInSelfOperationManifests(
  manifests: readonly SelfOperationManifestInput[]
): void {
  for (const manifest of manifests) {
    const tools = manifest.assistantTools ?? [];
    const families = manifest.assistantActionFamilies ?? [];

    const seenFamilyIds = new Set<string>();
    for (const familyManifest of families) {
      if (seenFamilyIds.has(familyManifest.id)) {
        throw new Error(
          `module "${manifest.id}" declares duplicate action family id "${familyManifest.id}"`
        );
      }
      seenFamilyIds.add(familyManifest.id);
    }

    const seenToolNames = new Set<string>();
    // #1263 Task 4 hardening (a): a family promoted at install must never also be left for the
    // user to promote — that would make "user_promotable" a lie for whichever tool loses the race,
    // since the family's stored tier is shared. Tracked per-module because actionFamilyId only
    // resolves within the declaring module (see the same-module resolution check below).
    const grantedAtInstallFamilyIds = new Set<string>();
    const userPromotableFamilyIds = new Set<string>();
    for (const tool of tools) {
      if (seenToolNames.has(tool.name)) {
        throw new Error(`module "${manifest.id}" declares duplicate tool name "${tool.name}"`);
      }
      seenToolNames.add(tool.name);

      const excluded = isSelfOperationExcluded(manifest.id, tool);

      if (excluded && tool.selfOperationGrant) {
        throw new Error(
          `module "${manifest.id}" tool "${tool.name}" is centrally excluded from self-operation and must not declare selfOperationGrant`
        );
      }

      if (tool.risk !== "read" && !excluded && !tool.selfOperationGrant) {
        throw new Error(
          `module "${manifest.id}" tool "${tool.name}" is an unclassified write/destructive tool: declare selfOperationGrant or add it to a central exclusion`
        );
      }

      if (tool.risk !== "read") {
        const genericKey = inputSchemaPropertyNames(tool).find((name) =>
          GENERIC_INPUT_KEY_NAMES.has(name)
        );
        if (genericKey) {
          throw new Error(
            `module "${manifest.id}" tool "${tool.name}" exposes generic input property "${genericKey}": tools must hardcode their target`
          );
        }
      }

      let resolvedFamily: ModuleAssistantActionFamilyManifest | undefined;
      if (tool.actionFamilyId) {
        resolvedFamily = families.find(
          (familyManifest) => familyManifest.id === tool.actionFamilyId
        );
        if (!resolvedFamily) {
          throw new Error(
            `module "${manifest.id}" tool "${tool.name}" references action family "${tool.actionFamilyId}" which does not resolve in its own module`
          );
        }
      }

      if (tool.selfOperationGrant === "granted_at_install") {
        if (tool.risk !== "write" || tool.executionPolicy !== "auto") {
          throw new Error(
            `module "${manifest.id}" tool "${tool.name}" declares granted_at_install without write risk and auto execution policy`
          );
        }
        if (
          !resolvedFamily ||
          !resolvedFamily.allowedTiers.includes("trusted_auto") ||
          !resolvedFamily.allowedTiers.includes("always_confirm")
        ) {
          throw new Error(
            `module "${manifest.id}" tool "${tool.name}" declares granted_at_install without a resolvable trusted action family allowing both trusted_auto and always_confirm`
          );
        }
        if (tool.actionFamilyId) {
          grantedAtInstallFamilyIds.add(tool.actionFamilyId);
        }
      }

      if (tool.selfOperationGrant === "user_promotable") {
        if (tool.risk !== "write" || tool.executionPolicy !== "auto") {
          throw new Error(
            `module "${manifest.id}" tool "${tool.name}" declares user_promotable without write risk and auto execution policy`
          );
        }
        if (!tool.actionFamilyId) {
          throw new Error(
            `module "${manifest.id}" tool "${tool.name}" declares user_promotable without an actionFamilyId`
          );
        }
        if (
          !resolvedFamily ||
          !resolvedFamily.allowedTiers.includes("trusted_auto") ||
          !resolvedFamily.allowedTiers.includes("always_confirm")
        ) {
          throw new Error(
            `module "${manifest.id}" tool "${tool.name}" declares user_promotable without a resolvable action family allowing both trusted_auto and always_confirm`
          );
        }
        if (tool.actionFamilyId) {
          userPromotableFamilyIds.add(tool.actionFamilyId);
        }
      }

      if (tool.selfOperationGrant === "confirm_always") {
        if (!PLANNED_CONFIRM_ALWAYS_TOOLS.includes(tool.name)) {
          throw new Error(
            `module "${manifest.id}" tool "${tool.name}" declares confirm_always outside the planned allowlist`
          );
        }
        // #1263 Task 4 hardening (b): a confirm_always tool must never be promotable, or the
        // guarantee that protects it (policy.ts:40 confirms every call for a family-less/non-auto
        // tool) silently stops holding. Deliberately NOT "confirm_always implies risk destructive"
        // — web.read is confirm_always at risk "write" (PR #1268 Opus security review, #1263) and
        // must keep passing this check. Instead: no executionPolicy "auto", and either no
        // actionFamilyId at all or a family whose allowedTiers cannot reach trusted_auto.
        const promotable =
          tool.executionPolicy === "auto" ||
          (resolvedFamily !== undefined && resolvedFamily.allowedTiers.includes("trusted_auto"));
        if (promotable) {
          throw new Error(
            `module "${manifest.id}" tool "${tool.name}" declares confirm_always but is promotable to trusted_auto: remove executionPolicy "auto" and any actionFamilyId whose allowedTiers include trusted_auto`
          );
        }
      }

      if (
        tool.selfOperationGrant &&
        resolvedFamily &&
        !resolvedFamily.allowedTiers.includes("always_confirm")
      ) {
        throw new Error(
          `module "${manifest.id}" tool "${tool.name}" references action family "${tool.actionFamilyId}" which must allow always_confirm`
        );
      }
    }

    for (const familyId of grantedAtInstallFamilyIds) {
      if (userPromotableFamilyIds.has(familyId)) {
        throw new Error(
          `module "${manifest.id}" action family "${familyId}" is referenced by both a granted_at_install tool and a user_promotable tool: install would silently promote the tier the user_promotable tool relies on the user to set`
        );
      }
    }
  }
}

/**
 * #1263 Task 14: install-time self-operation grant for a single built-in module. Derives the
 * unique action family ids referenced by that module's `granted_at_install` tools ONLY — a
 * `confirm_always` or `user_promotable` tool's family is never touched here, exactly like
 * `assertBuiltInSelfOperationManifests` treats them as distinct from `granted_at_install` (see the
 * ruling atop docs/superpowers/plans/1263/task-14.md: `user_promotable` is fully wired for
 * auto-run but install must not promote its family). Each derived family gets `trusted_auto`
 * written via `insertActionPolicyIfAbsent`, which never clobbers an existing stored tier.
 */
export async function grantSelfOperationForModule(
  scopedDb: DataContextDb,
  repository: Pick<AiRepository, "insertActionPolicyIfAbsent">,
  manifest: SelfOperationManifestInput
): Promise<void> {
  const familyIds = new Set<string>();
  for (const tool of manifest.assistantTools ?? []) {
    if (tool.selfOperationGrant === "granted_at_install" && tool.actionFamilyId) {
      familyIds.add(tool.actionFamilyId);
    }
  }

  for (const familyId of familyIds) {
    await repository.insertActionPolicyIfAbsent(scopedDb, manifest.id, familyId, "trusted_auto");
  }
}
