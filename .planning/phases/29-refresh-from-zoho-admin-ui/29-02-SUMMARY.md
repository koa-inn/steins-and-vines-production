---
phase: 29-refresh-from-zoho-admin-ui
plan: "02"
subsystem: admin-frontend
tags: [zoho-refresh, admin-modal, pure-helpers, tdd, batch-management]
dependency_graph:
  requires: [phase-28-zoho-customer-read-back-path]
  provides: [admin-zoho-refresh-button, admin-zoho-ref-row, admin-email-phone-rows]
  affects: [js/admin.js, tests/frontend/admin-zoho-refresh.test.js]
tech_stack:
  added: []
  patterns: [ES5-vanilla-js, tdd-red-green, module-exports-guard, adminApiPost-expectedVersion]
key_files:
  created:
    - tests/frontend/admin-zoho-refresh.test.js
  modified:
    - js/admin.js
decisions:
  - "textContent used for DOM patch (XSS-safe by design); escapeHTML used only in html+= string building"
  - "isValidZohoNumber gate placed in HTML rendering block — button never emitted for non-format values"
  - "Zoho Ref row rendered for all batches (shows 'Not linked' for absent/invalid refs) for consistency"
  - "soNumber validated by isValidZohoNumber before render so toast messages need no escaping"
metrics:
  duration: "~20 minutes"
  completed: "2026-06-12T14:34:06Z"
  tasks_completed: 2
  tasks_total: 2
  files_changed: 2
---

# Phase 29 Plan 02: Admin Zoho Refresh — Summary

Admin Batches detail modal gets Zoho Ref/Email/Phone grid rows and a format-gated Refresh button that pulls customer name/email/phone from the Phase 28 middleware endpoint and updates the modal in place with distinct per-state toasts.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 (TDD) | Add exported pure helpers | 959b970 (RED), d0cf5ed (GREEN) | js/admin.js, tests/frontend/admin-zoho-refresh.test.js |
| 2 | Add grid rows, button, refresh handler | ccfec36 | js/admin.js |

## What Was Built

### Task 1: Pure helpers (TDD RED/GREEN)

Three pure functions added inside the IIFE in `js/admin.js`, exported via Object.assign module.exports guard:

- `isValidZohoNumber(num)` — returns `true` only for `/^(INV|SO)-\d+$/i` matches (D-08)
- `buildRefreshUpdates(fetched)` — returns object with only non-empty customer_name/email/phone fields after trimming (D-13 / Phase 28 D-02)
- `compareRefreshFields(fetched, batch)` — trim + case-insensitive no-change comparison; returns `true` when all non-empty fetched fields already match (D-12)

26 unit tests in `tests/frontend/admin-zoho-refresh.test.js`, all passing.

### Task 2: Grid rows, button, and handler

**Info grid additions in `renderBatchDetailModal`:**
- Customer row: wrapped value in `<span id="batch-detail-customer">` for in-place patching
- Email row: `<strong>Email:</strong> <span id="batch-detail-email">`
- Phone row: `<strong>Phone:</strong> <span id="batch-detail-phone">`
- Zoho Ref row: shows `<span id="batch-detail-zoho-ref">` + Refresh button when `isValidZohoNumber(b.zoho_so_number)` passes; otherwise shows "Not linked" with no button

**Refresh handler wired in event-binding block:**
- Button disabled + "Refreshing…" label during fetch
- GET `/api/batch/customer-by-number` with explicit `x-api-key: SHEETS_CONFIG.MW_API_KEY` header (not getMwHeaders, which omits the key for non-mutating calls)
- Status mapping: 404 → not_found, 502 → zoho_error, other !ok → generic
- `compareRefreshFields` short-circuit → "Already up to date" toast, skip update_batch (D-12)
- `buildRefreshUpdates` → `adminApiPost('update_batch', { batch_id, expectedVersion: batchVersion, updates })`
- On success: `batchVersion = result.newVersion` (optimistic lock sync)
- In-place DOM patch via `textContent` (XSS-safe) on customer/email/phone nodes + `b` object update
- `loadBatchesData()` called to refresh admin list cache (D-06)
- Distinct toasts: success / partial (contact_unavailable) / void/deleted warning (D-10/D-11)
- Error toasts: 404 / 502 / version-conflict / generic (D-10)
- Button restored on every exit path (success, no-change, error)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Prevented double-encoding in DOM textContent patch**
- **Found during:** Task 2 implementation review
- **Issue:** Plan template suggested `escapeHTML(getCustomerDisplayName(b))` for `textContent` assignment. `textContent` does not interpret HTML — calling `escapeHTML` would produce literal `&amp;` text in the UI.
- **Fix:** Used raw values for `textContent` assignments (XSS protection is inherent). Kept `escapeHTML` only for `html +=` string concatenation where innerHTML parsing occurs.
- **Files modified:** js/admin.js (lines 6097–6104)
- **Commit:** ccfec36

**2. [Rule 1 - Bug] Removed escapeHTML from showToast message strings**
- **Found during:** Task 2 implementation review
- **Issue:** `showToast` sets message via `msgSpan.textContent = message` (line 99) — pre-escaping with `escapeHTML` would render literal `&amp;` characters in toast text.
- **Fix:** Passed plain `soNumber` string to toast messages. `soNumber` is validated by `isValidZohoNumber` to match `/^(INV|SO)-\d+$/i`, containing only safe characters, so XSS risk is nil.
- **Files modified:** js/admin.js (lines 6109–6116, 6126–6127)
- **Commit:** ccfec36

## Threat Model Compliance

| Threat | Status |
|--------|--------|
| T-29-A1: XSS in DOM patch | Mitigated — `textContent` used for dynamic patches; `escapeHTML` used in html+= templates |
| T-29-A2: zoho_so_number display | Mitigated — `escapeHTML(b.zoho_so_number)` in html template; `encodeURIComponent` in query string |
| T-29-A3: MW_API_KEY in JS | Accepted — semi-public by design |
| T-29-A4: blank Zoho values overwriting batch | Mitigated — `buildRefreshUpdates` omits empty fields; `compareRefreshFields` skips no-op writes |
| T-29-A5: concurrent edit clobber | Mitigated — `expectedVersion: batchVersion`; conflict → "reload" toast; `batchVersion = result.newVersion` |
| T-29-SC: npm installs | No new packages installed |

## Known Stubs

None — all data sources wired. Initial Email/Phone values from `b.customer_email` / `b.customer_phone` (existing batch fields); refreshed values from Phase 28 API response.

## Self-Check: PASSED

- `tests/frontend/admin-zoho-refresh.test.js` — exists and 26/26 tests pass
- `js/admin.js` — modified with helpers, grid rows, and handler
- Commits 959b970, d0cf5ed, ccfec36 — all exist in git log
- `npm test` — 458 tests pass
- `npm run lint -- js/admin.js` — 0 errors (118 pre-existing warnings)
