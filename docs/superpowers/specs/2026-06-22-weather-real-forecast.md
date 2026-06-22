# Weather: Real Location + Forecast for Today Header

**Issue:** #217
**Status:** Approved for build
**Date:** 2026-06-22
**Milestone:** Next Roadmap · Post-first-week success

## Problem

The Today header shows a compact weather UI wired to demo/null plumbing only. No real weather
route or provider exists. `GET /api/weather/today` is referenced in UI fixtures but unimplemented.

## Scope

- Implement `GET /api/weather/today` returning `{ temp, condition, location, unit }`.
- Use **Open-Meteo** (no API key required) for forecast data and geocoding.
- Location resolution order:
  1. User-saved location override (lat/lon or city name stored in preferences).
  2. Best-effort server egress-IP geolocation (free tier, cached server-side, no PII stored).
- User can set/clear a location override via `PUT /api/settings/weather-location`.
- Weather response is cached server-side (TTL ~30 min) to avoid hammering Open-Meteo.
- Unit (metric/imperial) follows user locale preference; default metric.

## Out of scope

- Hourly or multi-day forecasts.
- Severe weather alerts.
- Client-side geolocation (no browser GPS prompt).

## Data

Migration **0100** (reserve 0100–0101):

```sql
ALTER TABLE user_preferences ADD COLUMN IF NOT EXISTS
  weather_location jsonb DEFAULT NULL;
  -- { lat, lon, label } or null (use egress-IP fallback)
```

If `user_preferences` doesn't exist, add a `weather_location` column or row to whichever
user-settings table the onboarding/locale settings use.

## API

```
GET  /api/weather/today                     → { temp, feelsLike, condition, icon, location, unit }
PUT  /api/settings/weather-location         → body { lat, lon, label } | null (clears override)
```

Server-side Open-Meteo calls — never proxied raw to the client.

## Acceptance

- `GET /api/weather/today` returns real data (not null/demo) for a known lat/lon.
- Location override persists across reloads.
- Cache prevents more than 1 Open-Meteo call per 30 min per user.
- `pnpm verify:foundation` passes.
