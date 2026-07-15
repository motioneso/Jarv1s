import type { Page, Route } from "@playwright/test";

interface DirectoryEntry {
  readonly name: string;
  readonly path: string;
}

interface MockPerson {
  readonly id: string;
  readonly displayName: string;
  readonly status: "active" | "archived" | "merged";
  readonly confidence: number;
  readonly relationshipSummary: string | null;
  readonly contextSummary: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

interface MockCandidate {
  readonly id: string;
  readonly candidateKind: "create_person" | "link_identity" | "merge_people" | "split_identity";
  readonly status: "pending" | "accepted" | "rejected" | "suppressed" | "resolved";
  readonly suggestedDisplayName: string | null;
  readonly reasonSummary: string | null;
  readonly confidence: number;
}

interface RefreshResult {
  readonly discovered: number;
  readonly projected: number;
  readonly ignored: number;
  readonly candidates: number;
}

export interface MockNotesPeopleApiState {
  notesSourcePath?: string | null;
  notesDirectories?: Record<string, readonly DirectoryEntry[]>;
  notesLastSync?: {
    readonly at: string | null;
    readonly ingested: number;
    readonly skipped: number;
    readonly errors: number;
    readonly lastError?: string;
  } | null;
  peopleNotesFolder?: string | null;
  peopleDirectories?: Record<string, readonly DirectoryEntry[]>;
  peopleRefreshResponses?: Array<RefreshResult | { readonly error: string }>;
  people?: MockPerson[];
  peopleCandidates?: MockCandidate[];
}

export async function registerMockNotesPeopleRoutes(
  page: Page,
  state: MockNotesPeopleApiState
): Promise<void> {
  await page.route(
    (url) => url.pathname === "/api/me/notes-source",
    async (route) => {
      if (route.request().method() === "GET") {
        return fulfillJson(route, 200, { path: state.notesSourcePath ?? null });
      }
      if (route.request().method() === "PUT") {
        state.notesSourcePath = (route.request().postDataJSON() as { path: string | null }).path;
        return fulfillJson(route, 200, { path: state.notesSourcePath });
      }
      return fulfillJson(route, 405, { error: "Method not allowed" });
    }
  );
  await page.route(
    (url) => url.pathname === "/api/me/notes-source/directories",
    (route) => {
      const path = new URL(route.request().url()).searchParams.get("path") ?? "";
      return fulfillJson(route, 200, {
        path: path || null,
        directories: state.notesDirectories?.[path] ?? []
      });
    }
  );
  await page.route(
    (url) => url.pathname === "/api/me/notes-last-sync",
    (route) => fulfillJson(route, 200, { lastSync: state.notesLastSync ?? null })
  );
  await page.route(
    (url) => url.pathname === "/api/notes/sync",
    (route) => {
      state.notesLastSync = {
        at: "2026-07-14T12:00:00.000Z",
        ingested: 1,
        skipped: 0,
        errors: 0
      };
      return fulfillJson(route, 202, { jobId: "notes-sync-987" });
    }
  );

  await page.route(
    (url) => url.pathname === "/api/people",
    async (route) => {
      if (route.request().method() === "GET") {
        return fulfillJson(route, 200, { people: state.people ?? [] });
      }
      if (route.request().method() === "POST") {
        const input = route.request().postDataJSON() as {
          displayName: string;
          emails?: readonly string[];
        };
        const person: MockPerson = {
          id: `person-${(state.people ?? []).length + 1}`,
          displayName: input.displayName,
          status: "active",
          confidence: 1,
          relationshipSummary: null,
          contextSummary: null,
          createdAt: "2026-07-14T12:00:00.000Z",
          updatedAt: "2026-07-14T12:00:00.000Z"
        };
        state.people = [...(state.people ?? []), person];
        return fulfillJson(route, 200, {
          person,
          notePath: `${state.peopleNotesFolder}/${input.displayName.replace(/\s+/g, "-")}.md`
        });
      }
      return fulfillJson(route, 405, { error: "Method not allowed" });
    }
  );
  await page.route(
    (url) => url.pathname === "/api/people/match-candidates",
    (route) => fulfillJson(route, 200, { candidates: state.peopleCandidates ?? [] })
  );
  await page.route(
    (url) => url.pathname === "/api/people/notes-settings",
    async (route) => {
      if (route.request().method() === "GET") {
        return fulfillJson(route, 200, { folder: state.peopleNotesFolder ?? null });
      }
      if (route.request().method() === "PUT") {
        state.peopleNotesFolder = (
          route.request().postDataJSON() as { readonly folder: string | null }
        ).folder;
        return fulfillJson(route, 200, { folder: state.peopleNotesFolder });
      }
      return fulfillJson(route, 405, { error: "Method not allowed" });
    }
  );
  await page.route(
    (url) => url.pathname === "/api/people/notes-directories",
    (route) => {
      const path = new URL(route.request().url()).searchParams.get("path") ?? "";
      return fulfillJson(route, 200, {
        path: path || null,
        directories: state.peopleDirectories?.[path] ?? []
      });
    }
  );
  await page.route(
    (url) => url.pathname === "/api/people/notes/refresh",
    (route) => {
      const response = state.peopleRefreshResponses?.shift() ?? {
        discovered: 0,
        projected: 0,
        ignored: 0,
        candidates: 0
      };
      return "error" in response
        ? fulfillJson(route, 400, response)
        : fulfillJson(route, 200, response);
    }
  );
}

async function fulfillJson(route: Route, status: number, body: unknown): Promise<void> {
  await route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body)
  });
}
