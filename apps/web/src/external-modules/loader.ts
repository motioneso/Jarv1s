import type { ComponentType } from "react";
import * as React from "react";
import * as ReactDOMClient from "react-dom/client";

import type { AssistantSurfaceHandleV1 } from "../chat/assistant-surface";
import type { ExternalModuleHostActionsV1 } from "./host-actions";

export const JARVIS_WEB_CONTRACT_VERSION = 1;

/** Props every external module Root receives from the host (#916). */
export interface ExternalWebContributionProps {
  /**
   * #916 — host-provided actions bound to THIS module id at the host-controlled call site. A module
   * calls e.g. `hostActions.openAssistant({ starterPrompt })` from a user gesture.
   */
  readonly hostActions: ExternalModuleHostActionsV1;
  /** #1196 — optional only so a v1.1 module bundle can fail closed on an older host. */
  readonly assistantSurface?: AssistantSurfaceHandleV1;
}

/** Contract v1: the default export of an external module's web entrypoint. */
export interface ExternalWebContribution {
  readonly contractVersion: number;
  readonly Root: ComponentType<ExternalWebContributionProps>;
}

/**
 * Host runtime handed to external bundles (#918). External module builds mark
 * react/react-dom as externals and read them from this global, so exactly ONE
 * React instance (the host's, pinned to the host version) ever exists — two
 * copies break hooks. Chosen over import maps: simpler, testable, and works
 * with Vite's dev server unchanged. Installed once at app boot (Task 23).
 */
export function installModuleHostRuntime(): void {
  const w = window as unknown as Record<string, unknown>;
  if (w.__JARVIS_MODULE_RUNTIME__) return;
  w.__JARVIS_MODULE_RUNTIME__ = Object.freeze({
    contractVersion: JARVIS_WEB_CONTRACT_VERSION,
    react: React,
    reactDomClient: ReactDOMClient
  });
}

const Missing: ComponentType<ExternalWebContributionProps> = () => null;

/**
 * Load one external module's web contribution. Fails closed to an empty
 * component on ANY defect: manifest contractVersion mismatch (checked BEFORE
 * the bundle is even fetched), import failure (404 = module disabled since the
 * module list was fetched), or a malformed/mismatched export.
 */
export async function loadExternalModuleContribution(entry: {
  readonly moduleId: string;
  readonly entrypoint: string;
  readonly contractVersion: number;
}): Promise<ComponentType<ExternalWebContributionProps>> {
  if (entry.contractVersion !== JARVIS_WEB_CONTRACT_VERSION) return Missing;
  const url = `/api/modules/${encodeURIComponent(entry.moduleId)}/web/${entry.entrypoint}`;
  let mod: { default?: ExternalWebContribution };
  try {
    mod = (await import(/* @vite-ignore */ url)) as { default?: ExternalWebContribution };
  } catch {
    return Missing;
  }
  const contribution = mod.default;
  // The export re-asserts contractVersion: the manifest gate saves a fetch,
  // this gate defends against a manifest that lies about its bundle.
  if (
    !contribution ||
    contribution.contractVersion !== JARVIS_WEB_CONTRACT_VERSION ||
    typeof contribution.Root !== "function"
  ) {
    return Missing;
  }
  return contribution.Root;
}
