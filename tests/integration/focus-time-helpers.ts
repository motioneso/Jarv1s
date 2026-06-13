// Shared helpers for the focus-time integration suites. Extracted from focus-time.test.ts so each
// suite file stays under the 1000-line source cap (pnpm check:file-size). NOT a *.test.ts file, so
// vitest does not run it as a suite — it only exports helpers consumed by the two focus-time suites.
import type { GatewayToolResponse } from "@jarv1s/ai";
import { CalendarRepository } from "@jarv1s/calendar";

export function okText(res: GatewayToolResponse): string {
  if (!res.ok) throw new Error("expected ok response");
  return String((res.data as { text: string }).text);
}

// Fake calendar repositories that throw on the cache mirror, to prove mirrorEvent classifies
// deterministically (independent of whether connector-sync's RLS migration is applied in the run
// DB). upsertCachedEvent always throws, so Promise<never> satisfies the override of
// Promise<CalendarEvent>.
export class RlsRejectingCalendarRepository extends CalendarRepository {
  // Simulate the calendar INSERT policy WITH CHECK failing (provider_type guard, pre-relax).
  override async upsertCachedEvent(): Promise<never> {
    const err = new Error(
      'new row violates row-level security policy for table "calendar_events"'
    ) as Error & {
      code?: string;
    };
    err.code = "42501"; // insufficient_privilege — what pg raises for an RLS violation
    throw err;
  }
}

export class GenericFailingCalendarRepository extends CalendarRepository {
  override async upsertCachedEvent(): Promise<never> {
    const err = new Error("deadlock detected") as Error & { code?: string };
    err.code = "40P01"; // a NON-RLS error → must classify as skipped-error
    throw err;
  }
}

export function captureFetch(
  reply: (url: string, init?: RequestInit) => { status?: number; body: unknown }
) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchFn = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const r = reply(url, init);
    return {
      ok: (r.status ?? 200) < 400,
      status: r.status ?? 200,
      json: async () => r.body,
      text: async () => JSON.stringify(r.body)
    } as Response;
  }) as unknown as typeof fetch;
  return { calls, fetchFn };
}
