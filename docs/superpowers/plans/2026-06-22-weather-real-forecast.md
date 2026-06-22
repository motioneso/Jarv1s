# Plan: Weather Real Forecast (feat-217)

**Spec:** docs/superpowers/specs/2026-06-22-weather-real-forecast.md  
**Branch:** feat-217-weather  
**Migration:** none (using `app.preferences` KV — storage confirmed, no new table)

## Key Design Decisions

- **Storage:** `app.preferences` KV, key `weather-location`, value `{ lat, lon, label } | null`. Inherits owner-only RLS from structured-state. No migration needed; 0106 reserved but unused.
- **Module placement:** New `packages/weather` for `GET /api/weather/today`. Weather-location preference (`GET`/`PUT /api/me/weather-location`) extends `packages/settings` (follows locale/quiet-hours pattern).
- **IP geocoder:** `https://ipwho.is/{ip}` (free, no key). Request IP from `request.ip` (Fastify trustProxy).
- **Open-Meteo:** `https://api.open-meteo.com/v1/forecast?latitude={lat}&longitude={lon}&current=temperature_2m,apparent_temperature,weather_code&temperature_unit=celsius`
- **Cache:** Per-user in-memory `Map<userId, { data, expiresAt }>`, 30-min TTL. IP-geo cached separately `Map<ip, { geo, expiresAt }>`, 6-hour TTL (IPs don't move often).
- **Fetch injection:** Weather service accepts optional `fetchFn: typeof fetch` for test mocking.
- **Graceful degradation:** If IP geo fails, return `{ data: null }` (no error to client). If Open-Meteo fails, return 502.
- **Frontend:** Update `HeaderWeather` to accept `WeatherTodayDto | null` directly (cleaner than mapping to WeatherFeed multi-day format).

## Tasks (TDD, green per commit)

### Task 1 — Shared weather API types

**Files:** `packages/shared/src/weather-api.ts` (new), `packages/shared/src/index.ts`

Add:

- `WeatherTodayDto: { temp: number, feelsLike: number, condition: string, icon: WeatherIcon, location: string, unit: "metric" | "imperial" }`
- `GetWeatherTodayResponse: { data: WeatherTodayDto | null }`
- `WeatherIcon` type (re-use or re-declare: `"sun" | "cloud" | "cloud-sun" | "cloud-rain" | "cloud-snow" | "wind"`)
- `weatherTodayRouteSchema` (Fastify schema)
- Export from `packages/shared/src/index.ts`

**Test:** typecheck green.

### Task 2 — Weather-location preference routes in settings

**Files:** `packages/shared/src/settings-api.ts`, `packages/settings/src/weather-location-routes.ts` (new), `packages/settings/src/manifest.ts`, `packages/settings/src/routes.ts`

- Add `WeatherLocationDto: { lat: number, lon: number, label: string } | null` to settings-api
- Add `getWeatherLocationRouteSchema`, `putWeatherLocationRouteSchema`
- `weather-location-routes.ts`: `GET /api/me/weather-location` (reads pref) + `PUT /api/me/weather-location` (validates + upserts; null body clears)
- Add 2 route entries to `settingsModuleManifest.routes[]`
- Call `registerWeatherLocationRoutes` from `routes.ts`

**Test:** `tests/integration/weather.test.ts` (Task 6 covers this) — typecheck green after this task.

### Task 3 — packages/weather module

**Files:**

- `packages/weather/package.json` — `@jarv1s/weather`, deps: `@jarv1s/db`, `@jarv1s/shared`, `@jarv1s/structured-state`, `@jarv1s/module-sdk`, `fastify`
- `packages/weather/src/manifest.ts` — `weatherModuleManifest` with permission `weather.view`, route `GET /api/weather/today`
- `packages/weather/src/weather-cache.ts` — `WeatherCache<T>` class: `Map<string, { value: T, expiresAt: number }>`, methods `get(key)`, `set(key, value, ttlMs)`, `clear()`
- `packages/weather/src/open-meteo.ts` — `fetchOpenMeteoForecast(lat, lon, unit, fetchFn)` → `WeatherTodayDto`; WMO weather-code → condition/icon mapping table
- `packages/weather/src/ip-geocoder.ts` — `geocodeIp(ip, fetchFn)` → `{ lat, lon, label } | null`; ipwho.is response parsing
- `packages/weather/src/weather-service.ts` — `WeatherService`: constructor takes `{ preferencesRepo, dataContext, fetchFn? }`; `getWeatherForUser(accessContext, requestIp)`: reads `weather-location` pref → if set use it, else IP-geo → if still null return null → call Open-Meteo → cache + return
- `packages/weather/src/routes.ts` — `registerWeatherRoutes(server, deps)`: `GET /api/weather/today`
- `packages/weather/src/index.ts` — exports

**tsconfig.json:** add `"@jarv1s/weather": ["packages/weather/src/index.ts"]` to root tsconfig paths.

**Test:** typecheck green.

### Task 4 — Module registry wiring

**Files:** `packages/module-registry/package.json`, `packages/module-registry/src/index.ts`

- Add `"@jarv1s/weather": "workspace:*"` to module-registry deps
- Import `registerWeatherRoutes`, `weatherModuleManifest`, `weatherModuleSqlMigrationDirectory` from `@jarv1s/weather`
- Add entry to `BUILT_IN_MODULES` array (no SQL dirs, no queues, `registerRoutes` wires `PreferencesRepository` + `DataContextRunner`)

**Test:** `pnpm typecheck` green; `assertModuleRegistryConsistency` passes at module load.

### Task 5 — Frontend wiring

**Files:**

- `apps/web/src/api/query-keys.ts` — add `weather: { today: ["weather", "today"] as const }`
- `apps/web/src/api/client.ts` — add `getWeatherToday(): Promise<GetWeatherTodayResponse>`, `putWeatherLocation(body: WeatherLocationDto): Promise<...>`
- `apps/web/src/today/header-weather.tsx` — change `props.weather?: WeatherFeed | null` to `props.weather?: WeatherTodayDto | null`; update render to show `temp`, `feelsLike`, `condition`, `location`, single-day icon (no multi-day row for now)
- `apps/web/src/shell/app-shell.tsx` — add `useQuery({ queryKey: queryKeys.weather.today, queryFn: getWeatherToday, staleTime: 30 * 60 * 1000 })` when on `/today`; pass `weatherQuery.data?.data ?? null` to `<HeaderWeather>`

**Test:** `pnpm typecheck` green (web typecheck included).

### Task 6 — Integration tests

**File:** `tests/integration/weather.test.ts`

Covers:

1. `GET /api/me/weather-location` returns null by default
2. `PUT /api/me/weather-location` with `{ lat, lon, label }` → 200
3. `GET /api/me/weather-location` after PUT returns saved value
4. `PUT /api/me/weather-location` with null body → clears location
5. `GET /api/weather/today` with mocked fetch (known lat/lon via preference) → 200 with `data: WeatherTodayDto`
6. `GET /api/weather/today` with no location pref + IP-geo mocked returning null → 200 with `data: null`
7. RLS: member cannot read owner's weather-location (owner-only via `app.preferences`)

Inject `fetchFn` into `WeatherService` via `createApiServer` extension or by passing a test-only module-registry override.

**Test:** suite green.

### Task 7 — Full gate

```bash
pnpm format:check && pnpm lint && pnpm typecheck
pnpm verify:foundation
```

All green.

## Exit Criteria Verification

- [x] `GET /api/weather/today` returns real data for known lat/lon (Task 6, test 5)
- [x] Location override persists across reloads (Tasks 2+6, test 3)
- [x] Cache prevents >1 Open-Meteo call per 30 min per user (WeatherCache in Task 3, test assertion)
- [x] `pnpm verify:foundation` passes (Task 7)

## Risk Notes

- `header-weather.tsx` change removes multi-day strip — acceptable for MVP (spec says today only)
- IP from `request.ip` requires Fastify `trustProxy: true` — already set in production; `server.inject()` in tests sends requests directly (no proxy headers needed, IP will be `::1` or `127.0.0.1`, so tests should provide preference to skip IP geo path)
- No secrets involved — standard RLS hygiene only
