---
phase: 29-refresh-from-zoho-admin-ui
plan: "05"
subsystem: frontend-batch-admin
tags: [zoho-refresh, brewpad, admin, customer-name, bug-fix, gap-closure]
wave: 2

dependency_graph:
  requires: ["29-04"]
  provides:
    - splitCustomerName helper (brewpad.js, admin.js) — derives firstname/lastname from refreshed name
    - isVersionConflict helper (brewpad.js, admin.js) — conflict detection matching 'modified' and 'version'
    - buildRefreshUpdates trim parity (admin.js) — now matches brewpad.js
  affects:
    - js/brewpad.js — refresh handler, textContent assignments, conflict detection
    - js/admin.js — refresh handler, buildRefreshUpdates, conflict detection

tech_stack:
  added: []
  patterns:
    - pure helper extraction for testability (splitCustomerName, isVersionConflict)
    - textContent assignment without escapeHTML (correct XSS-safe pattern)

key_files:
  modified:
    - js/brewpad.js
    - js/admin.js
    - tests/frontend/brewpad-zoho-refresh.test.js
    - tests/frontend/admin-zoho-refresh.test.js
  build_artifacts:
    - js/brewpad.min.js
    - js/admin.min.js
    - js/main.js
    - js/main.min.js
    - "*.html (version-stamped)"

decisions:
  - "Split customer_name into firstname/lastname in the updates payload (not clear firstname/lastname) — preserves Sheet column coherence and downstream consumers (adminApi.gs public batch greeting)"
  - "isVersionConflict matches both 'version' and 'modified' for forward-compatibility"
  - "escapeHTML removed from textContent assignments — textContent is already injection-safe by browser spec"

metrics:
  duration: "~12 min"
  completed: "2026-06-12"
  tasks: 2
  tests_added: 19
  tests_total: 76
---

# Phase 29 Plan 05: Gap Closure — Name Coherence, Double-Encode, Conflict Detection, Trim Parity Summary

Customer refresh now shows the updated name in both BrewPad and admin for all batch types, with correct entity rendering and working optimistic-lock conflict detection.

## What Was Built

### Task 1: splitCustomerName + CR-02 name coherence (feat commit `97b3e4f`)

Added `splitCustomerName(fullName)` pure helper to both `js/brewpad.js` and `js/admin.js`. The helper splits a full name on whitespace, returning `{ customer_firstname, customer_lastname }` (single-token names get `lastname=''`).

Wired into both Zoho refresh handlers: when `updates.customer_name` is present, the split is computed and the two derived keys are added to the `updates` payload before the `update_batch` call. This means:
- The Batches Sheet receives coherent `customer_firstname`/`customer_lastname` values aligned with the refreshed `customer_name`
- In-memory batch objects are patched with all three keys
- `getCustomerDisplayName()` (which prefers firstname/lastname) now renders the refreshed name for modern batches — closing CR-02

Cache patching: brewpad's `keys` loop (over `updates`) and the `_batchesData`/`_allBatchesData` list cache loop both include the new keys automatically since they iterate `Object.keys(updates)`. Admin's explicit per-field patch was extended to also set `b.customer_firstname` and `b.customer_lastname`.

Helper exported from both files' `module.exports` guard. 8 new unit tests (4 per file).

### Task 2: WR-03/WR-01/WR-04 bug fixes (fix commit `4b7298c`)

**WR-03 — brewpad double-encode:** Removed `escapeHTML()` wrappers from the three `textContent` assignments in the brewpad refresh handler (`nameNode`, `emailNode`, `phoneNode`). `textContent` is inherently injection-safe — the browser never parses it as HTML. Wrapping it with `escapeHTML` caused `&` to render as `&amp;`, `<` as `&lt;`, etc. (double-encoding). Admin.js did not have this problem.

**WR-01 — dead conflict detection (both files):** Extracted `isVersionConflict(msg)` pure helper that returns true when `msg.toLowerCase()` contains `'version'` OR `'modified'`. The Apps Script optimistic-lock message is `'Batch was modified by another user. Refresh and try again.'` — it contains `'modified'`, not `'version'`. The prior `indexOf('version')` check was therefore dead for all real conflict errors. Both catch sites in `js/brewpad.js` and the single catch site in `js/admin.js` now call `isVersionConflict(msg)`. Helper exported for testing.

**WR-04 — admin trim parity:** Changed `buildRefreshUpdates` in `js/admin.js` from `updates[k] = v` to `updates[k] = String(v).trim()`. This aligns admin with brewpad's existing trim behavior (brewpad's `buildRefreshUpdates` already did `result[k] = raw.trim()`). The emptiness guard above already trims before checking, so this is a consistent change with no behavior regression for already-trimmed values.

11 new unit tests across both suites.

### Build (chore commit `7d9ada4`)

Ran `npm run build` per CLAUDE.md: regenerated `js/admin.min.js`, `js/brewpad.min.js`, `js/main.js`, `js/main.min.js`, and version-stamped all HTML pages.

## Deviations from Plan

None — plan executed exactly as written. All four gaps (CR-02, WR-01, WR-03, WR-04) were closed in the two tasks as specified.

## Threat Flags

None — all three DOM assignments use `textContent` (T-29-05-01 mitigated); name-split values originate from Zoho's already-trusted `customer_name` field (T-29-05-02 accepted); Sheet coherence improved by writing consistent firstname/lastname columns (T-29-05-03 mitigated).

## Known Stubs

None.

## Self-Check: PASSED

- `js/brewpad.js` modified: present
- `js/admin.js` modified: present
- `tests/frontend/brewpad-zoho-refresh.test.js` modified: present
- `tests/frontend/admin-zoho-refresh.test.js` modified: present
- Task 1 commit `97b3e4f`: verified
- Task 2 commit `4b7298c`: verified
- Build commit `7d9ada4`: verified
- Test suite: 76/76 passing
- `grep -c "customer_firstname" js/brewpad.js` = 6 (>= 2)
- `grep -c "customer_firstname" js/admin.js` = 10 (>= 2)
- No `escapeHTML` on textContent assignment lines in brewpad.js
- `isVersionConflict` in both files (definition + call sites + export)
- `String(v).trim()` in admin.js buildRefreshUpdates
