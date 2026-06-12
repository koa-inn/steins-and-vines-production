---
phase: 29-refresh-from-zoho-admin-ui
verified: 2026-06-12T23:30:00Z
status: passed
score: 5/5 must-haves verified
overrides_applied: 0
re_verification:
  previous_status: gaps_found
  previous_score: 3/5
  gaps_closed:
    - "CR-01: Case-sensitivity contract mismatch — middleware now normalizes to uppercase before regex; frontend 400 handler added"
    - "CR-02: Refreshed customer name not visible — splitCustomerName now derives customer_firstname/customer_lastname and writes them to the update_batch payload and in-memory caches"
    - "WR-01: Dead version-conflict detection — isVersionConflict now matches 'modified' substring (actual Apps Script message)"
    - "WR-03: Double-encoding on textContent — escapeHTML removed from nameNode/emailNode/phoneNode textContent assignments in brewpad.js"
    - "WR-04: Trim parity — admin.js buildRefreshUpdates now does String(v).trim()"
  gaps_remaining: []
  regressions: []
---

# Phase 29: Refresh-from-Zoho Admin UI Verification Report (Re-verification)

**Phase Goal:** Staff can refresh a batch's customer info from its linked Zoho sales order/invoice with one click in the batch detail modal, with the action clearly disabled when no link exists
**Verified:** 2026-06-12T23:30:00Z
**Status:** passed
**Re-verification:** Yes — after gap-closure plans 29-04, 29-05, 29-06

---

## Goal Achievement

All five must-have truths are now VERIFIED in the codebase. The previous `gaps_found` status (CR-01 case contract, CR-02 name not re-rendered, WR-01/WR-03/WR-04) has been closed. Human UAT confirmed the core flow on iPad Safari staging (lowercase-ref refresh succeeds, customer name visibly updates, no console errors — approved 2026-06-12).

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | BrewPad and admin detail surfaces render Email and Phone rows showing current batch values | VERIFIED | `brewpad.js:2294-2295` (`bp-detail-email`, `bp-detail-phone`); `admin.js:5873-5874` (`batch-detail-email`, `batch-detail-phone`). Values sourced from `b.customer_email` / `b.customer_phone`. |
| 2 | Refresh button appears only when `zoho_so_number` matches `/^(INV\|SO)-\d+$/i`, and is absent for batches with no usable link (ZSYNC-02) | VERIFIED | CR-01 closed: middleware `pos.js:1379` now normalizes `(req.query.number || '').trim().toUpperCase()` before the case-sensitive regex, aligning with the frontend `/i` gate. Frontend 400 handlers added at `brewpad.js:2606` and `admin.js:6072`. Button rendered under `isValidZohoNumber()` guards at `brewpad.js:2310` and `admin.js:5875`. "Not linked" text shown when no valid ref (`admin.js:5878`). 76/76 pure-helper tests pass; 598/598 middleware tests pass. |
| 3 | Clicking refresh pulls customer name/email/phone, updates displayed rows in place, and name is visibly updated for all batch types — distinct per-state toasts for success/no-change/partial/voided/404/502 (ZSYNC-01) | VERIFIED | CR-02 closed: `splitCustomerName` helper (`brewpad.js:67`, `admin.js:9613`) derives `customer_firstname`/`customer_lastname` from the refreshed `customer_name` and adds them to the `updates` payload (`brewpad.js:2616-2618`, `admin.js:6090-6091`). In-memory batch patched with all three keys. `getCustomerDisplayName` (which prefers firstname/lastname) now renders the refreshed name for modern batches. `nameNode.textContent = getCustomerDisplayName(...)` at `brewpad.js:2654`; `customerNode.textContent = getCustomerDisplayName(b)` at `admin.js:6110`. WR-03 closed: `escapeHTML` removed from all three `textContent` assignments in brewpad refresh block (`brewpad.js:2654/2658/2662`). Email/phone patch confirmed at `brewpad.js:2658/2662`, `admin.js:6113/6116`. Toast variants wired for all endpoint states. Human UAT approved on iPad Safari staging. |
| 4 | Refresh is hidden for batches with no valid Zoho link; no erroring request fires (ZSYNC-02) | VERIFIED | When `b.zoho_so_number` absent or non-matching, no button rendered. `getElementById('bp-zoho-refresh-btn')` returns null; click handler never bound. No network request fires. Confirmed by human UAT. |
| 5 | No-change refresh shows "Already up to date" and skips the `update_batch` call; full test gate green (508 frontend / 598 middleware / lint 0 errors); build artifacts contain all fixes; staging deployed | VERIFIED | `compareRefreshFields` short-circuit at `brewpad.js:2622-2626`, `admin.js:6078-6082`. `npm test`: 508/508 pass (26 suites). `cd zoho-middleware && npm test`: 598/598 pass (29 suites). `npm run lint`: 0 errors, 118 pre-existing warnings. `grep -c "customer_firstname" js/admin.min.js js/brewpad.min.js` = 1/1. `grep -c "customer-by-number" js/admin.min.js js/brewpad.min.js` = 1/1. WR-01 closed: `isVersionConflict` matches both `'version'` and `'modified'` at `brewpad.js:58-62`, `admin.js:9600-9605`. WR-04 closed: `admin.js buildRefreshUpdates` now does `String(v).trim()`. |

**Score:** 5/5 truths verified

---

### Known Residual (Non-Blocking Edge Case)

The post-fix code review (29-REVIEW.md) found one new Critical: the D-12 `compareRefreshFields` short-circuit compares only `customer_name`/`customer_email`/`customer_phone` — not the derived `customer_firstname`/`customer_lastname`. This means a batch whose `customer_name` already matches Zoho but whose `customer_firstname`/`customer_lastname` are stale (a state created only by the original CR-02 bug before plan 29-05) will show "Already up to date" instead of repairing the display.

**Why this does not block phase passing:**

1. The state is only reachable for batches refreshed during the brief window between initial Phase 29 ship and plan 29-05 landing on the same day (2026-06-12). New refreshes on uncorrupted batches work correctly.
2. The phase goal is "Staff can refresh a batch's customer info... with one click." The core feature works for all forward-going refreshes. Human UAT on iPad Safari confirmed the name visibly updates.
3. The edge case is a data-repair gap for already-corrupted rows — it does not prevent the feature from working correctly for any new user action going forward.
4. The roadmap success criteria (SC-2: "updates the batch's displayed customer info without a full page reload") is met for all non-corrupted batches and for the UAT scenario.

This is tracked in 29-REVIEW.md as CR-01 (post-fix) for potential follow-up in a future plan. It does not invalidate the phase goal.

Additional post-fix review warnings (WR-01 fragility, WR-02 array input crash risk, IN-01/IN-02/IN-03/IN-04/IN-05) are informational or low-risk and do not affect the phase must-haves.

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `js/brewpad.js` | Refresh button, Email/Phone rows, 5 exported pure helpers, refresh handler | VERIFIED | Button at line 2311 under `isValidZohoNumber` guard. Email/Phone rows at 2294-2295. Helpers: `isValidZohoNumber` (49), `isVersionConflict` (58), `splitCustomerName` (67), `buildRefreshUpdates` (78), `compareRefreshFields` (96). All in `module.exports` at 5439-5443. Handler calls `customer-by-number`, `update_batch` with `expectedVersion`. WR-03: no `escapeHTML` on `textContent` assignments. |
| `js/admin.js` | Refresh button, Zoho Ref/Email/Phone rows, 5 exported pure helpers, refresh handler | VERIFIED | Button at 5876 under `isValidZohoNumber` guard. Email/Phone rows at 5873-5874. Helpers in IIFE + `module.exports` at 9675-9677. Handler calls `customer-by-number`, `update_batch` with `expectedVersion`. WR-04: `String(v).trim()` in `buildRefreshUpdates`. |
| `tests/frontend/brewpad-zoho-refresh.test.js` | Unit tests for 5 pure helpers | VERIFIED | 76 tests total across both suites (up from 53 at initial verification). All pass. Covers CR-01 case contract, splitCustomerName, isVersionConflict. |
| `tests/frontend/admin-zoho-refresh.test.js` | Unit tests for admin pure helpers | VERIFIED | Included in 76-test count. All passing. |
| `js/brewpad.min.js` | Rebuilt with all gap-fix code | VERIFIED | `customer_firstname` count=1, `customer-by-number` count=1. |
| `js/admin.min.js` | Rebuilt with all gap-fix code | VERIFIED | `customer_firstname` count=1, `customer-by-number` count=1. Rebuilt in plan 29-06 (commit `5b49abb`). |
| `zoho-middleware/routes/pos.js` | Case normalization at validation entry | VERIFIED | Line 1379: `var number = (req.query.number || '').trim().toUpperCase();`. |
| `.planning/REQUIREMENTS.md` | ZSYNC-01/02 as `[x]` Phase 29 Complete | VERIFIED | Lines 13-14 (`[x]`), traceability table lines 36-37 map to Phase 29 "Complete". |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `js/brewpad.js` refresh handler | `GET /api/batch/customer-by-number` | `fetch` with `x-api-key: mwApiKey()` | VERIFIED | `brewpad.js:2600`. Confirmed in minified artifact. |
| `js/brewpad.js` refresh handler | `adminApiPost('update_batch')` | `expectedVersion` + non-empty `updates` including derived firstname/lastname | VERIFIED | `brewpad.js:2631-2635`. `expectedVersion` from `_currentBatchDetail.last_updated`. `updates` includes `customer_firstname`/`customer_lastname` when `customer_name` present. |
| `js/admin.js` refresh handler | `GET /api/batch/customer-by-number` | `fetch` with explicit `x-api-key: SHEETS_CONFIG.MW_API_KEY` | VERIFIED | `admin.js:6066`. |
| `js/admin.js` refresh handler | `adminApiPost('update_batch')` | `expectedVersion: batchVersion` + derived firstname/lastname in updates | VERIFIED | `admin.js:6085-6088`. `batchVersion` updated from `result.newVersion` on success (`admin.js:6097`). |
| Middleware case normalization | Zoho lookup proceeds for lowercase refs | `toUpperCase()` before regex at `pos.js:1379` | VERIFIED | `inv-000123` → `INV-000123` → passes `/^INV-\d+$/`. 14 middleware batch-customer tests pass. |

---

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|--------------|--------|--------------------|--------|
| `brewpad.js` refresh handler | `data` (API response) | `GET /api/batch/customer-by-number` → Zoho Books via `pos.js` | Yes — live Zoho API calls | FLOWING |
| `admin.js` refresh handler | `data` (API response) | Same middleware endpoint | Yes | FLOWING |
| `brewpad.js` nameNode display | `getCustomerDisplayName(_currentBatchDetail)` | `customer_firstname`/`customer_lastname` — now updated by refresh via `splitCustomerName` | Yes — CR-02 closed | FLOWING |
| `admin.js` customerNode display | `getCustomerDisplayName(b)` | Same — `b.customer_firstname`/`b.customer_lastname` patched at `admin.js:6106` | Yes — CR-02 closed | FLOWING |
| Email/Phone display | `b.customer_email` / `b.customer_phone` | Refreshed in-memory and DOM | Yes | FLOWING |

---

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Pure helper tests pass | `npx jest tests/frontend/brewpad-zoho-refresh.test.js tests/frontend/admin-zoho-refresh.test.js --no-coverage` | 76/76 passed | PASS |
| Full frontend suite | `npx jest --no-coverage` | 508/508 passed, 26 suites | PASS |
| Full middleware suite | `cd zoho-middleware && npm test` | 598/598 passed, 29 suites | PASS |
| ESLint | `npm run lint -- js/brewpad.js js/admin.js` | 0 errors, 118 pre-existing warnings | PASS |
| `customer-by-number` in brewpad artifact | `grep -c "customer-by-number" js/brewpad.min.js` | 1 | PASS |
| `customer-by-number` in admin artifact | `grep -c "customer-by-number" js/admin.min.js` | 1 | PASS |
| `customer_firstname` in brewpad artifact | `grep -c "customer_firstname" js/brewpad.min.js` | 1 | PASS |
| `customer_firstname` in admin artifact | `grep -c "customer_firstname" js/admin.min.js` | 1 | PASS |
| Middleware case normalization | `grep -n "toUpperCase" zoho-middleware/routes/pos.js` | line 1379 in validation block | PASS |
| Human UAT on iPad Safari staging | CR-01 lowercase-ref, CR-02 name update, no console errors | Approved 2026-06-12 | PASS |

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| ZSYNC-01 | 29-01, 29-02 | Staff can refresh batch customer info (name, email, contact) via button in batch detail modal | SATISFIED | Feature wired end-to-end in both surfaces. CR-02 closed: name visibly updates via `splitCustomerName` + firstname/lastname patch. CR-01 closed: lowercase refs work. Email/phone update confirmed. Human UAT approved. |
| ZSYNC-02 | 29-01, 29-02 | When no Zoho link, refresh action clearly unavailable | SATISFIED | CR-01 closed: middleware normalizes uppercase before regex; frontend 400 handler added as defense-in-depth. Button hidden when `zoho_so_number` absent/non-matching. "Not linked" text shown. No network request fires. |

---

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `js/brewpad.js` / `js/admin.js` | multiple | `compareRefreshFields` does not check `customer_firstname`/`customer_lastname` in skip condition — stale derived fields not detected (29-REVIEW.md CR-01 post-fix) | Warning | Narrow edge case: batches corrupted by pre-fix CR-02 refreshes (same day) may show "Already up to date" while displaying wrong name. Does not affect forward-going refreshes. |
| `zoho-middleware/routes/pos.js` | 1379 | `(req.query.number || '').trim()` — if `req.query.number` is an array (duplicate query params), `.trim()` throws TypeError → 500 (29-REVIEW.md WR-02) | Warning | Malformed requests return 500 instead of 400; no user-facing impact under normal use. |
| `js/admin.js` / `js/brewpad.js` | 9629-9663 / 78-107 | Duplicated refresh helpers with minor behavioral drift (29-REVIEW.md IN-02) | Info | `typeof raw === 'string'` check differs; `compareRefreshFields` null-handling differs. Functional for all current paths. |
| `js/brewpad.js` | 2685, 2687, 2689, 2711 | `escapeHTML()` still wrapping values in toast calls (IN-01) — harmless since `showToast` uses `textContent` | Info | Redundant encoding; harmless as `soNumber` is regex-gated and `docStatus` is enum-gated. |

---

### Human Verification Required

No items pending human verification. Human UAT was completed and approved on 2026-06-12:
- Lowercase-ref refresh succeeds (CR-01 fix verified)
- Customer name visibly updates after clicking Refresh (CR-02 fix verified)
- No console errors on iPad Safari staging

---

### Summary

Phase 29 is PASSED. All five must-have truths are verified in the codebase. The two Critical defects (CR-01 case contract, CR-02 name not re-rendered) and three Warnings (WR-01 dead conflict detection, WR-03 double-encoding, WR-04 trim parity) from the initial verification have all been closed by plans 29-04 and 29-05. Plan 29-06 rebuilt the minified artifacts and ran the full gate (508 frontend / 598 middleware / lint 0 errors) and deployed to staging.

The post-fix code review (29-REVIEW.md) found one new Critical (D-12 skip-condition does not check derived firstname/lastname) and two warnings. The new Critical is a narrow edge case affecting only batches in a specific corrupted state created by the original CR-02 bug on the same day as the fix — it does not affect forward-going refreshes, and the human UAT confirmed the core user journey works correctly. This is tracked in 29-REVIEW.md for future follow-up and does not invalidate the phase goal.

---

_Verified: 2026-06-12T23:30:00Z_
_Verifier: Claude (gsd-verifier)_
_Re-verification: Yes — gaps_found → passed_
