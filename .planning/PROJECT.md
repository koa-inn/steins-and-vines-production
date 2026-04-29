# Steins & Vines — Brewpad Reliability & Integration

## What This Is

The Steins & Vines BrewPad (`brewpad.html` + `js/brewpad.js`) is an iPad-first batch management terminal used by staff to track fermentation batches, tasks, plato readings, and schedules. This milestone focuses on making BrewPad rock-solid for daily use and connecting it to the kiosk/Zoho ecosystem so batch tracking flows naturally from kit sales.

## Core Value

**Staff can trust BrewPad to save their work and see the full journey from kit sale to finished batch.** Auth never silently expires, form data is never lost, and every batch traces back to its sales order.

## Current Milestone: v1.1 Brewpad Reliability & Integration

**Goal:** Make BrewPad auth bulletproof and connect it to kiosk sales and Zoho for a seamless sale-to-batch workflow.

**Target features:**
- Auth that doesn't silently expire and lose form data
- No duplicate login prompts
- Kiosk kit sale auto-creates a batch linked to customer and sales order
- Zoho integration for full audit trail (sale → batch → fermentation → done)

## Requirements

### Validated

- ✓ Dashboard with batch status overview and upcoming tasks — existing
- ✓ Batch list with sorting, filtering, and detail view — existing
- ✓ Plato reading entry and chart visualization — existing
- ✓ Task management with grouping and completion — existing
- ✓ Multi-batch measurement entry — existing
- ✓ Fermentation schedule templates — existing
- ✓ Batch QR codes and PDF label generation — existing
- ✓ Google OAuth staff authentication — existing (but unreliable)
- ✓ Batch creation with product/customer search — existing

### Active

- [ ] Auth sessions that persist reliably without silent expiry
- [ ] Form state protection — unsaved work survives auth refresh
- [ ] No duplicate/stacked login prompts
- [ ] Kit sale on kiosk auto-creates a batch in brewpad
- [ ] Batches linked to Zoho sales orders for audit trail
- [ ] Batch lifecycle visible from sale through fermentation to completion

### Out of Scope

- New batch management features (refunds, advanced analytics) — future milestone
- Kiosk UI changes beyond what's needed for batch creation handoff
- Online checkout integration — kiosk-only for now
- Brewpad redesign or new tabs — reliability and integration only

## Context

- BrewPad is a standalone IIFE app (`js/brewpad.js`, 3868 lines) served from GitHub Pages
- Uses Google OAuth (GSI) for authentication, tokens refresh via `_silentRefreshTimer`
- Backend is Google Apps Script (`adminApi.gs`) with Google Sheets as database
- Batch data: 5 Sheets tabs (Batches, FermSchedules, BatchTasks, PlatoReadings, VesselHistory)
- Kiosk creates Zoho sales orders via Railway middleware when kits are sold
- Current batch creation is fully manual — no connection to kiosk sales
- Auth issues: silent token expiry, form data loss on re-login, duplicate auth prompts
- Staff use BrewPad on iPad primarily

## Constraints

- **Tech stack**: Vanilla JS (ES5 + `var`), no framework changes — match existing patterns
- **Auth**: Google OAuth via GSI library — cannot switch auth providers
- **Backend**: Google Apps Script + Sheets for batch data — Zoho for sales/inventory
- **Deployment**: Changes go to staging first, production only after manual approval
- **iPad-first**: UI must work well on iPad Safari

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Keep Google Sheets as batch backend | Already working, staff familiar, Apps Script API adequate | — Pending |
| Bridge kiosk→brewpad via middleware | Kiosk already talks to middleware; middleware can trigger batch creation | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-04-29 after milestone v1.1 initialization*
