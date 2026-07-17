import { describe, expect, expectTypeOf, it } from "vitest";
import type {
  JarvisError,
  JarvisModuleManifest,
  ModuleAiRequirementManifest,
  ModuleNavigationEntryManifest,
  ModuleSettingsSurfaceManifest
} from "@jarv1s/module-sdk";
import type { AiModelCapability, AiModelTier } from "@jarv1s/shared";

describe("app-map manifest contracts", () => {
  it("keeps shared AI requirement literals assignable to the module SDK", () => {
    expectTypeOf<AiModelCapability>().toEqualTypeOf<ModuleAiRequirementManifest["capability"]>();
    expectTypeOf<AiModelTier>().toEqualTypeOf<ModuleAiRequirementManifest["tier"]>();
  });

  it("requires descriptions and structured feature errors", () => {
    const navigation: ModuleNavigationEntryManifest = {
      id: "news",
      label: "News",
      description: "Read personalized headlines.",
      path: "/news"
    };
    const setting: ModuleSettingsSurfaceManifest = {
      id: "news.prefs",
      label: "News",
      description: "Choose news sources and topics.",
      path: "/settings/modules/news",
      scope: "user"
    };
    const error: JarvisError = {
      code: "news.add_source.no_json_model",
      class: "prerequisite",
      remediationRef: "news.add_source.configure_json_model"
    };
    const manifest = {
      id: "fixture",
      name: "Fixture",
      version: "0.0.0",
      publisher: "jarv1s",
      lifecycle: "required",
      compatibility: { jarv1s: ">=0.0.0" },
      navigation: [navigation],
      settings: [setting],
      features: [
        {
          id: "news.add_source",
          description: "Find and add a news source.",
          errors: [{ ...error, description: "No compatible model is configured." }]
        }
      ]
    } satisfies JarvisModuleManifest;
    expect(manifest.features[0].errors[0].code).toBe(error.code);
  });
});
