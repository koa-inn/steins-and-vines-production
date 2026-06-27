---
phase: 43-kiosk-manual-custom-line-item-with-notes
plan: "02"
subsystem: frontend/kiosk-pos
tags: [kiosk, custom-line, forked-ui, money-path, human-verified]
dependency_graph:
  requires: [custom-line-server-acceptance]
  provides: [custom-item-modal, custom-line-cart-wiring, items-mapper-custom-branch]
  affects: [js/kiosk.js, js/admin.js, js/kiosk.min.js, js/admin.min.js]
tech_stack:
  added: []
  patterns: [forked-kiosk-parity, kiosk-modal-overlay, admin-openModal, tax_percentage-cart-entry]
key_files:
  created: []
  modified:
    - js/kiosk.js
    - js/admin.js
    - js/kiosk.min.js
    - js/admin.min.js
decisions:
  - "Modal mechanism differs per surface (kiosk.js style.display overlay; admin.js openModal/closeModal) but shared logic identical (D-06)"
  - "Custom cart entry carries tax_percentage (5/0) so kioskCalcTotals needs no change; items mapper forwards { custom, description, note, quantity, rate, taxable } (D-04/D-08)"
  - "Empty cart now rendered on init so the 'Add custom item' button is reachable before any catalog item is added (checkpoint deviation)"
metrics:
  completed_date: "2026-06-27"
  tasks_completed: 4
  files_changed: 4
  human_verified: true
---

# Phase 43 Plan 02: Forked Custom-Item UI Summary

Staff-facing "Add custom item" affordance on **both** forked kiosk surfaces (standalone `js/kiosk.js` and admin-embedded `js/admin.js` = `admin.html?tab=kiosk`, the production kiosk), wired to the server contract from plan 43-01. Human-verified on staging by the owner.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Custom-item modal + cart wiring in js/kiosk.js | 2aafb49 | js/kiosk.js |
| 2 | Duplicate custom-item logic into js/admin.js (fork) | 9cad213 | js/admin.js |
| 3 | Rebuild bundles + full gate (build + both suites + lint) | ebd87b9 | js/kiosk.min.js, js/admin.min.js, *.html |
| 4 | Human verify on both surfaces (checkpoint) | — | (owner sign-off) |

## What Was Built

- **"+ Add custom item" button** in the cart area on both surfaces, opening a focused modal with: Description (required, 1–100 chars), Note (optional), Price, Qty (default 1), Tax-exempt toggle (default off = taxable 5% GST).
- **Confirm prompt** (`window.confirm`) when the entered price is `> $2000` or negative (D-03).
- **Cart wiring:** custom line stored under a `custom-N` key with `custom:true`, `tax_percentage` (5 or 0). Standard qty +/- and remove controls reused (D-07). Excluded from discount presets on the client (D-08).
- **Items mapper** (`kioskProceedToPayment`) forwards `{ custom:true, description, note, quantity, rate, taxable }` (no `item_id`) to `/api/kiosk/sale` + `/sale/confirm`, matching the 43-01 server contract.
- **Modal divergence (intentional, D-06):** `kiosk.js` uses a fixed-position `style.display` overlay; `admin.js` uses the global `openModal('Add custom item', html)` / `closeModal()`. Shared JS logic is identical.

## Deviations from Plan

**1. Empty-cart render fix (checkpoint finding, commit `8714cf3`).** During human verification the owner found the "+ Add custom item" button only appeared after the first catalog item was added. Root cause: the static cart container had no button and `kioskRenderCart()` (which injects it) only fired on cart change. Fix: call `kioskRenderCart()` at kiosk init on both surfaces (`kiosk.js` init + `admin.js` dashboard init) so the empty-cart state renders the button immediately. Rebuilt + re-gated.

## Threat Flags

No new endpoints. Reuses the 43-01-hardened `/api/kiosk/sale` + `/sale/confirm`. Client-entered price is bounded server-side (43-01); client `taxable` flag drives the server tax path; description/note sanitized server-side. Money-path invariant (terminal charge == Zoho invoice tax) is enforced on the server (43-01), not the client.

## Verification

- Full gate green: build OK, frontend 928 tests, middleware 977 tests, lint 0 errors.
- Both forked files carry the feature (per-file grep gates passed).
- **Human-verified on staging (owner):** modal + fields + confirm prompt + GST math + discount-skip on both standalone kiosk and `admin.html?tab=kiosk`. Owner sign-off: "custom items look good."

## Self-Check: PASSED

- FOUND: js/kiosk.js + js/admin.js custom-item modal + cart wiring
- FOUND: commits 2aafb49, 9cad213, ebd87b9, 8714cf3
- Human-verified on both surfaces (staging)
- Full test + lint gate green
