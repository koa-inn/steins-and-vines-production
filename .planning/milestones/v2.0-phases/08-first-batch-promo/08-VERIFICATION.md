---
phase: 08-first-batch-promo
verified: 2026-05-04T00:00:00Z
status: human_needed
score: 5/5 must-haves verified
overrides_applied: 0
re_verification:
  previous_status: human_needed
  previous_score: 5/5
  gaps_closed: []
  gaps_remaining: []
  regressions: []
  new_plans_verified: [08-04, 08-05, 08-06]
human_verification:
  - test: "Homepage banner renders in browser and is dismissible"
    expected: "Burgundy banner strip visible between header and hero on steinsandvines.ca homepage; clicking X hides it; on reload it stays hidden; FIRSTBATCH code is legible in the banner text"
    why_human: "Banner visibility requires a browser — cannot verify classList.remove('hidden') actually produces a visible element or that the burgundy color renders correctly via CSS custom property var(--color-burgundy)"
  - test: "Checkout promo code widget flow — apply, display, remove"
    expected: "On reservation.html?cart=ferment, a 'Promo Code' input field appears below the items table. Typing FIRSTBATCH and clicking Apply shows the applied chip 'FIRSTBATCH — 20% off kits' and discount badges on kit line items. A savings row appears above the Total row. Clicking Remove Code restores original pricing."
    why_human: "UI interaction state depends on DOM rendering, event handlers, and the renderReservationItems() re-render cycle — not testable with grep"
  - test: "Dual-cart combined totals update after promo apply/remove"
    expected: "On dual-cart checkout with kit + ingredient items, applying FIRSTBATCH updates the 'Combined Total (both orders)' in the ingredient section and the bottom summary near submit to reflect the discounted amount. Removing the code restores both displays to original amounts."
    why_human: "Dual-cart re-render trigger is verified in code (lines 390, 426) and tested (5 passing regression tests), but visual confirmation of both Combined Total labels requires browser execution"
  - test: "Ingredients are not discounted in dual-cart checkout"
    expected: "Ingredient items show no discount badge and their prices are not reduced when promo is active"
    why_human: "Dual-cart promo exclusion logic requires rendering both carts simultaneously to observe"
  - test: "Helcim charge amount reflects discounted total when promo is applied"
    expected: "When FIRSTBATCH is applied and user proceeds to payment, the Helcim iframe opens with the discounted amount (kit subtotal * 0.80 + Maker's Fee * 0.80 + ingredient subtotal at full price + tax), not the original pre-discount total"
    why_human: "Payment amount computation requires runtime execution with real cart data and the Helcim payment flow"
  - test: "Checkout form fields restore after page refresh"
    expected: "On reservation.html, filling name/email/phone fields and refreshing the page shows the values re-populated. Completing a checkout confirms the draft is cleared."
    why_human: "localStorage restore behavior and success-handler clear require browser execution to confirm"
---

# Phase 8: First-Batch Promo Verification Report

**Phase Goal:** New customers see a 20% discount offer on the homepage and can apply promo code FIRSTBATCH at checkout, with one-use-per-email enforcement, plus checkout form persistence and cart merge feasibility
**Verified:** 2026-05-04
**Status:** human_needed
**Re-verification:** Yes — Plans 04, 05, 06 completed after initial verification on 2026-05-03

## Goal Achievement

The ROADMAP defines 5 success criteria. All 5 are verified below.

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Homepage displays a prominent banner advertising "20% off your first batch" with the code FIRSTBATCH clearly visible | ✓ VERIFIED | `content/home.json` `promo-banner.enabled = true`, text contains `<strong>FIRSTBATCH</strong>`; `index.html` line 155 has `id="promo-banner" class="promo-banner hidden"`; `13-init.js` `initPromoBanner()` fetches JSON, checks `enabled`, calls `el.classList.remove('hidden')` |
| 2 | Checkout flow has a promo code input field that accepts FIRSTBATCH and applies a 20% discount to kit line items before payment | ✓ VERIFIED | `12-checkout.js`: `_promoApplied` state (line 39), `renderPromoWidget()`, `applyPromoCode()` (line 314) fetches `/api/promo/validate`; discount applied to kit items in render loop and `buildLines`; `promo_code` passed in both single-cart (line 1884) and dual-cart (line 1417) submit bodies; Helcim charge computation includes `_promoApplied` discount |
| 3 | If a customer email has already redeemed FIRSTBATCH, the code is rejected with a clear message — enforced server-side via Redis | ✓ VERIFIED | `promo.js` lines 37-46: `cache.get(PROMO_REDEEMED_PREFIX + rawEmail)` with fail-open catch; `checkout.js` lines 321-347: server re-validates with `acquireLock` + `cache.get(promoKey)` + fail-open catch; burn fires at line 495 only after confirmed SO creation |
| 4 | Checkout form fields (name, email, phone) persist across page refresh via localStorage | ✓ VERIFIED | `12-checkout.js`: `_FORM_DRAFT_KEY = 'sv-checkout-form-draft'` (line 42); `saveCheckoutFormDraft` (line 44), `restoreCheckoutFormDraft` (line 57), `clearCheckoutFormDraft` (line 72); restore called after `renderReservationItems()` in `initReservationPage()` (line 189); save wired to input events for res-name/email/phone in `setupReservationForm()` (line 1692-1695); clear called in both success handlers (lines 1576, 1981); all three exported and covered by 11 unit tests |
| 5 | Cart merge feasibility assessment documents all affected code paths and proposes an implementation roadmap | ✓ VERIFIED | `.planning/phases/08-first-batch-promo/08-cart-merge-assessment.md` exists (476 lines, 45 section headings); all 7 required sections present: Current Architecture, Code Impact Matrix, Behavioral Changes, Migration Strategy, Server-Side Impact, Risk Assessment, Recommended Implementation Phases; all 6 specified files covered with function names and line numbers |

**Score:** 5/5 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `zoho-middleware/routes/promo.js` | POST /api/promo/validate, DELETE /api/promo/redemption/:email, POST /api/promo/seed-kiosk | ✓ VERIFIED | 114 lines, all 3 endpoints present, exports router |
| `zoho-middleware/lib/constants.js` | PROMO_REDEEMED_PREFIX constant | ✓ VERIFIED | `PROMO_REDEEMED_PREFIX: 'promo:firstbatch:redeemed:'` present |
| `zoho-middleware/__tests__/promo.test.js` | Unit tests covering all endpoints | ✓ VERIFIED | 16 tests, all pass |
| `js/modules/12-checkout.js` | _promoApplied state, promo widget, applyPromoCode(), promo_code in submit bodies | ✓ VERIFIED | `_promoApplied` appears 36 times; `promo_code` in both submit bodies |
| `zoho-middleware/routes/checkout.js` | Server re-validation, acquireLock, Maker's Fee discount, burn after SO | ✓ VERIFIED | All present; burn at line 495-499 after `soId` confirmed |
| `content/home.json` | promo-banner object with enabled, tag, text, cta, cta-href | ✓ VERIFIED | All 5 keys present; `enabled: true`; text contains FIRSTBATCH |
| `index.html` | #promo-banner element with .hidden class | ✓ VERIFIED | Line 155: `id="promo-banner" class="promo-banner hidden" role="banner"` |
| `js/modules/13-init.js` | initPromoBanner function | ✓ VERIFIED | Function defined, localStorage check, IS_KIOSK guard, fetch, `classList.remove('hidden')`, called in `page === 'home'` block |
| `css/styles.css` | promo-banner-dismiss, promo-code-row, promo-code-chip, reservation-subtotal--savings | ✓ VERIFIED | All 4 classes present; `promo-banner-dismiss` with `position: absolute`; 15+ promo-code-related rules |
| `tests/frontend/checkout-promo-totals.test.js` | Regression tests for dual-cart combined totals | ✓ VERIFIED | 289 lines, 5 tests (3 direct + 2 applyPromoCode regression); all pass |
| `js/modules/12-checkout.js` | if (_isDualCart) renderCheckoutIngredientSection() in both apply and remove paths | ✓ VERIFIED | Lines 390 (apply success) and 426 (remove handler) both contain the re-render trigger |
| `tests/frontend/checkout-form-persistence.test.js` | Unit tests for save/restore/clear form draft | ✓ VERIFIED | 181 lines, 11 tests covering save, restore, clear, edge cases; all pass |
| `.planning/phases/08-first-batch-promo/08-cart-merge-assessment.md` | Comprehensive feasibility assessment, 100+ lines | ✓ VERIFIED | 476 lines, 7 sections, all 6 affected files cataloged with line numbers |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `zoho-middleware/routes/promo.js` | `zoho-middleware/lib/cache.js` | `cache.get`, `cache.set`, `cache.del` | ✓ WIRED | All 3 cache methods used |
| `zoho-middleware/routes/promo.js` | `zoho-middleware/lib/constants.js` | `C.CACHE_KEYS.PROMO_REDEEMED_PREFIX` | ✓ WIRED | Used at lines 37, 62 |
| `zoho-middleware/server.js` | `zoho-middleware/routes/promo.js` | `app.use('/', require('./routes/promo'))` | ✓ WIRED | Line 389; API key bypass for `/promo/validate` at line 234 |
| `js/modules/12-checkout.js` | `/api/promo/validate` | `fetch(mw + '/api/promo/validate', ...)` in `applyPromoCode()` | ✓ WIRED | Line 340 with response handling |
| `js/modules/12-checkout.js` | `/api/checkout` | `promo_code` field in both submit bodies | ✓ WIRED | Lines 1417 (dual-cart ferment), 1884 (single-cart) |
| `zoho-middleware/routes/checkout.js` | `zoho-middleware/lib/cache.js` | `acquireLock`, `cache.get`, `cache.set` for promo | ✓ WIRED | `acquireLock(promoKey, 30)`, `cache.get(promoKey)`, `cache.set(burnKey)` |
| `js/modules/13-init.js` | `content/home.json` | `fetch('content/home.json')` in `initPromoBanner` | ✓ WIRED | Line 14: fetch with JSON parse and `data['promo-banner']` read |
| `js/modules/13-init.js` | `index.html` #promo-banner | `document.getElementById('promo-banner')` | ✓ WIRED | Line 20 with null guard; `el.classList.remove('hidden')` at line 37 |
| `applyPromoCode()` | `renderCheckoutIngredientSection()` | `if (_isDualCart) renderCheckoutIngredientSection()` | ✓ WIRED | Line 390 in apply success handler |
| `renderPromoWidget() Remove handler` | `renderCheckoutIngredientSection()` | `if (_isDualCart) renderCheckoutIngredientSection()` | ✓ WIRED | Line 426 in remove click handler |
| `restoreCheckoutFormDraft()` | `localStorage` | `getItem('sv-checkout-form-draft')` | ✓ WIRED | Line 59; called after `renderReservationItems()` in `initReservationPage()` line 189 |
| `checkout success handlers` | `clearCheckoutFormDraft()` | `removeItem('sv-checkout-form-draft')` | ✓ WIRED | Lines 1576 (dual-cart) and 1981 (single-cart) |
| `setupReservationForm()` | `saveCheckoutFormDraft()` | `addEventListener('input', saveCheckoutFormDraft)` | ✓ WIRED | Lines 1692-1695; all 3 fields wired |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `13-init.js` initPromoBanner | `config` (promo-banner object) | `fetch('content/home.json')` → `data['promo-banner']` | Yes — JSON file with real FIRSTBATCH text | ✓ FLOWING |
| `12-checkout.js` renderPromoWidget | `_promoApplied` | Set by `applyPromoCode()` on successful fetch to `/api/promo/validate` | Yes — server returns `{ ok: true, discountPct: 20, code: 'FIRSTBATCH' }` | ✓ FLOWING |
| `checkout.js` runCheckout | `promoDiscount` | `body.promo_code === 'FIRSTBATCH'` + `cache.get(promoKey)` check | Yes — reads Redis with fail-open; sets 20 on valid promo | ✓ FLOWING |
| `12-checkout.js` renderCheckoutIngredientSection | combined total element | Re-called after promo apply/remove via `if (_isDualCart)` guards | Yes — re-render reads live `_promoApplied` state | ✓ FLOWING |
| `12-checkout.js` saveCheckoutFormDraft | `_FORM_DRAFT_KEY` localStorage | `getElementById('res-name/email/phone').value` | Yes — reads live DOM input values | ✓ FLOWING |
| `12-checkout.js` restoreCheckoutFormDraft | DOM input `.value` | `localStorage.getItem(_FORM_DRAFT_KEY)` JSON parse | Yes — reads real localStorage data | ✓ FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| promo.js exports router | `node -e "var r = require('./zoho-middleware/routes/promo'); console.log(typeof r === 'function')"` | `true` | ✓ PASS |
| constants.js has PROMO_REDEEMED_PREFIX | `grep -c "PROMO_REDEEMED_PREFIX" zoho-middleware/lib/constants.js` | `1` | ✓ PASS |
| server.js bypasses API key for /promo/validate | `grep "promo/validate" zoho-middleware/server.js` | line 234 found | ✓ PASS |
| 16 promo tests pass | `cd zoho-middleware && npm test -- --testPathPattern=promo` | 16/16 pass | ✓ PASS |
| 5 checkout-promo-totals tests pass | `npm test -- --testPathPattern=checkout-promo-totals` | 5/5 pass | ✓ PASS |
| 11 checkout-form-persistence tests pass | `npm test -- --testPathPattern=checkout-form-persistence` | 11/11 pass | ✓ PASS |
| Full frontend test suite | `npm test` | 286/286 pass, 14 suites | ✓ PASS |
| Full middleware test suite | `cd zoho-middleware && npm test` | 426/426 pass, 19 suites | ✓ PASS |
| _isDualCart re-render trigger (apply) | `grep -n "if (_isDualCart) renderCheckoutIngredientSection" js/modules/12-checkout.js` | lines 390 and 426 | ✓ PASS |
| Form draft constant | `grep "_FORM_DRAFT_KEY" js/modules/12-checkout.js` | line 42: `'sv-checkout-form-draft'` | ✓ PASS |
| clearCheckoutFormDraft in both success handlers | `grep -c "clearCheckoutFormDraft" js/modules/12-checkout.js` | 4 (def + dual-cart + single-cart + export) | ✓ PASS |
| Cart merge assessment line count | `wc -l .planning/phases/08-first-batch-promo/08-cart-merge-assessment.md` | 476 lines | ✓ PASS |
| Cart merge assessment section headings | `grep -c "^##" 08-cart-merge-assessment.md` | 45 headings | ✓ PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| PROMO-01 | 08-03-PLAN.md | Homepage displays a prominent banner advertising 20% off first batch with promo code FIRSTBATCH | ✓ SATISFIED | `index.html` `#promo-banner`, `content/home.json` promo-banner.text contains FIRSTBATCH, `initPromoBanner()` in `13-init.js` wired and called |
| PROMO-02 | 08-02-PLAN.md | Checkout flow accepts a promo code input field and applies 20% discount to kit line items when valid | ✓ SATISFIED | `_promoApplied` state, `renderPromoWidget()`, `applyPromoCode()`, discount in render loop, `buildLines`, and charge calculation; dual-cart re-render trigger added in 08-04 |
| PROMO-03 | 08-01-PLAN.md | Middleware validates promo code and enforces one redemption per email address via Redis | ✓ SATISFIED | `POST /api/promo/validate` with Redis get check and fail-open; `checkout.js` re-validates with `acquireLock` + Redis get; burn after SO creation |
| FORM-01 | 08-05-PLAN.md | Checkout form fields persist across page refresh via localStorage | ✓ SATISFIED | `saveCheckoutFormDraft`/`restoreCheckoutFormDraft`/`clearCheckoutFormDraft` in `12-checkout.js`; wired to input events, init, and success handlers; 11 unit tests pass |
| CART-01 | 08-06-PLAN.md | Cart merge feasibility assessment documents all affected code paths and proposes implementation roadmap | ✓ SATISFIED | `08-cart-merge-assessment.md` (476 lines); all 7 sections; all 6 affected files cataloged; 4-phase implementation roadmap |

**Note on REQUIREMENTS.md:** FORM-01 and CART-01 appear in ROADMAP.md Phase 8 requirements and their respective plan frontmatter, but are not listed in `.planning/REQUIREMENTS.md`. PROMO-01 and PROMO-03 are defined in REQUIREMENTS.md but show `[ ]` (not checked off), while PROMO-02 is `[x]`. This is a documentation maintenance gap — all three PROMO requirements are fully implemented. The traceability table in REQUIREMENTS.md also does not include rows for Phase 8. These are documentation gaps only and do not affect the implementation.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `REQUIREMENTS.md` | 31-33 | PROMO-01 and PROMO-03 not checked off (`[ ]`) despite full implementation | ℹ️ Info | Documentation only |
| `REQUIREMENTS.md` | Traceability table | PROMO-01/02/03, FORM-01, CART-01 not listed; Phase 8 absent from table | ℹ️ Info | Documentation only |

No code-level anti-patterns found in any of the Plan 04, 05, or 06 implementations.

### Human Verification Required

#### 1. Homepage Banner Renders Visually

**Test:** Open `steinsandvines.ca` (or `staging.steinsandvines.ca`) in a browser and observe the area between the navigation header and the hero image.
**Expected:** A full-width burgundy banner strip displays with the "Limited Offer" tag, the text "20% off your first batch — use code FIRSTBATCH at checkout" (FIRSTBATCH in bold), and a "Reserve Your Batch" CTA link. Clicking the X button (top-right of banner) hides the banner. Refreshing the page confirms it stays hidden. Opening a private/incognito window confirms it reappears.
**Why human:** The banner is behind a `.hidden` class removed by JavaScript. CSS rendering and the burgundy color from `var(--color-burgundy)` require a real browser to confirm.

#### 2. Checkout Promo Widget — Apply/Remove Flow

**Test:** Add a kit item to the ferment cart. Navigate to `reservation.html?cart=ferment`. Scroll to the items section. Enter "FIRSTBATCH" in the promo code input and a valid email, then click "Apply Code".
**Expected:** The input/button row is replaced by the chip "FIRSTBATCH — 20% off kits" with a "Remove Code" button. Kit line items show a "20% OFF" discount badge and strikethrough pricing. A savings row appears above the Total row. Clicking "Remove Code" restores all prices to the original amounts.
**Why human:** UI state transitions require browser execution.

#### 3. Dual-Cart Combined Totals Update After Promo

**Test:** Add a kit item to the ferment cart AND an ingredient to the ingredient cart. Navigate to dual-cart checkout (no `?cart=` param). Apply FIRSTBATCH.
**Expected:** The "Combined Total (both orders)" label in the ingredient section AND the bottom summary near the submit button both update to reflect the 20% discount on kits. Removing the code restores both totals.
**Why human:** The re-render trigger code is verified and regression-tested (5 passing tests), but two separate DOM sections updating simultaneously requires visual browser confirmation.

#### 4. Ingredients Excluded from Promo

**Test:** In the same dual-cart checkout with promo applied, observe the ingredient items section.
**Expected:** Ingredient items show no discount badge and their prices are not reduced. The savings row reflects only the kit discount.
**Why human:** Requires rendering both carts simultaneously.

#### 5. Helcim Charge Reflects Discounted Amount

**Test:** Apply FIRSTBATCH on a ferment cart checkout and proceed through to the payment step.
**Expected:** The Helcim payment iframe opens with a charge amount equal to `(kit subtotal * 0.80) + (Maker's Fee * 0.80 * kitQty) + (ingredient subtotal) + tax`, not the original total.
**Why human:** Verifying the correct amount reaches Helcim requires a real payment flow execution.

#### 6. Checkout Form Fields Restore After Refresh

**Test:** On `reservation.html`, fill in name, email, and phone fields. Refresh the page.
**Expected:** All three fields show the previously entered values. Complete a checkout and confirm the draft is cleared (fields are empty if you navigate back to the checkout page).
**Why human:** localStorage read/write behavior requires browser execution.

---

## Summary

All 5 ROADMAP success criteria for Phase 8 are fully implemented and verified in the codebase:

1. **PROMO-01 (Homepage banner):** Content-driven, dismissible banner in `index.html` + `content/home.json` + `13-init.js` — verified in initial verification (2026-05-03).
2. **PROMO-02 (Checkout promo widget):** Full promo code widget in `12-checkout.js`, server-side enforcement in `checkout.js`, dual-cart combined totals re-render fix in Plan 04 — verified in initial and re-verification.
3. **PROMO-03 (Redis one-use enforcement):** `routes/promo.js` with acquireLock + Redis check + fail-open + burn after SO — verified in initial verification.
4. **FORM-01 (Form persistence):** `saveCheckoutFormDraft`/`restoreCheckoutFormDraft`/`clearCheckoutFormDraft` fully wired in `12-checkout.js` with 11 unit tests — verified in this re-verification (Plan 05).
5. **CART-01 (Cart merge assessment):** `08-cart-merge-assessment.md` (476 lines, 7 sections, 6 files cataloged, 4-phase roadmap) — verified in this re-verification (Plan 06).

Both test suites pass cleanly: 286 frontend tests (14 suites), 426 middleware tests (19 suites). No regressions from Plans 04, 05, or 06.

Status remains `human_needed` because 6 behavioral checks require browser verification: banner visual rendering, checkout promo widget UI state transitions, dual-cart combined total visual updates, ingredient exclusion display, Helcim charge amount at payment time, and form field restore/clear.

One informational finding: REQUIREMENTS.md checkboxes for PROMO-01 and PROMO-03 remain unchecked and the traceability table does not include Phase 8 rows. Documentation gap only — does not affect the implementation.

---

_Verified: 2026-05-04_
_Verifier: Claude (gsd-verifier)_
_Re-verification: Yes (Plans 04, 05, 06 added since initial 2026-05-03 verification)_
