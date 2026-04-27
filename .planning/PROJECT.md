# Steins & Vines — Kiosk Production Readiness

## What This Is

The Steins & Vines in-store kiosk POS system (`kiosk.html` + `js/kiosk.js`) allows staff and customers to browse products, add to cart, and pay via Helcim smart terminal. This milestone focuses on hardening the kiosk for daily production use — fixing bugs found during in-store testing, verifying stock accuracy, and ensuring proper Zoho integration.

## Core Value

**Every kiosk sale must result in an accurate Zoho sales order with correct stock deduction.** If the payment goes through, the inventory and accounting must reflect it. No ghost sales, no phantom stock.

## Requirements

### Validated

- ✓ Product catalog display from Zoho Inventory — existing (`js/kiosk.js`, `GET /api/kiosk/products`)
- ✓ Cart system with add/remove/quantity — existing (`js/kiosk.js`)
- ✓ Helcim POS terminal payment flow — existing (`POST /api/kiosk/sale`, `POST /api/pos/collect`)
- ✓ Zoho sales order creation after payment — existing (`zoho-middleware/routes/pos.js`)
- ✓ Auto-void if Zoho fails after charge — existing (`zoho-middleware/routes/pos.js`)
- ✓ Helcim webhook for async payment results — existing (`POST /api/webhooks/helcim`)
- ✓ PIN login for staff access — recently added
- ✓ Redis product caching (5 min TTL) — existing (`zoho:kiosk-products`)

### Active

- [ ] Stock warning when cart quantity exceeds available stock (with user override)
- [ ] Category filter should not show Zoho item types ("goods", "services") as filter options
- [ ] Stock levels display accurately and update after sales
- [ ] Sales orders create properly in Zoho with correct line items and amounts
- [ ] Edge case handling: network hiccups, terminal timeouts, concurrent sales

### Out of Scope

- New kiosk features (refunds, shift reports, receipt printing) — future milestone
- Online checkout changes — separate system, not part of this milestone
- Admin dashboard changes — no kiosk admin work in scope

## Context

- Kiosk is a standalone IIFE app (`js/kiosk.js`, 3154 lines) served from GitHub Pages
- Middleware on Railway handles Zoho and Helcim API calls
- `HELCIM_DEVICE_CODE` env var targets the physical terminal
- Kiosk products use a separate Redis cache key (`zoho:kiosk-products`) from the online catalog
- PIN login was just added — stability needs verification during testing
- The kiosk has been tested in-store but is not yet relied on for daily sales
- `zoho-middleware/routes/pos.js` (1328 lines) is the largest middleware route file

## Constraints

- **Tech stack**: Vanilla JS (ES5 + `var`), no framework changes — match existing patterns
- **Deployment**: Changes go to staging first, production only after manual approval
- **Testing**: `cd zoho-middleware && npm test` must pass; kiosk routes have low test coverage currently
- **Zoho API**: Rate-limited; stock checks must use cached data where possible
- **Terminal**: Helcim smart terminal is the only payment method for kiosk (no manual entry)

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Stock warning with override (not hard block) | Staff may know about incoming shipments or need to sell floor samples | — Pending |
| Polish existing kiosk, not rebuild | System works end-to-end; focus on edge cases and reliability | — Pending |

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
*Last updated: 2026-04-27 after initialization*
