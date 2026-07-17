import { describe, expect, expectTypeOf, it } from "vitest";
import type {
  JarvisError,
  JarvisModuleManifest,
  ModuleAiRequirementManifest,
  ModuleNavigationEntryManifest,
  ModuleSettingsSurfaceManifest
} from "@jarv1s/module-sdk";
import type { AiModelCapability, AiModelTier } from "@jarv1s/shared";
import { assertModuleRegistryConsistency, type BuiltInModuleRegistration } from "@jarv1s/module-registry";
import { newsAddSourceRequirement, newsModuleManifest } from "@jarv1s/news";

function registration(manifest: JarvisModuleManifest): BuiltInModuleRegistration {
  return { manifest, sqlMigrationDirectories: [], queueDefinitions: [] };
}

function baseManifest(overrides: Partial<JarvisModuleManifest>): JarvisModuleManifest {
  return {
    id: "fixture",
    name: "Fixture",
    version: "0.0.0",
    publisher: "jarv1s",
    lifecycle: "required",
    compatibility: { jarv1s: ">=0.0.0" },
    ...overrides
  };
}

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
    expect(manifest.features[0]!.errors[0]!.code).toBe(error.code);
  });

  it.each(["", "   ", "x".repeat(241)])("rejects invalid surface description %j", (description) => {
    expect(() =>
      assertModuleRegistryConsistency([
        registration(
          baseManifest({
            navigation: [{ id: "fixture", label: "Fixture", path: "/fixture", description }]
          })
        )
      ])
    ).toThrow(/description/i);
  });

  it("rejects a prerequisite error whose remediation is undeclared", () => {
    expect(() =>
      assertModuleRegistryConsistency([
        registration(
          baseManifest({
            features: [
              {
                id: "fixture.do_thing",
                description: "Do the thing.",
                errors: [
                  {
                    code: "fixture.missing",
                    class: "prerequisite",
                    remediationRef: "fixture.configure",
                    description: "Configuration is missing."
                  }
                ]
              }
            ]
          })
        )
      ])
    ).toThrow(/undeclared remediationRef/i);
  });

  it("accepts every built-in surface", () => {
    expect(() => assertModuleRegistryConsistency()).not.toThrow();
  });

  it("uses one object for the News add-source model requirement", () => {
    const feature = newsModuleManifest.features?.find((item) => item.id === "news.add_source");
    expect(feature?.requires).toBe(newsAddSourceRequirement);
    expect(newsAddSourceRequirement).toEqual({
      service: "module.news",
      capability: "json",
      tier: "economy"
    });
  });
});
