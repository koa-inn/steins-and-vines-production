---
quick: 261029-zq1
title: Zoho Inventory daily-quota guard (never run out on an operating day)
created: 2026-10-29
owner_approved: "Do 1–5 now" (2026-10-29, after the prod kiosk outage)
---

# Incident (2026-10-29, ~17:00 Pacific)

Production kiosk could not load products: `/api/kiosk/products` returned 502 because Zoho Inventory returned
HTTP 429 `{"code":45,"message":"The API call for this organization has exceeded the maximum call rate limit of 1,000"}`
(`x-rate-limit-limit: 1000`, `x-rate-limit-remaining: 0`, `x-rate-limit-reset: <seconds>`; resets at midnight
America/Vancouver). Zoho Books (separate limit) kept working.

Root cause: staging and production share ONE Zoho org and therefore one 1,000-calls/day Inventory quota.
- `server.js` cron `*/10 9-19 * * *` (America/Vancouver, added de5198e7 2026-10-22) rebuilds the kiosk catalog in
  BOTH envs: `rebuildKioskCatalog()` = item list (`fetchAllItemsCached`, ~3 calls) + `fetchItemDetailsBulk` for ~540
  items (6 calls) ≈ 10 calls × 66 runs ≈ 660/day/env → ~1,300/day combined.
- Website `/api/products` + `/api/ingredients` soft-TTL background refreshes also re-run `fetchItemDetailsBulk`.
- Boot pre-warms (every deploy) + 05:00/13:00 UTC warm-ups add more. Today's ~8 staging deploys tipped it over.
- `/api/kiosk/products` has no fallback once its 30-min cache expires → hard 502.

# Goal

On an operating day the kiosk and website never go blank because of the Zoho Inventory quota, staging never spends
the shared quota on a schedule, and staff are warned before the quota runs low.

# Tasks (one logical change per commit; regression test first for each)

## 1. Staging runs no scheduled Zoho jobs
- New env flag `ZOHO_SCHEDULED_JOBS` (default enabled; value `off` disables). When `off`, server.js skips:
  boot pre-warm of products/ingredients, the 05:00/13:00 UTC warm-up cron, the kiosk `*/10 9-19` cron. (On-demand
  requests still work and still cache.) Log one line at boot stating the state.
- Do NOT gate: reconcile sweeps, brewpad retries, batch drift, mirrors (they are not Inventory-catalog jobs) — but
  check each for Inventory calls and list any in the SUMMARY.
- Orchestrator sets `ZOHO_SCHEDULED_JOBS=off` on the STAGING service only after deploy.

## 2. Last-good fallback — never an empty kiosk/website catalog
- On every successful kiosk rebuild also write the sellable array to a new Redis key `kiosk:products:lastgood`
  (add to lib/constants CACHE_KEYS) with NO TTL, plus `kiosk:products:lastgood:at` (ISO timestamp).
- `GET /api/kiosk/products`: if the cache misses and the rebuild fails (any error, incl. 429/cooldown), serve the
  last-good copy through `ledger.overlayStock` exactly like the cache path, with `source: 'stale'` and
  `stale_at: <iso>`. Only if there is no last-good copy return the existing 502.
- Same pattern for the website `/api/products` and `/api/ingredients` endpoints (lastgood keys per endpoint),
  returning `source: 'stale'`.
- Kiosk UI (js/kiosk-core.js): when the products response has `source === 'stale'`, show a small non-blocking
  notice ("Showing saved catalogue — stock may be a few minutes old") and keep the kiosk usable. ES5. Rebuild
  kiosk-core.min.js via `npm run build`; commit only the kiosk files + kiosk.html/admin.html restamps.
- Never serve stale for POST/sale paths — sales still use the live sale-time logic (pos.js); do not change the
  sale-time auto-reconcile in processSale except to make it not crash if a rebuild fails (it should already).

## 3. Cheaper refresh — item details cached for hours
- Cache `/itemdetails` results per item_id in Redis (key `zoho:itemdetail:<item_id>`, TTL 6 h; or one hash).
  `fetchItemDetailsBulk(itemIds)` (lib/zoho-api.js) only requests ids missing from that cache; returns the merged
  map. Add an opt-out param `{ force: true }` for the explicit `?bust=1` path so staff can still force fresh details.
- Expected effect: steady-state 10-min kiosk refresh = list calls only (~3), website refreshes likewise.
- Keep tax-field behaviour identical (CR-02 null semantics) — existing catalog/tax tests must pass unchanged.

## 4. Quota guard
- In lib/zoho-api.js, every Inventory request (inventoryGet/Post/Put + the list fetch) reads
  `x-rate-limit-remaining` / `x-rate-limit-limit` / `x-rate-limit-reset` from responses AND 429 error responses,
  and records the latest values in a small module (`lib/zoho-quota.js`): `{ remaining, limit, resetAt, updatedAt }`
  (in memory + mirrored to Redis key `zoho:inventory:quota` with TTL = reset seconds).
- On a 429 with Zoho `code: 45` (daily limit), mark the quota exhausted until `resetAt` (use the reset header, not a
  90 s cooldown) so no further Inventory calls are attempted until reset; endpoints go straight to last-good.
- Background/scheduled refreshes (kiosk cron, warm-ups, website soft-TTL background refreshes) are SKIPPED when
  `remaining` is known and `< ZOHO_QUOTA_RESERVE` (env, default 250). Interactive requests and sale-time paths are
  never blocked by the reserve (only by real exhaustion).
- Expose `quota` in `/health` (remaining, limit, resetAt) — no secrets.

## 5. Low-quota alert
- When `remaining` first drops below `ZOHO_QUOTA_ALERT` (env, default 300) in a quota day, send ONE email per env per
  quota day to the existing staff alert address via lib/mailer (new `sendZohoQuotaAlert({ remaining, limit, resetAt, env })`),
  and log a WARN + Sentry message (level warning). De-dup with a Redis key that expires at reset.
- Also alert once when exhaustion (code 45) is first seen.

# Constraints
- CLAUDE.md: regression tests first; one logical change per commit; do not edit existing tests; full frontend +
  middleware suites + root lint before every commit; middleware tests on Node 24
  (`PATH=$HOME/.nvm/versions/node/v24.21.0/bin:$PATH`).
- No new third-party domains. No .env commits.
- Do not push or deploy; the orchestrator deploys to staging, sets the staging flag, then production with owner OK.

# Verification
- Unit tests for: flag gating; last-good served on rebuild failure (kiosk, products, ingredients) with source 'stale';
  detail cache hit/miss/force; quota header capture incl. 429 code 45 → exhausted until reset; reserve skips
  background jobs but not interactive; alert sent once per quota day.
- Back-of-envelope in SUMMARY: estimated Inventory calls/day per env before vs after.
