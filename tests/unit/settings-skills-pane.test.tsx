import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";

import { queryKeys } from "../../apps/web/src/api/query-keys.js";
import { SettingsSkillsPane } from "../../apps/web/src/settings/settings-skills-pane.js";
import { FeedbackProvider } from "../../apps/web/src/settings/settings-feedback.js";
import type { ChatSkillDto } from "@jarv1s/shared";

function renderWithQuery(node: React.ReactNode, client: QueryClient): string {
  return renderToString(
    createElement(QueryClientProvider, { client }, createElement(FeedbackProvider, null, node))
  );
}

function makeSkill(overrides: Partial<ChatSkillDto> = {}): ChatSkillDto {
  return {
    id: "skill-1",
    ownerUserId: "user-1",
    name: "Daily standup",
    description: "Summarize yesterday and today",
    frontmatter: {},
    body: "Ask for yesterday, today, and blockers.",
    enabled: true,
    source: "authored",
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    ...overrides
  };
}

describe("SettingsSkillsPane", () => {
  it("renders the Skills heading", () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const html = renderWithQuery(createElement(SettingsSkillsPane), client);
    expect(html).toContain("Skills");
  });

  it("shows an empty state when no skills exist", () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(queryKeys.chat.skills, { skills: [] });
    const html = renderWithQuery(createElement(SettingsSkillsPane), client);
    expect(html).toContain("No skills yet");
  });

  it("renders a skill row with its name and description", () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(queryKeys.chat.skills, { skills: [makeSkill()] });
    const html = renderWithQuery(createElement(SettingsSkillsPane), client);
    expect(html).toContain("Daily standup");
    expect(html).toContain("/daily-standup");
    expect(html).toContain("Summarize yesterday and today");
  });

  it("shows an Enabled badge and a checked toggle for an enabled skill", () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(queryKeys.chat.skills, { skills: [makeSkill({ enabled: true })] });
    const html = renderWithQuery(createElement(SettingsSkillsPane), client);
    expect(html).toContain("Enabled");
    expect(html).toContain('checked=""');
  });

  it("shows a Disabled badge and no checked toggle for a disabled skill", () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(queryKeys.chat.skills, { skills: [makeSkill({ enabled: false })] });
    const html = renderWithQuery(createElement(SettingsSkillsPane), client);
    expect(html).toContain("Disabled");
    expect(html).not.toContain('checked=""');
  });

  it("leads with the skill list and keeps authoring flows closed initially", () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(queryKeys.chat.skills, { skills: [] });
    const html = renderWithQuery(createElement(SettingsSkillsPane), client);
    expect(html).toContain("No skills yet");
    expect(html).not.toContain("Skill name");
    expect(html).not.toContain("Upload a skill file");
    expect(html).toContain("Create skill");
    expect(html).toContain("Upload file");
  });

  it("does not expose obsolete Body language", () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(queryKeys.chat.skills, { skills: [] });
    const html = renderWithQuery(createElement(SettingsSkillsPane), client);
    expect(html).not.toContain(">Body<");
  });

  it("renders duplicate skill names as separate rows", () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(queryKeys.chat.skills, {
      skills: [
        makeSkill({
          id: "skill-1",
          name: "Standup",
          enabled: true,
          updatedAt: "2026-07-02T00:00:00.000Z"
        }),
        makeSkill({
          id: "skill-2",
          name: "Standup",
          enabled: false,
          updatedAt: "2026-07-01T00:00:00.000Z"
        })
      ]
    });
    const html = renderWithQuery(createElement(SettingsSkillsPane), client);
    expect(html.match(/Standup/g)?.length).toBeGreaterThanOrEqual(2);
  });
});
