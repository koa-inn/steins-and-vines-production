---
phase: 03-resilience-session-stability
plan: 01
subsystem: api, frontend
tags: [kiosk, helcim, terminal, resilience, pos, polling]

# Dependency graph
requires:
  - phase: 02-sales-order-integrity
    provides: POST /api/kiosk/sale/confirm endpoint with catalog validation, tax, discount, consignment
provides:
  - 3-step terminal payment flow (push → poll → confirm) replacing single long-lived request
  - GET /api/kiosk/sale/status endpoint for frontend-driven polling
  - Gateway timeout immunity (each request <5s vs old 180s max)
affects: [kiosk frontend payment flow, middleware pos routes]

# Tech tracking
tech-stack:
  added: []
  patterns: [async terminal push with client-side polling, 202 Accepted for async operations]

key-files:
  created: []
  modified:
    - zoho-middleware/routes/pos.js
    - js/kiosk.js
    - js/kiosk.min.js
    - zoho-middleware/__tests__/pos-tax.test.js

key-decisions:
  - "POST /api/kiosk/sale returns 202 immediately after terminal push -- no server-side polling"
  - "Frontend polls GET /api/kiosk/sale/status every 3s -- single Redis/API check per call"
  - "Confirm Manually fallback appears at 15s (was 5s in old flow)"
  - "saleCompleted flag + pollTimer cleanup prevents double-processing across all code paths"
  - "Invoice creation stays in /api/kiosk/sale/confirm (unchanged) -- no data needs to pass through Redis between steps"

# Completion
status: complete
completed: 2026-04-29
commit: d228889
deployed: staging + production
---

## Summary

Split the kiosk terminal payment from a single long-lived request (up to 180s) into 3 short-lived HTTP steps: push to terminal (202), poll for result (GET status), and confirm/create invoice (POST confirm). This eliminates Railway gateway timeouts and gives the frontend control of the polling loop with cancel and manual-confirm fallbacks.

## What Changed

**POST /api/kiosk/sale** — Stripped server-side polling loop, invoice creation, void logic, and consignment tracking. Now validates cart against catalog, computes grandTotal with per-item tax, pushes to Helcim terminal, and returns 202 `{ pending: true, reference }`.

**GET /api/kiosk/sale/status** (new) — Takes `?ref=X`, calls `helcimLib.pollTerminalResult(ref)` for a single Redis/API check, returns `{ status: 'pending' | 'approved' | 'declined' }`.

**js/kiosk.js** — Replaced blocking fetch with 3-step flow: push → poll every 3s → confirmSale() on approval. Cancel clears pollTimer. "Confirm Manually" appears after 15s. saleCompleted flag guards all paths.

**Tests** — 2 pos-tax tests updated from checking zohoPost invoice calls (no longer happens) to verifying 202 pending response + correct terminalPurchase amount. Confirm endpoint already had equivalent tax_id tests.
