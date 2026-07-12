# JS-04 — compliant public source adapters

**Status:** Draft — issue #933; pending Ben's final approval

**Grounding:** grounded on `eafa22dd`

**Depends on:** #930 and the replacement #915 pinned-fetch task

## Goal

Normalize keyless public Greenhouse, Lever, and Ashby postings through reviewed, host-pinned
adapters, plus safe one-shot manual capture. No authenticated board or recurring generic scraper.

## Adapter contract

Each adapter declares a stable id/display name, exact lowercase fetch hosts, policy/terms URL and
review date, courtesy interval, board-id configuration schema, normalization function, and stable
external-id semantics. Configuration accepts a validated board/company identifier or recognized URL
that resolves to declared hosts; it never supplies an arbitrary recurring target.

Normalized records include source/external id, canonical URL, company/title, locations/work mode,
employment type, compensation when explicitly supplied, published time when supplied, capped plain
description text, and fetch/normalization evidence. Missing fields remain unknown.

`ctx.fetch` enforces HTTPS, exact hosts, DNS-resolved IP safety, redirect revalidation, time/size
caps, and response streaming bounds. HTML is untrusted data: strip active markup and never follow
page instructions.

## Manual capture

- Pasted description: validate/cap and normalize locally; no network request.
- Public URL: the existing governed `web.read` capability retrieves it in the user-visible assistant
  flow, then a confirm-gated module tool stores the bounded extracted text and URL metadata.
- Manual capture never creates a recurring adapter and never lets the external worker bypass its
  declared-host allowlist.

## Compliance behavior

Only `allowed` adapters register. An `unknown`/`prohibited` status or policy kill switch disables new
fetches while preserving readable stored snapshots. No cookie, API key, login token, browser session,
robots bypass, CAPTCHA handling, or evasion logic exists.

## Verification

- Live-captured fixtures for Greenhouse, Lever, and Ashby normalization.
- Board-id/URL validation and canonical identity tests.
- Undeclared host, private address, redirect escape, timeout, over-cap, and malformed payload tests.
- Rate-courtesy and policy kill-switch tests.
- Manual paste makes zero fetches; manual URL uses governed `web.read`, not worker fetch.
- Job text prompt-injection fixtures remain inert data.

## Review question

Before RFA, confirm the policy/terms URL and review date recorded for each adapter. If any cannot be
classified `allowed`, that adapter must be removed rather than shipped behind an experimental flag.
