---
gsd_state_version: 1.0
milestone: v4.2
milestone_name: Payment Path Hardening & Deploy Safety
status: executing
stopped_at: Phase 32 context gathered
last_updated: "2026-06-18T00:44:52.619Z"
last_activity: 2026-06-18 -- Phase 32 execution started
progress:
  total_phases: 19
  completed_phases: 16
  total_plans: 55
  completed_plans: 52
  percent: 84
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-06-17)

**Core value:** Customers can discover, select, or co-create fermentation recipes and purchase them as a complete package — with ingredient inventory, pricing, and batch tracking handled automatically by the system.
**Current focus:** Phase 32 — fail-closed-hardening-access-control

## Current Position

Phase: 32 (fail-closed-hardening-access-control) — EXECUTING
Plan: 1 of 4
Status: Executing Phase 32
Last activity: 2026-06-18 -- Phase 32 execution started

## Performance Metrics

**Velocity:**

- Total plans completed: 31 (prior milestone v4.1)
- Average duration: 3 min
- Total execution time: 3 min

| Phase | Plan | Duration | Tasks | Files |
|-------|------|----------|-------|-------|
| 20 | 01 | 177s | 2/2 | 2 |
| 20 | 02 | manual | 2/2 | 2 |
| Phase 25 P01 | 15min | 2 tasks | 3 files |
| Phase 25 P02 | 242s | 2 tasks | 2 files |
| Phase 25 P03 | 20min | 2 tasks | 2 files |
| Phase 25 P04 | 15min | 1 tasks | 5 files |
| Phase 28-zoho-customer-read-back-path P01 | 161 | 3 tasks | 2 files |
| Phase 29-refresh-from-zoho-admin-ui P03 | 60 | 3 tasks | 4 files |
| Phase 29.3 P01 | 442 | 3 tasks | 2 files |
| Phase 29.3 P02 | 120 | 1 tasks | 1 files |
| Phase 29.3 P03 | 420 | 3 tasks | 5 files |

## Accumulated Context

### Decisions

- [30-02]: Build-time rm -rf .planning in deploy-production.yml is the authoritative prod mechanism (Jekyll exclude bypassed by auto-injected .nojekyll)
- [30-02]: CNAME-swap deploy dance retired — prod deploy is plain git push production main --force; enforce-cname.yml auto-pins domain
- [30-03]: hero-subtitle key removed from home.json rather than replaced — 13-init.js undefined check leaves inline HTML fallback intact
- [30-03]: story-text empty key and its <p data-content="story-text"> both removed — story-text-2 is the real content
- [30-03]: 404.html root-absolute paths + minified bundles (/css/styles.min.css, /js/main.min.js); all images and icons also root-absolute
- [30-03]: rgba(229,222,193,0.85) for dark-background placeholders (beer-waitlist, reservation-bar-clear), matching .beer-banner p 0.9 pattern
- [30-04]: beer waitlist routes through /api/contact with JSON body {name: 'Beer Waitlist Signup', email, message} — reuses existing reCAPTCHA/validation/mailer, no new infra
- [30-04]: kiosk idle-reset extracts _clearKioskSession() at module level clearing sv-cart-ferment, sv-cart-ingredients, sv-reservation, and sessionStorage sv-milled-keys
- [30-06]: node-cron v4 CJS require().schedule(expr, fn) API is backward-compatible — server.js cron call unchanged
- [30-06]: package-lock.json is gitignored at repo root — only package.json committed for node-cron upgrade
- [30-01]: stamp:sw removed — sw.js was the only dead service worker; offline fallback kept intact in 404.html
- [30-01]: 9 content/ files confirmed dead via zero-reference grep before deletion
- [30-01]: !lib/gp.js jest exclusion removed; !lib/mailer.js retained (still-needed exclusion for Plan 06)
- [30-05]: flattenCustomFields extracted as top-level helper with module.exports for test isolation; replaces inline forEach in 07-catalog-kits.js fetchFromMiddleware()
- [30-05]: js/lib/utils.js added to concat:js BEFORE 02-utils.js; 02-utils.js weak escapeHTML removed (canonical resolves via global); Node test fallback require('../lib/utils').escapeHTML added to 02-utils.js top
- [30-05]: kiosk.js keeps its own standalone escapeHTML (not in concat); null guard added; apostrophe was already present
- [30-05]: brewpad.js local escapeHTML upgraded in-place (apostrophe + null guard); still standalone
- [v3.0 Roadmap]: One shared module `16-catalog-subpage.js` parameterized via `SUBPAGE_CONFIG` per page — not 5 separate modules
- [v3.0 Roadmap]: Static sub-nav HTML duplicated across pages (no SSI on GitHub Pages), CSS-only active state via `body[data-page]` selector
- [v3.0 Roadmap]: Fuse.js v7.1.0 already vendored — no new libraries needed
- [v3.0 Roadmap]: Search overlay uses lazy-init single Fuse instance over all ingredients (single shared cache key)
- [v3.0 Roadmap]: `_activeCartTab` must be overridden to `'ingredients'` at module init on all subpages
- [20-01]: Pre-flight CF label inspection added to tag-subcategories.js — aborts if Subcategory CF label not found in Zoho
- [20-01]: RULES order: Hops → Cleaning → Equipment → Yeast → Grain → Additive → Packaging
- [20-02]: Zoho item groups have different CF sets — only cf_type="Ingredient" has Subcategory CF; Equipment/Packaging/Cleaning use cf_type as fallback category
- [20-02]: verify-subcategories.js reads cf_subcategory (Zoho's flat field name) with cf_type fallback
- [20-02]: Standalone scripts need cache.init() + zohoAuth.init() to load Redis-stored refresh token
- [Phase ?]: Cal.com free tier confirmed: API keys + webhooks both available on free plan (not paywalled)
- [Phase ?]: bookings cal-api-version confirmed as 2026-02-25 (live docs, 2026-06-04)
- [Phase ?]: Env var names: CALCOM_EVENT_TYPE_FERMENT_KIT + CALCOM_EVENT_TYPE_BOTTLING in validateEnv and routes
- [Phase ?]: CALCOM_EVENT_TYPE_FERMENT_KIT used as primary booking event type (matches Railway env; not CALCOM_EVENT_TYPE_FERMENT as plan spec)
- [Phase ?]: Dual-path /webhooks/calcom registration covers server.js:239 key-guard exemption without modifying server.js
- [Phase ?]: BOOKING_CANCELLED date derived from payload.startTime -> payload.booking.start -> payload.start; unparseable = safe no-op
- [Phase ?]: Zoho Bookings code removed; CALCOM_EVENT_TYPE_FERMENT_KIT + BOTTLING confirmed env names; offline fallback preserved
- [Phase ?]: [Phase 29-03]: Railway-only CLI deploy pattern for live middleware — ships endpoint to Railway without touching production git repo or breaking v4.1 batch hold
- [29.3-01]: MAX_PAGES=4 hard cap for Zoho invoice scan (D-01) — never read from request, protects Zoho quota (prior quota-exhaustion incident)
- [29.3-01]: get_batches dedup uses server_token param (not token) for Apps Script GET — e.parameter.token is Google OAuth-validated and rejects server tokens (regression guard test added)
- [29.3-01]: source='zoho_scan' distinguishes scan-created batches from kiosk path; customer_email omitted (no PII, T-29.3-06)
- [Phase ?]: [29.3-02]: zoho_so_number idempotency guard placed after missing_fields check and before lock acquisition — duplicates rejected without any sheet I/O
- [Phase ?]: [29.3-03]: Four pure helpers placed before IIFE for module.exports testability; bp-pull-sheet reuses .bp-confirm-sheet CSS; background scan fires immediately on sheet open
- [v4.2 Roadmap]: No separate staging middleware — middleware changes deploy to the prod Railway instance via the production git repo; staging site calls prod middleware
- [v4.2 Roadmap]: Tests land in Phase 31 before hardening in Phase 32 — the safety net must exist before the behavior changes it protects
- [v4.2 Roadmap]: MONITOR-01 (uptime monitor) and DEPLOY-02 (runbook) are human/ops tasks — they will be flagged as human-action checkpoints in plans

### Roadmap Evolution

- Phase 26 added (2026-06-06): Cloudflare Edge Protection — free-tier CDN/bot mitigation in front of GitHub Pages + Railway middleware. Added as a standalone phase; v3.0/v4.0 milestone archives intentionally deferred (see Deferred Items).
- Phase 26 COMPLETE (2026-06-06): Cloudflare live on production (proxy + SSL Full + Bot Fight Mode + rate limit); email auth hardened (SPF/DKIM/DMARC); staging grey-clouded. Executed live (no PLAN.md). See 26-SUMMARY.md. Deferred follow-up: protect Railway API via api.steinsandvines.ca if analytics show bot traffic there.
- Phase 30 added (2026-06-11): Assessment quick wins — ~20 small high-impact fixes from the June 2026 full project assessment (PROJECT_ASSESSMENT.md at repo root, gitignored).
- Phase 29.1 inserted after Phase 29: Batch customer reassignment (WALK-IN → real customer) with Zoho invoice propagation; requested during phase 27 UAT (URGENT)
- Phase 27.1 inserted after Phase 27: Pending batch deletion with confirmation (today: manual Google Sheet row deletion when a pending batch duplicates an existing batch); requested during phase 27 UAT (URGENT)
- Phase 29.2 inserted after Phase 29: BrewPad pending batch activation — port admin Activate / Schedule & Activate to BrewPad; pending-aware status badge (URGENT)
- Phase 29.3 inserted after Phase 29: Pull non-kiosk batch sales into BrewPad (bulk Zoho invoice scan) (URGENT)
- Phase 29.4 inserted after Phase 29: Wine drill-down analytics on BrewPad dashboard (split wine batches by subcategory/brand/manufacturer/time via catalog SKU join)
- Phases 31–33 added (2026-06-16): v4.2 Payment Path Hardening & Deploy Safety roadmap created

### Deferred Items

Acknowledged at the v4.1 milestone close (2026-06-17). All are GSD human-signoff/UAT bookkeeping on features that shipped to production and are working — none represent broken code:

| Category | Item | Status |
|----------|------|--------|
| verification | 22-VERIFICATION.md | human_needed |
| verification | 23-VERIFICATION.md | human_needed |
| verification | 27.1-VERIFICATION.md | human_needed |
| verification | 28-VERIFICATION.md | human_needed |
| verification | 29.1-VERIFICATION.md | human_needed |
| verification | 29.2-VERIFICATION.md | human_needed |
| verification | 29.3-VERIFICATION.md | human_needed |
| verification | 29.4-VERIFICATION.md | human_needed |
| verification | 30-VERIFICATION.md | human_needed |
| uat | 23-HUMAN-UAT.md | partial (6 scenarios) |
| uat | 27.1-HUMAN-UAT.md | partial (7 scenarios) |
| uat | 28-HUMAN-UAT.md | partial (1 scenario) |
| uat | 29.1-HUMAN-UAT.md | partial (2 scenarios) |
| uat | 29.2-HUMAN-UAT.md | partial (8 scenarios) |
| uat | 29.3-HUMAN-UAT.md | passed-core (2 edge cases deferred) |
| quick_task | 260506-b85-split-makers-fee-materials | unclosed tracking entry |
| quick_task | 260508-c4f-customer-name-split | unclosed tracking entry |
| quick_task | 260611-94q-fix-post-api-contacts-dropping-email-pho | shipped (53d9ff5); tracking entry unclosed |

Highest-value to revisit someday: Phase 29.2 activation flow (8 open UAT scenarios). Also outstanding: v3.0 (Phases 20–24) and v4.0 (Phases 25–26) were marked shipped in ROADMAP but never formally archived to `.planning/milestones/`. Cleanup deferred.

### Pending Todos

None.

### Blockers/Concerns

- Federal brewing licence pending — BEER_SALES_ENABLED must remain false in Railway production

### Quick Tasks Completed

| # | Description | Date | Commit | Directory |
|---|-------------|------|--------|-----------|
| 260611-94q | Fix POST /api/contacts dropping email/phone/name fields in Zoho (contact_persons payload) | 2026-06-11 | 53d9ff5 | [260611-94q-fix-post-api-contacts-dropping-email-pho](./quick/260611-94q-fix-post-api-contacts-dropping-email-pho/) |

## Session Continuity

Last session: 2026-06-18T00:07:40.881Z
Stopped at: Phase 32 context gathered
Resume file: .planning/phases/32-fail-closed-hardening-access-control/32-CONTEXT.md

## Operator Next Steps

- Run `/gsd-plan-phase 31` to plan the Money-Path Test Coverage phase
