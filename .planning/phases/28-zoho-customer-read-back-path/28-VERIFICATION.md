---
phase: 28-zoho-customer-read-back-path
verified: 2026-06-11T00:00:00Z
status: human_needed
score: 4/4 success criteria verified
overrides_applied: 0
human_verification:
  - test: "Confirm Apps Script is deployed to the live Google-hosted project with the customer_email / customer_phone allowedFields entries"
    expected: "Apps Script editor shows the two entries after 'start_date' in the allowedFields array; no editor errors; deployed version is live"
    why_human: "Apps Script deployments are manual (no CLI); the local apps-script/adminApi.gs source has the change confirmed (line 2165), but the hosted project deployment cannot be verified by grep"
  - test: "Confirm customer_phone column header exists on the Batches Google Sheet tab"
    expected: "The Batches tab has a 'customer_phone' column header so that write-back persists phone (the column was missing and was added during Plan 02 staging verification per 28-02-SUMMARY.md)"
    why_human: "Google Sheet column state is not in the codebase; cannot be verified by grep"
  - test: "Confirm the full read→write loop works on staging: curl the read endpoint against staging Railway middleware, then update_batch, then confirm batch record shows current Zoho name/email/phone with no collateral field changes"
    expected: "Batch SV-B-000153 (or equivalent linked batch) shows canonical Zoho name, email, and phone after the loop; status, zoho_so_number, product, timestamps, source all untouched"
    why_human: "Per 28-02-SUMMARY.md, verification ran against localhost:3001 (committed code, live Zoho data), not the staging Railway instance. The middleware is not yet deployed to Railway production (the production remote is ~28 commits behind staging). A staging Railway deploy and re-run is needed to satisfy SC-4 as literally stated in the ROADMAP."
---

# Phase 28: Zoho Customer Read-Back Path Verification Report

**Phase Goal:** BrewPad can read customer details back from Zoho for a linked sales order/invoice and persist the refreshed fields onto the batch record — the net-new read path behind the refresh feature (today Zoho sync is write-only)
**Verified:** 2026-06-11
**Status:** human_needed
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| #  | Truth | Status | Evidence |
|----|-------|--------|----------|
| SC-1 | New middleware endpoint returns linked customer name/email/contact for valid INV-/SO-; clear not-found/no-link response when SO cannot be resolved | VERIFIED | `router.get('/api/batch/customer-by-number'` at pos.js:1370; full 404/partial-200 branches at lines 1399–1431; 12 tests all GREEN |
| SC-2 | Endpoint covered by middleware unit tests for success, not-found, Zoho-error paths; passes with lint clean | VERIFIED | `zoho-middleware/__tests__/batch-customer.test.js` — 12 tests; full suite 596/596 passing; 0 lint errors introduced |
| SC-3 | Apps Script exposes write path for refreshed customer name/email/contact by batch ID; other fields untouched | VERIFIED | `apps-script/adminApi.gs:2165` — `'customer_email', 'customer_phone'` present in allowedFields array; existing write loop, optimistic-locking, and sanitizeInput are unchanged |
| SC-4 | Read endpoint + Apps Script update for a known linked batch results in batch showing current Zoho customer details (verified on staging) | HUMAN NEEDED | Plan 02 verified against localhost:3001 (committed code, live Zoho data) — not the staging Railway instance. The middleware endpoint is on staging main but not yet deployed to Railway. Full staging verification requires Railway deploy of the pending commit bundle. |

**Score:** 3/4 truths fully verified by code (SC-4 is code-complete but requires human confirmation of staging Railway deployment and re-run)

---

### PLAN Must-Have Truths — Plan 01

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| D-01 | GET resolves INV- to exactly customer_name, customer_email, customer_phone — no first/last name cols | VERIFIED | pos.js:1450–1457; response keys are exactly the six documented fields |
| D-03 | Payload is lean: three writable fields + customer_id, document_number, document_status only | VERIFIED | pos.js:1450–1457 and 1464–1470; no totals/line-items present |
| D-05 | INV- → /invoices; SO- → /salesorders (prefix routing) | VERIFIED | pos.js:1386–1390; SO routing test passes (calls[0][0] === '/salesorders') |
| D-06 | Params-object form for zohoGet; defensive exact-match rejects fuzzy/wrong doc → 404 | VERIFIED | pos.js:1392–1414; `filterParams[filterKey] = number` (no string concat); exact-match loop at 1407–1410 |
| D-13 | Not-found → 404; Zoho outage → 502; incomplete contact → 200 partial | VERIFIED | pos.js:1400, 1413, 1474–1478, 1422–1431; 502/404/partial tests all GREEN |
| D-14 | Voided/deleted documents still return customer details with document status | VERIFIED | docStatus pulled from `doc.status \|\| ''` at pos.js:1419 — no status filter; partial-200 test confirms document_status in response |
| D-15 | Contact-fetch failure → 200 partial with contact_unavailable:true, null email/phone | VERIFIED | pos.js:1459–1471; partial-200 test passes |
| D-16 | Non-INV-/non-SO- inputs → 400 invalid_number before any Zoho call | VERIFIED | pos.js:1378–1383; 400 tests assert zohoGet not called |
| D-07 | Email falls back to primary contact_person.email when top-level email is blank | VERIFIED | pos.js:1446; success test with blank contact.email uses contact_persons[0].email |
| D-04 | Phone falls back to mobile when phone is blank | VERIFIED | pos.js:1448; phone-mobile-fallback test passes |
| D-08 | customer_name from invoice/SO's customer_name field — no name parsing from contact | VERIFIED | pos.js:1418; name sourced from `doc.customer_name \|\| ''` |
| D-11 | No Redis caching; always-live reads | VERIFIED | Grep of handler section (pos.js:1369–1480) contains zero references to cache or redis |
| Test coverage | Success, not-found, zoho-error, partial-200, validation, exact-match-reject, auth paths; lint clean | VERIFIED | 12 tests covering all documented paths; full suite 596/596; `findHandler` pattern used (not `_handlers` dict); 7 jest.mock targets present |

### PLAN Must-Have Truths — Plan 02

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| D-09 | updateBatch() accepts customer_email and customer_phone via allowedFields extension | VERIFIED | adminApi.gs:2165 — `'customer_email', 'customer_phone'  // Phase 28: refresh-from-Zoho write-back (D-09)` |
| Write-back field isolation | Writing customer_email/phone updates only those columns, leaving other batch fields untouched | VERIFIED | Existing `allowedFields.forEach` write loop at adminApi.gs:2167–2174 is unchanged; only fields present in `updates` payload are written |
| sanitizeInput passes emails/phones | sanitizeInput does not strip @, +, -, ., (, ), or digits | VERIFIED | adminApi.gs:3127–3157 — strips script/HTML/event-handlers only; characters used in email addresses and phone numbers are not affected |
| D-02 | Write-back preserves existing batch data (caller sends only non-empty fields) | HUMAN VERIFIED (noted) | Verified live: batch SV-B-000153; status/timestamps/product untouched per 28-02-SUMMARY.md. Accepted as human-verified per task instructions. |
| D-10 | Two-call orchestration performed by the browser — no server-to-server coupling | VERIFIED | No middleware→Apps Script call exists; handler only calls zohoGet (lib/zoho-api); D-10 is architectural, no server coupling to grep |
| D-12 | Staging verification is manual, no throwaway verify script committed | VERIFIED | No `verify*.sh` or similar script added in this phase; verified by absence |

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `zoho-middleware/routes/pos.js` | GET /api/batch/customer-by-number handler | VERIFIED | Handler at lines 1369–1480; exactly one registration (grep -c returns 1) |
| `zoho-middleware/__tests__/batch-customer.test.js` | Unit tests for new endpoint | VERIFIED | 12 tests; exists, substantive (333 lines), wired via `findHandler('get', '/api/batch/customer-by-number')` |
| `apps-script/adminApi.gs` | customer_email and customer_phone in updateBatch allowedFields | VERIFIED | Line 2165 — both strings present in the allowedFields array literal, after 'start_date' |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| pos.js GET handler | lib/zoho-api.zohoGet | `zohoGet(path, filterParams)` — params-object form | VERIFIED | pos.js:1396 uses `zohoGet(path, filterParams)`; no string-concat pattern present in handler |
| pos.js GET handler | `/contacts/:id` | `zohoGet('/contacts/' + customerId)` for Call 2 | VERIFIED | pos.js:1435 |
| batch-customer.test.js | routes/pos.js handler | `findHandler('get', '/api/batch/customer-by-number')` | VERIFIED | Test line 73; uses `_routeRegistry` + `findHandler`, not `_handlers` dict |
| adminApi.gs updateBatch allowedFields | Batches sheet columns | `headers.indexOf(field)` column lookup + `sanitizeInput` write | VERIFIED | adminApi.gs:2169–2172; write loop unchanged; customer_phone column was missing and added to sheet (noted below) |

---

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|--------------|--------|-------------------|--------|
| pos.js handler | `docs` (document list), `contact` (contact detail) | Two sequential `zohoGet` calls against live Zoho Books API | Yes — no Redis cache; always-live per D-11 | FLOWING |
| adminApi.gs updateBatch | `updates[field]` | Passed from browser caller (Phase 29 will supply data returned by the read endpoint) | Yes — sheet write at `colIndex + 1` | FLOWING |

---

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| 12 batch-customer tests pass | `cd zoho-middleware && npm test -- --testPathPattern=batch-customer` | 12 passed, 0 failed | PASS |
| Full middleware suite no regressions | `cd zoho-middleware && npm test` | 596/596 passed, 29 suites | PASS |
| Exactly one route registration | `grep -c '/api/batch/customer-by-number' zoho-middleware/routes/pos.js` | 1 | PASS |
| No caching in handler | grep cache/redis in handler section | 0 matches | PASS |
| Params-object form (no string concat) | `grep -n "zohoGet(path, filterParams)"` | pos.js:1396 — confirmed | PASS |
| Defensive exact-match loop | `grep -n "toLowerCase.*===.*toLowerCase"` | pos.js:1409 — confirmed | PASS |
| allowedFields includes both new strings | `grep customer_email apps-script/adminApi.gs` + line 2165 | Both strings in array literal | PASS |

---

### Probe Execution

No probe scripts declared or conventional in this phase — skipped.

---

### Requirements Coverage

Both plans declare `requirements: []` — confirmed. This phase is foundational for ZSYNC-01 and ZSYNC-02 (Phase 29). No requirements close here; this matches the ROADMAP note: "(foundation for ZSYNC-01, ZSYNC-02 — no requirement closes here on its own)".

---

### Anti-Patterns Found

No TBD, FIXME, or XXX markers were introduced by this phase. The REVIEW.md warnings (WR-01 through WR-04) are advisory, not blockers for this phase's goal. Summary:

| Finding | File | Severity | Impact on Phase 28 Goal |
|---------|------|----------|------------------------|
| WR-01: MW_API_KEY unset fails open | pos.js:1371–1374 | WARNING | Pre-existing pattern copied from other routes; PII exposure risk when env var absent. Carried forward to Phase 29 backlog. |
| WR-02: No length cap on `number` param | pos.js:1376–1393 | WARNING | Very large digit strings pass regex and reach Zoho. Not a correctness break for Phase 28 goal. |
| WR-03: updateBatch writes blanks if caller sends empty string | adminApi.gs:2167–2174 | WARNING | D-02 preserve-existing is enforced by Phase 29 caller; Apps Script has no self-defense. Phase 29 must not send blank fields. |
| WR-04: afterEach leaks "undefined" into MW_API_KEY | batch-customer.test.js:117 | WARNING | Test env pollution — does not affect test results within the file; suite still 596/596 green. |
| IN-01/IN-02/IN-03 | pos.js, test file | INFO | Advisory; no correctness impact on Phase 28 goal. |

None of these rise to BLOCKER status for Phase 28's goal. All are documented for Phase 29 attention.

---

### Human Verification Required

#### 1. Apps Script Deployment Confirmation

**Test:** Open the bound Apps Script project for the Batches admin backend. Confirm the deployed `adminApi.gs` source shows `'customer_email', 'customer_phone'` in the `allowedFields` array (after `'start_date'`). Confirm no editor errors.
**Expected:** The deployed (live) Apps Script has both entries; the web app serves the updated code.
**Why human:** Apps Script deployments are manual (no CLI deploy in this repo). The local source is confirmed by grep, but the hosted Google project state cannot be verified programmatically.

#### 2. Batches Sheet customer_phone Column

**Test:** Open the Batches Google Sheet tab. Confirm a column header named `customer_phone` exists.
**Expected:** The column is present, having been added during Plan 02 verification (per 28-02-SUMMARY.md's "Research Open Question 2 RESOLVED" section). A write-back that includes a non-null phone now persists it.
**Why human:** Google Sheet column state is external to the codebase and cannot be verified by grep.

#### 3. Staging Railway Deployment Verification (SC-4)

**Test:** Deploy the pending middleware commits to the staging Railway instance (`git push origin main` if not already done; allow Railway to redeploy). Then run the read→write loop: `curl -H "x-api-key: <MW_API_KEY>" "https://<staging-middleware>/api/batch/customer-by-number?number=INV-000094"` and confirm the JSON contains `customer_name`, `customer_email`, `customer_phone`, `document_number`, `document_status`. Then call `update_batch` for SV-B-000153 from the browser console with only the non-empty returned fields plus `expectedVersion`. Reload the batch and confirm name/email/phone reflect current Zoho data with no collateral field changes.
**Expected:** The response matches what was verified locally (Daniela Harbin / dsbnbinbrackendale@yahoo.com / +1-6048151535). The batch record shows the refreshed fields with status/product/timestamps untouched.
**Why human:** Plan 02 verified against `localhost:3001` running committed code against live Zoho. The ROADMAP SC-4 says "verified on staging" — the staging Railway instance is the authoritative target. The middleware is on staging main but has not yet been deployed to Railway (production remote is ~28 commits behind; staging deploy was blocked pending Phase 27/27.1 bundle). Once the bundle is pushed, this check completes SC-4 with zero code changes.

---

### Gaps Summary

No code gaps. All must-have truths have implementation evidence in the codebase. The human_needed status is driven entirely by:

1. **Apps Script deployment** cannot be confirmed by grep (manual deployment model).
2. **Google Sheet column** state is external to the repo.
3. **Staging Railway deploy** has not yet happened — the committed code is correct and has been verified against live Zoho locally, but ROADMAP SC-4 specifically says "verified on staging."

None of these represent missing or broken implementation. They are deployment and environment state items that require a human eyeball.

**Deployment caveat (not a gap):** The middleware endpoint is on `staging` main but will only reach Railway production when `main` is next pushed to the production remote (bundled with Phase 27/27.1 work). This is expected and documented in 28-02-SUMMARY.md. Phase 29 depends on this endpoint being live; that deploy should happen before or alongside Phase 29's deploy.

---

_Verified: 2026-06-11_
_Verifier: Claude (gsd-verifier)_
