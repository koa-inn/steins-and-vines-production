---
gsd_state_version: 1.0
milestone: v3.0
milestone_name: Catalog Subpages
status: verifying
stopped_at: Completed 25-04-PLAN.md (Phase 25 complete)
last_updated: "2026-06-04T16:36:01.820Z"
last_activity: 2026-06-04
progress:
  total_phases: 6
  completed_phases: 6
  total_plans: 15
  completed_plans: 15
  percent: 100
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-05-27)

**Core value:** Customers can discover, select, or co-create fermentation recipes and purchase them as a complete package — with ingredient inventory, pricing, and batch tracking handled automatically by the system.
**Current focus:** Phase 25 — calcom-booking-migration

## Current Position

Phase: 25 (calcom-booking-migration) — EXECUTING
Plan: 4 of 4
Status: Phase complete — ready for verification
Last activity: 2026-06-04

Progress: [██████████] 100%

## Performance Metrics

**Velocity:**

- Total plans completed: 6 (this milestone)
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

- Federal brewing licence pending — BEER_SALES_ENABLED must remain false in Railway production

## Session Continuity

Last session: 2026-06-04T16:36:01.814Z
Stopped at: Completed 25-04-PLAN.md (Phase 25 complete)
Resume file: None
