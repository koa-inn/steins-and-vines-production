---
gsd_state_version: 1.0
milestone: v1.1
milestone_name: Brewpad Reliability & Integration
status: executing
stopped_at: "Completed 08-04: promo dual-cart combined total re-render fix"
last_updated: "2026-05-04T18:20:16.943Z"
last_activity: 2026-05-04
progress:
  total_phases: 5
  completed_phases: 2
  total_plans: 11
  completed_plans: 10
  percent: 91
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-04-29)

**Core value:** Staff can trust BrewPad to save their work and see the full journey from kit sale to finished batch.
**Current focus:** Phase 08 — first-batch-promo

## Current Position

Phase: 08 (first-batch-promo) — EXECUTING
Plan: 3 of 6
Status: Ready to execute
Last activity: 2026-05-04

Progress: [##########] 100% (Phase 6)

## Performance Metrics

**Velocity:**

- Total plans completed: 5
- Average duration: 10 min
- Total execution time: 52 min

## Accumulated Context

### Decisions

- D-07 implemented: 5-min warning timer calls tryRefreshToken() for silent auto-refresh instead of showing a toast
- D-08 implemented: silent success path shows no toast — staff never interrupted during normal use
- D-04 resolved as interactive-during-refresh: app stays interactive while _refreshInFlight is true; overlay only on failure (D-09)
- Preserve login_at across refreshes by reading raw localStorage before saveSession (avoids circular dep with loadSession)
- D-09 implemented: showSessionExpiredOverlay() shows blocking overlay (z-index 1000, role=dialog, aria-modal) instead of showSignInButton() on auth failure
- D-06 implemented: restoreAllFormDrafts() returns bool; showApp() shows "Your in-progress work has been restored" toast when any draft restored
- D-05 implemented: all 5 form types (create-batch, measurements, batch detail, reading, schedule) registered in _formSavers registry

- D-11 implemented: Kiosk badge uses shouldShowKioskBadge(source, status) -- visible only when source=kiosk AND status=pending
- D-12 implemented: Zoho Ref row in detail view only (not list row), conditionally rendered when zoho_so_number present
- Neutral warm grey for Pending badge (not amber/warning) to avoid semantic collision with Secondary fermentation status
- skipRetryQueue parameter in callAppsScriptCreateBatch prevents double-queueing during retry sweep
- Retry sweep placed outside Zoho auth conditional since it calls Apps Script, not Zoho
- callAppsScriptCreateBatch returns { ok: true/false } so retry sweep distinguishes success from app error
- [Phase 08]: Re-render trigger placed synchronously after renderReservationItems() in both applyPromoCode() and Remove handler — no event-based indirection needed
- [Phase ?]: Form draft pattern: _FORM_DRAFT_KEY constant with save-on-input, restore-on-load, clear-on-success in 12-checkout.js

### Roadmap Evolution

- 2026-04-29: v1.1 roadmap created with 3 phases (5-7), continuing from v1.0 Phase 4

### Pending Todos

None.

### Blockers/Concerns

- Helcim webhook configuration blocked by Helcim Hub UI bug (support ticket pending) -- affects kiosk cancel detection but not brewpad work directly

## Session Continuity

Last session: 2026-05-04T18:20:16.939Z
Stopped at: Completed 08-04: promo dual-cart combined total re-render fix
Resume file: None
