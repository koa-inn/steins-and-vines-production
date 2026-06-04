---
gsd_state_version: 1.0
milestone: v3.0
milestone_name: Catalog Subpages
status: executing
stopped_at: Completed 25-02-PLAN.md
last_updated: "2026-06-04T14:07:56.565Z"
last_activity: 2026-06-04
progress:
  total_phases: 6
  completed_phases: 5
  total_plans: 15
  completed_plans: 13
  percent: 83
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-05-27)

**Core value:** Customers can discover, select, or co-create fermentation recipes and purchase them as a complete package — with ingredient inventory, pricing, and batch tracking handled automatically by the system.
**Current focus:** Phase 25 — calcom-booking-migration

## Current Position

Phase: 25 (calcom-booking-migration) — EXECUTING
Plan: 3 of 4
Status: Ready to execute
Last activity: 2026-06-04

Progress: [█████████░] 87%

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

### Pending Todos

None.

### Blockers/Concerns

- Federal brewing licence pending — BEER_SALES_ENABLED must remain false in Railway production

## Session Continuity

Last session: 2026-06-04T14:07:56.559Z
Stopped at: Completed 25-02-PLAN.md
Resume file: None
