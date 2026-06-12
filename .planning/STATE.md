---
gsd_state_version: 1.0
milestone: v4.1
milestone_name: BrewPad Batch Lifecycle & Zoho Sync
status: executing
stopped_at: Phase 29 Plan 03 Task 1 complete — awaiting iPad Safari human-verify checkpoint
last_updated: "2026-06-12T15:00:00Z"
last_activity: 2026-06-12 -- Phase 29 Plan 03 Task 1 complete: build artifacts rebuilt, full gate green, pushed to staging (ca51b11)
progress:
  total_phases: 13
  completed_phases: 9
  total_plans: 26
  completed_plans: 24
  percent: 69
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-06-11)

**Core value:** Customers can discover, select, or co-create fermentation recipes and purchase them as a complete package — with ingredient inventory, pricing, and batch tracking handled automatically by the system.
**Current focus:** Phase 29 — refresh-from-zoho-admin-ui

## Current Position

Phase: 29 (refresh-from-zoho-admin-ui) — EXECUTING
Plan: 3 of 3 (Task 1 complete, Task 2 PAUSED — iPad UAT deferred, Task 3 pending)
Status: Executing Phase 29
Last activity: 2026-06-12 -- Phase 29 paused at 29-03 human-verify checkpoint (iPad UAT deferred; see phases/29-refresh-from-zoho-admin-ui/.continue-here.md)

Milestone v4.1 phase map:

- Phase 27: Pending Batch Visibility & Activation (BATCH-01..03)
- Phase 28: Zoho Customer Read-Back Path (ZSYNC foundation — middleware endpoint + Apps Script write-back)
- Phase 29: Refresh-from-Zoho Admin UI (ZSYNC-01..02; depends on Phase 28)

## Performance Metrics

**Velocity:**

- Total plans completed: 14 (this milestone)
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

## Accumulated Context

### Decisions

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

### Roadmap Evolution

- Phase 26 added (2026-06-06): Cloudflare Edge Protection — free-tier CDN/bot mitigation in front of GitHub Pages + Railway middleware. Added as a standalone phase; v3.0/v4.0 milestone archives intentionally deferred (see Deferred Items).
- Phase 26 COMPLETE (2026-06-06): Cloudflare live on production (proxy + SSL Full + Bot Fight Mode + rate limit); email auth hardened (SPF/DKIM/DMARC); staging grey-clouded. Executed live (no PLAN.md). See 26-SUMMARY.md. Deferred follow-up: protect Railway API via api.steinsandvines.ca if analytics show bot traffic there.
- Phase 30 added (2026-06-11): Assessment quick wins — ~20 small high-impact fixes from the June 2026 full project assessment (PROJECT_ASSESSMENT.md at repo root, gitignored).
- Phase 29.1 inserted after Phase 29: Batch customer reassignment (WALK-IN → real customer) with Zoho invoice propagation; requested during phase 27 UAT (URGENT)
- Phase 27.1 inserted after Phase 27: Pending batch deletion with confirmation (today: manual Google Sheet row deletion when a pending batch duplicates an existing batch); requested during phase 27 UAT (URGENT)

### Deferred Items

Acknowledged at the deferred v4.0 close on 2026-06-06 (chose to add Phase 26 instead of running complete-milestone):

| Category | Item | Status |
|----------|------|--------|
| verification | 22-VERIFICATION.md | human_needed |
| verification | 23-VERIFICATION.md | human_needed |
| uat | 23-HUMAN-UAT.md | partial (6 scenarios) |
| quick_task | 260506-b85-split-makers-fee-materials | missing |
| quick_task | 260508-c4f-customer-name-split | missing |

Also outstanding: v3.0 (Phases 20–24) and v4.0 (Phase 25) were marked shipped in ROADMAP but never formally archived to `.planning/milestones/`; STATE frontmatter still reads `milestone: v3.0`. Cleanup deferred.

### Pending Todos

None.

### Blockers/Concerns

- **Prod deploy HELD until v4.1 BrewPad phases complete** (user decision 2026-06-11): phases 27, 27.1, 28, 29, 29.1 ship to production as one batch. Staging already has phase 27 (UAT passed) + quick fix 260611-94q. NOTE: the contacts-payload data-loss bug remains live in prod until this push — BrewPad/kiosk-created customers get no email/phone in Zoho. User accepted; interim prod push available on request.
- apps-script/adminApi.gs deployed manually by user 2026-06-11 (phase 27 changes live in Apps Script).

- Federal brewing licence pending — BEER_SALES_ENABLED must remain false in Railway production

### Quick Tasks Completed

| # | Description | Date | Commit | Directory |
|---|-------------|------|--------|-----------|
| 260611-94q | Fix POST /api/contacts dropping email/phone/name fields in Zoho (contact_persons payload) | 2026-06-11 | 53d9ff5 | [260611-94q-fix-post-api-contacts-dropping-email-pho](./quick/260611-94q-fix-post-api-contacts-dropping-email-pho/) |

## Session Continuity

Last session: 2026-06-12T15:00:00Z
Stopped at: Phase 29 Plan 03 Task 2 checkpoint:human-verify (iPad Safari UAT)
Resume file: .planning/phases/29-refresh-from-zoho-admin-ui/29-03-PLAN.md (Task 3)
