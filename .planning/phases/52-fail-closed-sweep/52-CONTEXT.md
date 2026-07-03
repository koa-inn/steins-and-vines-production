# Phase 52 — Fail-Closed Sweep (RESIL-01) — Planning Context

Source: 2026-07-02 whole-repo audit (`.planning/reports/AUDIT.md` §5 **H-6**, findings detailed in §2/§3.1-3.2). Scope captured 2026-07-03 for `/gsd-plan-phase 52`. Requirement: **RESIL-01**.

## Goal

Close the remaining "fail-open under Redis degradation" corners and the auth/validation gaps the audit flagged, via a **shared "closed-on-Redis-error" helper** that both the money and security guards call. Systemic theme (audit §4 insight 2): "fail-closed" was applied per-call-site, not architecturally, so it leaks back in the corners — this phase makes fail-closed-under-Redis a *tested invariant*.

## In-scope findings (read each in AUDIT.md §2/§3)

| Finding | Location | Defect → Fix |
|---------|----------|--------------|
| **M1** | `checkout.js:385` | Promo `FIRSTBATCH` sets discount inside the Redis-error catch → repeatable $20, burn never recorded → **fail closed** (no promo on Redis error) |
| **M4** | `server.js:335,352` | Rate-limit store returns `{totalHits:0}` on mid-op Redis error → limiter fails open → fall back to the in-process `memStore` accounting on error |
| **M5** | `server.js:320` | Loopback rate-limit skip returns `{totalHits:1}` on unverified proxy assumption → `X-Forwarded-For: ::1` defeats PIN throttling during outage → **gate the loopback skip to non-production** |
| **M2** | `pos.js:1434` | Legacy `/api/pos/sale`: charges then treats Zoho as "non-fatal", no void, no pending record → invisible orphan → **GREP FIRST** for any caller (kiosk UI); if dead, delete/quarantine; if live, give it the void+pending-record treatment |
| **M3** | `pos.js:1044` | Hardcoded gift-card clearing `account_id` fallback → wrong ledger if env unset/mis-pointed → **fail closed** (require the env, error if unset) |
| **M6** | `taxes.js:640` (`/api/items/migrate`) | SSRF: `axios.get(body.csv_url)` no scheme/host allowlist (key is public pre-Phase-46, so effectively unauth) → **https-only + host allowlist**, or accept CSV in the request body (admin panel already parses client-side) |
| **M7** | `catalog.js:790` | Unauth `?bust=1` forces cold Zoho refetch → quota-exhaustion DoS → **require the key** for `?bust=1` |
| **M8** | `recipes.js:308`, `gift-cards.js:40,59` | Unauth, uncached Apps-Script proxies → Apps Script quota DoS → **auth + cache** |
| **M20** | `items.js:117,151` | Path traversal: unvalidated `:id` → `%2F` pivots the Zoho token to other Inventory paths → **reuse `isValidId` / `^\d+$`** (pattern already in `purchaseorders.js:17`) |

## Locked decisions / guardrails

- **Shared helper first.** Build one `closed-on-Redis-error` helper (mirror the discriminated-result / fail-closed contract of `lib/money-path.js`) that the promo (M1), rate-limit (M4/M5) call-sites use, so the invariant lives in one place. Sequence: helper → per-call-site fail-open fixes (M1–M5) → the auth/validation fixes (M2 dead-route, M6 SSRF, M7/M8 DoS auth+cache, M20 `:id`).
- **TDD-first (CLAUDE.md rule 3).** For each guard, write a FAILING test that proves it fails *open* today (guard returns open when its Redis call throws / promo repeatable during simulated outage / `?bust=1` works unauth / `%2F` pivots), then close it. **DoD**: a test asserts every money/security guard returns *closed* when its Redis call throws; promo not repeatable during a simulated outage; `?bust=1` requires the key.
- **Rule 10:** do not edit existing tests; new tests in their own files; the FULL middleware suite (currently 62 suites / 1187 tests) stays green — must not weaken the v4.2/45-hardened flows.
- **M2 caution:** GREP for callers before deleting `/api/pos/sale` (kiosk `js/kiosk.js` / `admin.js`). Delete only if provably unused; otherwise harden in place. Document the grep result.
- **M5/M6 note:** M6's "effectively unauth" framing is because the API key was public pre-Phase-46; the allowlist is still the right fix regardless of auth. M5 gates loopback skip to non-prod.
- **Independent of Phase 48** (the kiosk de-fork). Server-side only.

## Split guidance

~8 findings across `checkout.js` / `server.js` / `pos.js` / `taxes.js` / `catalog.js` / `recipes.js` / `gift-cards.js` / `items.js`. Reasonable split: **Plan A** = shared fail-closed helper + the Redis fail-open fixes (M1/M4/M5, + M3 fail-closed account); **Plan B** = the auth/validation/DoS fixes (M6 SSRF, M7/M8 DoS auth+cache, M20 `:id`, M2 dead-route disposition). Planner may re-shape; keep waves parallel-safe by file.
