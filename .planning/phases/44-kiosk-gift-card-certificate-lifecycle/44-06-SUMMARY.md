---
phase: 44-kiosk-gift-card-certificate-lifecycle
plan: "06"
subsystem: ui
tags: [gift-cards, kiosk, pos, es5, modal, forked-surfaces, d-08]

requires:
  - phase: 44-03
    provides: "POST /api/kiosk/gift-card/issue, GET /api/kiosk/gift-card/next-number"
  - phase: 44-05
    provides: "POST /api/kiosk/gift-card/reload"

provides:
  - "Issue/Reload Gift Card modal on js/kiosk.js (inline overlay, id kiosk-gift-card-issue-overlay)"
  - "Issue/Reload Gift Card modal on js/admin.js (openModal/closeModal, D-08 paired)"
  - "kiosk-add-gc-btn in both empty and non-empty cart blocks on both surfaces"
  - "kgci-* field IDs (cert, value, error, cancel, issue) identical on both surfaces (D-08)"
  - "Rebuilt js/kiosk.min.js + js/admin.min.js with gift card UI"

affects:
  - "44-07 (admin gift card management UI — same surfaces)"
  - "44-08 (staging UAT — verify issue/reload flow on iPad Safari)"

tech-stack:
  added: []
  patterns:
    - "Build-once inline overlay in kiosk.js: document.getElementById check before createElement; show with overlay.style.display='flex'"
    - "Mode toggle (Issue/Reload) using setGcMode() closure inside modal function; _gcMode var captured by onclick closure"
    - "GET /api/kiosk/gift-card/next-number pre-fills kgci-cert on Issue mode open; readOnly=true during load, false on success"
    - "Admin parallel uses openModal/closeModal; on success calls closeModal() before showToast()"
    - "kgci- prefix for all gift card modal field IDs (vs kci- for custom item) to avoid collisions"
    - "D-08: both surfaces wire to same endpoint shapes; only modal mechanism + button CSS classes differ"

key-files:
  created: []
  modified:
    - "js/kiosk.js — kioskShowGiftCardIssueModal() + kioskSubmitGiftCardIssue() + kiosk-add-gc-btn in kioskRenderCart()"
    - "js/admin.js — kioskShowAdminGiftCardIssueModal() + kioskSubmitAdminGiftCardIssue() + kiosk-add-gc-btn in admin kioskRenderCart()"
    - "js/kiosk.min.js — rebuilt via npm run build (terser)"
    - "js/admin.min.js — rebuilt via npm run build (terser)"

key-decisions:
  - "Pattern 3 (modal → /issue directly) implemented for issuance/reload — no Helcim terminal charge routed through the modal; staff collect payment via normal kiosk cart checkout or cash externally. Flagged for owner confirmation at 44-08 UAT."
  - "GC button added to BOTH empty and non-empty cart blocks on both surfaces — staff should be able to issue/reload a certificate whether or not other items are in cart"
  - "Reload mode: kgci-cert is a plain text input (not pre-filled); staff must type the existing cert number manually (D-07: paper cert, no barcode)"
  - "Success feedback via showToast() only (not in-cart display); reload shows new_balance in toast"
  - "409 error: 'Certificate number already in use' (D-02 server rejects dups); 503: 'Gift card accounting not configured'"

requirements-completed: [GIFTCARD-01]

duration: ~25min
completed: "2026-06-28"
---

# Phase 44 Plan 06: Gift Card Issue/Reload UI — Both Forked Surfaces Summary

**Issue/Reload Gift Card modal on both kiosk.js (inline overlay) and admin.js (openModal/closeModal), identical kgci-* field IDs, next-number pre-fill, 409/503/success handling, ES5/var throughout; bundles rebuilt, 928 frontend tests green.**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-06-28
- **Completed:** 2026-06-28
- **Tasks:** 3 (Task 1: kiosk.js modal+button, Task 2: admin.js paired modal+button, Task 3: rebuild bundles + tests)
- **Files modified:** 4 source + 19 build artifacts (HTML cache stamps, min bundles)

## Accomplishments

- Added `kioskShowGiftCardIssueModal()` (inline overlay, build-once) and `kioskSubmitGiftCardIssue()` to js/kiosk.js; mode toggle (Issue New / Reload Existing), cert# pre-filled from `GET /api/kiosk/gift-card/next-number` in Issue mode, ES5/var throughout.
- Added `kioskShowAdminGiftCardIssueModal()` and `kioskSubmitAdminGiftCardIssue()` to js/admin.js using `openModal`/`closeModal`; identical field IDs (`kgci-cert`, `kgci-value`, `kgci-error`), identical validation and fetch logic — D-08 parity maintained.
- `kiosk-add-gc-btn` ("+ Issue / Reload Gift Card") added to both empty-cart and non-empty-cart blocks in `kioskRenderCart()` on BOTH surfaces.
- All three routes wired with `x-api-key: SHEETS_CONFIG.MW_API_KEY` header (matching existing kiosk sale calls).
- `npm run build` exits 0; `gift-card/issue` present in both min bundles (grep -c = 1 each); `npm test` 928 tests, 49 suites, all green.

## Task Commits

1. **Task 1: kiosk.js Issue/Reload modal + button** — `a634242` (feat)
2. **Task 2: admin.js paired modal + button (D-08)** — `435f49f` (feat)
3. **Task 3: Rebuild min bundles + cache stamps** — `787d1f0` (chore)

**Plan metadata:** (this commit)

## API Calls Wired

| Mode | Endpoint | Request | Response |
|------|----------|---------|----------|
| Issue | `POST /api/kiosk/gift-card/issue` | `{cert_number, face_value, issued_by:'kiosk'}` | 201 `{ok, cert_number, face_value, zoho_invoice_number}` |
| Reload | `POST /api/kiosk/gift-card/reload` | `{cert_number, amount}` | 200 `{ok, cert_number, new_balance}` |
| Next# | `GET /api/kiosk/gift-card/next-number` | — | 200 `{ok, suggested:'GC-NNNNNN'}` |

Error codes handled: 409 (dup cert), 503 (not configured), 404 (cert not found), connection error.

## Files Created/Modified

- `js/kiosk.js` — +205 lines: `kioskShowGiftCardIssueModal`, `kioskSubmitGiftCardIssue`, button in `kioskRenderCart` (empty + non-empty)
- `js/admin.js` — +188 lines: `kioskShowAdminGiftCardIssueModal`, `kioskSubmitAdminGiftCardIssue`, button in admin `kioskRenderCart` (empty + non-empty)
- `js/kiosk.min.js` — rebuilt (terser)
- `js/admin.min.js` — rebuilt (terser)
- 17 HTML files — cache-busting `?v=` stamps updated by `npm run build`

## Decisions Made

- Pattern 3 implemented: modal → direct POST to /issue or /reload without routing through Helcim terminal. Staff collect the payment (cash or card via normal checkout) separately from recording the gift card issuance. Flagged for owner confirmation at 44-08 staging UAT.
- Both empty and non-empty cart blocks get the GC button — staff should be able to issue/reload without needing items in cart.
- Reload mode: cert# is manually typed by staff (no pre-fill) — correct per D-07 (paper cert workflow).

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None. Both surfaces make live API calls to the middleware routes shipped in 44-03/44-05.

## Open Flow Question (for 44-08 UAT)

**Payment collection for gift card issuance/reload:** The current implementation (Pattern 3) records the gift card in the system when staff click "Issue/Reload Certificate" — it does NOT route the face_value through the Helcim terminal. Staff must collect the payment separately (e.g., via the normal kiosk cart for a card payment, or cash externally). The owner should confirm this is the intended workflow at 44-08 UAT, or request that a terminal-charge step be added before calling /issue.

## Threat Flags

No new threat surface. The modal calls only the documented `/api/kiosk/gift-card/*` routes with the existing `x-api-key: MW_API_KEY` auth header. Server is authoritative for all validation (T-44-23 mitigated: server re-validates format + bounds + dup). D-08 fork parity confirmed via grep on both files.

## Self-Check: PASSED

- FOUND: js/kiosk.js (kioskShowGiftCardIssueModal present)
- FOUND: js/admin.js (kioskShowAdminGiftCardIssueModal present)
- FOUND: js/kiosk.min.js (gift-card/issue: grep -c = 1)
- FOUND: js/admin.min.js (gift-card/issue: grep -c = 1)
- FOUND: commit a634242 (feat: kiosk.js modal)
- FOUND: commit 435f49f (feat: admin.js paired modal)
- FOUND: commit 787d1f0 (chore: rebuild bundles)
- Frontend tests: 928 passed, 49 suites, 0 failures

---
*Phase: 44-kiosk-gift-card-certificate-lifecycle*
*Plan: 06*
*Completed: 2026-06-28*
