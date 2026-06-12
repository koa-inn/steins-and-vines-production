---
phase: 29-refresh-from-zoho-admin-ui
verified: 2026-06-12T20:30:00Z
status: gaps_found
score: 3/5 must-haves verified
overrides_applied: 0
gaps:
  - truth: "Refresh button appears only when zoho_so_number matches /^(INV|SO)-\\d+$/i (case-insensitive UI gate matches middleware validation contract)"
    status: failed
    reason: "Case-sensitivity contract mismatch (CR-01): frontend isValidZohoNumber uses /^(INV|SO)-\\d+$/i (case-insensitive) but middleware pos.js:1379-1380 validates without the i flag. A batch with zoho_so_number='inv-000123' or 'so-42' renders the Refresh button in both surfaces (UI gate passes), but when clicked the middleware returns 400 invalid_number. Neither handler has a 400 branch — user gets generic 'Refresh failed — try again'. The code comment on brewpad.js:45 asserts this cannot happen; it is provably false. The tests at brewpad-zoho-refresh.test.js:45-50 actively bake this broken contract in as passing behavior."
    artifacts:
      - path: "js/brewpad.js"
        issue: "isValidZohoNumber at line 48 uses /^(INV|SO)-\\d+$/i — case-insensitive flag causes frontend to show Refresh button for lowercase refs that middleware rejects with 400"
      - path: "js/admin.js"
        issue: "isValidZohoNumber at line 9572 same case-insensitive regex; same broken contract"
      - path: "zoho-middleware/routes/pos.js"
        issue: "Middleware validates at lines 1379-1380 WITHOUT /i flag: /^INV-\\d+$/.test(number) — uppercase-only. No 400 handler exists in either frontend refresh handler."
    missing:
      - "Either drop the /i flag from both frontend helpers (to match middleware behavior), OR normalize in middleware before validation: var number = (req.query.number || '').trim().toUpperCase(). Update tests to match whichever contract is chosen."

  - truth: "Refreshed customer_name update is visible in the Customer row after clicking Refresh (display logic shows the refreshed name)"
    status: failed
    reason: "CR-02: getCustomerDisplayName (admin.js:36-41, brewpad.js:34-39) prefers customer_firstname/customer_lastname over customer_name when both are present. The refresh writes only customer_name/customer_email/customer_phone (the fields the Phase 28 endpoint returns). Modern batches are created with firstname+lastname (kiosk: admin.js:10348-10349; BrewPad create: brewpad.js:3642-3643). For all non-legacy batches, the Customer row in both surfaces will continue showing the stale firstname/lastname value after a nominally successful refresh. The success toast fires ('Customer info updated from INV-…') but the displayed name does not change. Additionally, the Batches Sheet now has customer_name inconsistent with its own customer_firstname/customer_lastname columns."
    artifacts:
      - path: "js/brewpad.js"
        issue: "Line 2619: nameNode.textContent = escapeHTML(getCustomerDisplayName(_currentBatchDetail || b) || '—'). getCustomerDisplayName prefers firstname/lastname which the refresh never updates — name stays stale for all non-legacy batches. Also WR-03: escapeHTML + textContent double-encodes entities (e.g., 'Smith & Sons' renders as 'Smith &amp; Sons')."
      - path: "js/admin.js"
        issue: "Line 6098: customerNode.textContent = getCustomerDisplayName(b) || '—'. Same display precedence issue — firstname/lastname wins over the just-refreshed customer_name."
    missing:
      - "Include customer_firstname and customer_lastname in the refresh update payload (split customer_name from API response into parts), or clear those fields so getCustomerDisplayName falls through to customer_name. Apply in both js/brewpad.js and js/admin.js and patch the same keys into in-memory objects/caches."
      - "WR-03: Drop escapeHTML from the three textContent assignments in js/brewpad.js:2619/2623/2627 to prevent double-encoding."
---

# Phase 29: Refresh-from-Zoho Admin UI Verification Report

**Phase Goal:** Add a "Refresh from Zoho" feature to both batch detail surfaces (BrewPad detail pane and admin Batches modal) that pulls the linked customer's current name/email/phone from the Phase 28 middleware endpoint and applies it in place, hidden when no usable Zoho link exists.
**Verified:** 2026-06-12T20:30:00Z
**Status:** gaps_found — 2 Critical defects confirmed in the codebase; feature is partially functional but ZSYNC-01's primary purpose (visible name correction) silently fails for all modern batches, and the frontend gate shows a button for Zoho refs the middleware will reject.
**Re-verification:** No — initial verification.

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | BrewPad and admin detail surfaces render Email and Phone rows showing current batch values | VERIFIED | brewpad.js:2270-2271 (`bp-detail-email`, `bp-detail-phone`); admin.js:5873-5874 (`batch-detail-email`, `batch-detail-phone`). Values populated from `b.customer_email / b.customer_phone`. |
| 2 | Refresh button appears only when zoho_so_number matches the validation regex, and is absent for batches with no usable link (ZSYNC-02) | FAILED (CR-01) | Button rendered correctly under `isValidZohoNumber()` guards (brewpad.js:2286, admin.js:5875). However the frontend regex is case-insensitive (`/i`) while the middleware validates case-sensitively (`pos.js:1379-1380`). Button renders for `inv-000123` / `so-42`-style refs; clicking triggers an unhandled 400 from the middleware. Admin surface also correctly shows "Not linked" text when no valid ref (admin.js:5878). |
| 3 | Clicking refresh pulls customer name/email/phone and updates the displayed rows in place with distinct per-state toasts (ZSYNC-01) | FAILED (CR-02) | Fetch, update_batch call, and in-place DOM patch are all wired correctly. Email/phone update visibly. Name update is silently invisible for all non-legacy batches: `getCustomerDisplayName` in both files prefers `customer_firstname`/`customer_lastname` which the refresh never writes. Success toast fires regardless. Middleware endpoint (`pos.js:1450-1457`) returns only `customer_name` — no firstname/lastname split. Both surfaces update `customer_name` in-memory but display logic ignores it when firstname/lastname present. |
| 4 | Refresh is hidden for batches with no valid Zoho link, and no erroring request fires (ZSYNC-02) | VERIFIED | When `b.zoho_so_number` is absent or non-matching, no button is rendered (brewpad.js:2290 shows nothing; admin.js:5878 shows "Not linked"). The button `getElementById` returns null and the click handler is never bound. No network request fires. UAT confirmed on iPad Safari. |
| 5 | No-change refresh shows "Already up to date" and skips the update_batch call; full test gate green; build artifacts regenerated; staging deployed | VERIFIED | `compareRefreshFields` short-circuit present in both handlers (brewpad.js:2589-2594, admin.js:6077-6082). Both new test files exist and 53/53 tests pass (27 brewpad, 26 admin). `customer-by-number` appears in brewpad.min.js (count=1) and admin.min.js (count=1) and is absent from main.min.js. Feature commit ca51b11 is on origin/main. 485/485 frontend tests pass. iPad Safari UAT passed per 29-03-SUMMARY. |

**Score:** 3/5 truths verified (2 FAILED — CR-01 and CR-02 are confirmed defects in the codebase)

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `js/brewpad.js` | Refresh button, Email/Phone rows, pure helpers, refresh handler | WIRED (partial) | Exists, substantive, wired. Button conditional on `isValidZohoNumber`. Handler calls endpoint, update_batch with expectedVersion, patches DOM/caches. Defect: case-insensitive regex + name display logic (CR-01, CR-02, WR-03). |
| `js/admin.js` | Refresh button, Zoho Ref/Email/Phone rows, pure helpers, refresh handler | WIRED (partial) | Exists, substantive, wired. Same structural completeness as brewpad surface. Defect: case-insensitive regex + name display logic (CR-01, CR-02); untrimmed values written to Sheet (WR-04). |
| `tests/frontend/brewpad-zoho-refresh.test.js` | Unit tests for pure helpers | VERIFIED | 209 lines, 27 tests, all passing. Tests bake in the broken case-insensitive contract as expected behavior (IN-03 from review). |
| `tests/frontend/admin-zoho-refresh.test.js` | Unit tests for admin pure helpers | VERIFIED | 26 tests, all passing. Same scope limitation — pure helpers only, no handler coverage. |
| `js/brewpad.min.js` | Rebuilt with refresh handler | VERIFIED | `grep -c "customer-by-number" js/brewpad.min.js` = 1. |
| `js/admin.min.js` | Rebuilt with refresh handler | VERIFIED | `grep -c "customer-by-number" js/admin.min.js` = 1. |
| `.planning/REQUIREMENTS.md` | ZSYNC-01/02 as Complete/Phase 29 | VERIFIED | Lines 13-14 (`[x]`), traceability table lines 36-37 map to Phase 29 with "Complete". |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| js/brewpad.js refresh handler | GET /api/batch/customer-by-number | fetch with x-api-key: mwApiKey() | WIRED | brewpad.js:2576-2577. Confirmed in source and min artifact. |
| js/brewpad.js refresh handler | adminApiPost('update_batch') | expectedVersion + non-empty updates | WIRED | brewpad.js:2598-2601. expectedVersion sourced from `_currentBatchDetail.last_updated`. |
| js/admin.js refresh handler | GET /api/batch/customer-by-number | fetch with explicit x-api-key: SHEETS_CONFIG.MW_API_KEY | WIRED | admin.js:6065-6067. Explicit header, not getMwHeaders(). |
| js/admin.js refresh handler | adminApiPost('update_batch') | expectedVersion: batchVersion + updates | WIRED | admin.js:6085-6088. batchVersion updated from result.newVersion on success (line 6090). |
| middleware endpoint | Refresh button visible/hidden gate | isValidZohoNumber regex contract | BROKEN (CR-01) | Frontend `/i` flag vs middleware case-sensitive `^INV-\d+$` / `^SO-\d+$`. 400 responses unhandled in both frontend handlers. |

---

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|--------------|--------|--------------------|--------|
| brewpad.js refresh handler | `data` (API response) | GET /api/batch/customer-by-number → Zoho Books via pos.js:1379-1457 | Yes — two live Zoho API calls (document + contact) | FLOWING |
| admin.js refresh handler | `data` (API response) | Same middleware endpoint | Yes | FLOWING |
| brewpad.js nameNode display | `getCustomerDisplayName(b)` | `b.customer_firstname` / `b.customer_lastname` (never updated by refresh) | Stale — refresh writes `customer_name` only | HOLLOW for non-legacy batches (CR-02) |
| admin.js customerNode display | `getCustomerDisplayName(b)` | Same display precedence issue | Stale — same root cause | HOLLOW for non-legacy batches (CR-02) |
| Email/Phone display | `b.customer_email` / `b.customer_phone` | Refreshed correctly in-memory and DOM | Yes | FLOWING |

---

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Pure helper tests pass | `npx jest tests/frontend/brewpad-zoho-refresh.test.js tests/frontend/admin-zoho-refresh.test.js` | 53/53 passed | PASS |
| Full frontend suite | `npx jest --no-coverage` | 485/485 passed, 26 suites | PASS |
| customer-by-number in brewpad artifact | `grep -c "customer-by-number" js/brewpad.min.js` | 1 | PASS |
| customer-by-number in admin artifact | `grep -c "customer-by-number" js/admin.min.js` | 1 | PASS |
| customer-by-number absent from main.min.js | `grep -c "customer-by-number" js/main.min.js` | 0 | PASS |
| Middleware case-sensitivity: `inv-000123` triggers 400 | Code trace pos.js:1379-1380 | `/^INV-\d+$/.test('inv-000123')` = false → 400 returned; no handler in frontend | FAIL (CR-01) |

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| ZSYNC-01 | 29-01, 29-02 | Staff can refresh batch customer info via button in batch detail modal | PARTIAL | Feature is wired end-to-end. Email/phone refresh works. Name refresh is invisible for modern batches (CR-02). Lowercase ref batches get unhandled 400 errors (CR-01). |
| ZSYNC-02 | 29-01, 29-02 | When no Zoho link, refresh action clearly unavailable | PARTIAL | Correctly hidden when `zoho_so_number` absent or malformed. However: lowercase refs like `inv-000123` pass the frontend gate and show the button (CR-01), appearing "available" to the user then failing silently — not "clearly unavailable". |

---

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| js/brewpad.js | 45 | Doc comment claims `a 400 invalid_number response can never fire from the UI` — provably false due to case-sensitivity mismatch | Blocker | Misleads future maintainers; the invariant is wrong |
| js/brewpad.js | 2619, 2623, 2627 | `textContent = escapeHTML(...)` — double-encodes entities | Warning | Names/emails with `&`, `<`, `>`, `"` display as HTML entities after refresh |
| js/admin.js | 9590 | `updates[k] = v` stores raw (untrimmed) API value — brewpad trims, admin does not | Warning | Padded values written to Batches Sheet; helper semantics diverge across surfaces |
| js/brewpad.js, js/admin.js | 2663/2679, 6130 | `err.message.toLowerCase().indexOf('version')` — dead code (Apps Script returns "Batch was modified by another user…", no "version" substring) | Warning | Version conflicts surface as generic "Refresh failed — try again" with no working retry path |
| tests/frontend/brewpad-zoho-refresh.test.js | 45-50 | Tests assert `isValidZohoNumber('inv-5') === true` and `isValidZohoNumber('so-999') === true` — baking in the broken contract | Warning | Tests will continue passing even after the contract mismatch causes user-facing failures |

---

### Human Verification Required

_(Human UAT already passed on iPad Safari per 29-03-SUMMARY — the items below relate to confirmed code defects, not user-flow verification. No further human UAT items are needed; the gaps below require code fixes and re-verification.)_

---

### Gaps Summary

**Two Critical defects confirmed by codebase inspection (matching the pre-supplied code review CR-01 and CR-02):**

**Gap 1 — CR-01: Case-sensitivity contract mismatch (blocks ZSYNC-02 correctness)**

The frontend `isValidZohoNumber` function uses a case-insensitive regex (`/i` flag) in both `js/brewpad.js` and `js/admin.js`. The middleware endpoint (`zoho-middleware/routes/pos.js:1379-1380`) validates without the `/i` flag — uppercase only. Any batch whose `zoho_so_number` is stored as `inv-NNNN` or `so-NNNN` (lowercase) will display the Refresh button (UI gate passes), but clicking it causes the middleware to return HTTP 400 `invalid_number`. Neither refresh handler has a 400 branch; the catch falls through to the generic "Refresh failed — try again" error. ZSYNC-02 requires that when no usable link exists, the action is "clearly unavailable rather than erroring" — but lowercase-ref batches are erroring, not clearly unavailable. The doc comment on `brewpad.js:45` asserts this cannot happen; the tests actively assert the broken case-insensitive contract.

**Gap 2 — CR-02: Refreshed customer name is invisible for all non-legacy batches (blocks ZSYNC-01 primary purpose)**

The Phase 28 endpoint returns `customer_name` (full name as a single string) but never returns `customer_firstname` or `customer_lastname`. The `getCustomerDisplayName()` function in both files prefers `customer_firstname`/`customer_lastname` over `customer_name` when both are present. Modern batches (all kiosk-created and BrewPad-created batches) are stored with firstname+lastname populated. After a refresh, `customer_name` is updated in-memory and in the Sheet, but the Customer row display continues showing the stale firstname/lastname. The success toast "Customer info updated from INV-…" is misleading — the primary user-visible field does not change. The Batches Sheet is left internally inconsistent (`customer_name` inconsistent with `customer_firstname`/`customer_lastname`). This is not observable only for legacy batches created before firstname/lastname fields were introduced.

**Additional confirmed warnings (from codebase inspection, matching 29-REVIEW.md WR-01, WR-03, WR-04):**

- **WR-01** (dead code): Version-conflict detection uses `indexOf('version')` but Apps Script returns "Batch was modified by another user…" — substring never matches. Conflicts show "Refresh failed — try again" with no working recovery.
- **WR-03** (double-encode, brewpad only): `textContent = escapeHTML(...)` causes literal `&amp;` to render in the Customer/Email/Phone rows after a refresh when the values contain `&`, `<`, `>`, or `"`. Admin.js correctly uses raw `textContent` without escaping.
- **WR-04** (semantic divergence): Admin `buildRefreshUpdates` stores raw (untrimmed) values; brewpad version trims. Duplicated helpers with divergent semantics increase future bug risk.

---

_Verified: 2026-06-12T20:30:00Z_
_Verifier: Claude (gsd-verifier)_
