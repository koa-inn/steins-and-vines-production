---
phase: 08-first-batch-promo
verified: 2026-05-03T00:00:00Z
status: human_needed
score: 5/5 must-haves verified
overrides_applied: 0
human_verification:
  - test: "Homepage banner renders in browser and is dismissible"
    expected: "Burgundy banner strip visible between header and hero on steinsandvines.ca homepage; clicking X hides it; on reload it stays hidden; FIRSTBATCH code is legible in the banner text"
    why_human: "Banner visibility requires a browser — cannot verify classList.remove('hidden') actually produces a visible element or that the burgundy color renders correctly via CSS custom property var(--color-burgundy)"
  - test: "Checkout promo code widget flow — apply, display, remove"
    expected: "On reservation.html?cart=ferment, a 'Promo Code' input field appears below the items table. Typing FIRSTBATCH and clicking Apply shows the applied chip 'FIRSTBATCH — 20% off kits' and discount badges on kit line items. A savings row appears above the Total row. Clicking Remove Code restores original pricing."
    why_human: "UI interaction state depends on DOM rendering, event handlers, and the renderReservationItems() re-render cycle — not testable with grep"
  - test: "Ingredients are not discounted in dual-cart checkout"
    expected: "On dual-cart checkout, ingredient items show no discount badge and their prices are not reduced when promo is active"
    why_human: "Dual-cart promo exclusion logic requires rendering both carts simultaneously to observe"
  - test: "Helcim charge amount reflects discounted total when promo is applied"
    expected: "When FIRSTBATCH is applied and user proceeds to payment, the Helcim iframe opens with the discounted amount (kit subtotal * 0.80 + Maker's Fee * 0.80 + ingredient subtotal at full price + tax), not the original pre-discount total"
    why_human: "Payment amount computation requires runtime execution with real cart data and the Helcim payment flow"
---

# Phase 8: First-Batch Promo Verification Report

**Phase Goal:** New customers see a 20% discount offer on the homepage and can apply promo code FIRSTBATCH at checkout, with one-use-per-email enforcement
**Verified:** 2026-05-03
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

The roadmap defines 3 success criteria. The phase instructions specify 5. All 5 are evaluated below.

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Homepage displays a prominent banner advertising "20% off your first batch" with the code FIRSTBATCH clearly visible | ✓ VERIFIED | `content/home.json` `promo-banner.text` = `"20% off your first batch — use code <strong>FIRSTBATCH</strong> at checkout"`, `promo-banner.enabled = true`; `index.html` line 155 contains `id="promo-banner" class="promo-banner hidden"`; `13-init.js` `initPromoBanner()` fetches JSON, checks `enabled`, populates `.promo-banner-text` with `innerHTML`, calls `el.classList.remove('hidden')` |
| 2 | Checkout page has a promo code input that validates FIRSTBATCH and shows applied discount | ✓ VERIFIED | `12-checkout.js` line 39: `var _promoApplied = null;`; line 314: `function applyPromoCode()`; line 340: `fetch(mw + '/api/promo/validate', ...)`; line 359: `function renderPromoWidget(container)` renders input+button or applied chip; `_promoApplied` checked in item render loop at lines 517-518, 776-777, 787-788 |
| 3 | Server enforces one-use-per-email via Redis, with fail-open on Redis failure | ✓ VERIFIED | `promo.js` lines 37-46: `cache.get(C.CACHE_KEYS.PROMO_REDEEMED_PREFIX + rawEmail)` with `catch(err) { return res.json({ ok: true, discountPct: ... }) }` fail-open; `checkout.js` lines 321-347: server re-validates `body.promo_code === 'FIRSTBATCH'` with `acquireLock` + `cache.get(promoKey)` + fail-open catch block |
| 4 | Maker's Fee receives the same 20% discount when promo is applied | ✓ VERIFIED | `checkout.js` lines 394-395: `makersFeeRate = Math.round(makersFeeItem.rate * (1 - promoDiscount / 100) * 100) / 100` when `promoDiscount > 0`; frontend `12-checkout.js` line 730: `var bFeeRate = (_promoApplied) ? Math.round(bFeeRateBase * (1 - _promoApplied.discountPct / 100) * 100) / 100 : bFeeRateBase`; line 803 and 1802 apply same discount in totals |
| 5 | Redemption is burned only after successful Zoho SO creation | ✓ VERIFIED | `checkout.js` line 490: `var soId = data.salesorder ? data.salesorder.salesorder_id : null`; line 495: `if (soId && promoDiscount > 0 && customerEmail) { ... cache.set(burnKey, ..., 5 * 365 * 24 * 60 * 60) }` — burn fires only inside the post-SO success block, fire-and-forget with `.catch()` |

**Score:** 5/5 truths verified (programmatically)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `zoho-middleware/routes/promo.js` | POST /api/promo/validate, DELETE /api/promo/redemption/:email, POST /api/promo/seed-kiosk | ✓ VERIFIED | 115 lines, all 3 endpoints present, exports router, imports cache/log/C |
| `zoho-middleware/lib/constants.js` | PROMO_REDEEMED_PREFIX constant | ✓ VERIFIED | Line 61: `PROMO_REDEEMED_PREFIX: 'promo:firstbatch:redeemed:'` |
| `zoho-middleware/__tests__/promo.test.js` | Unit tests covering all endpoints, min 100 lines | ✓ VERIFIED | 240 lines, 16 tests, all pass |
| `js/modules/12-checkout.js` | _promoApplied state, promo widget, applyPromoCode(), promo_code in submit bodies | ✓ VERIFIED | All present; `_promoApplied` appears 29 times; `promo_code` in both dual-cart (line 1417) and single-cart (line 1884) submit bodies |
| `zoho-middleware/routes/checkout.js` | Server re-validation, acquireLock, Maker's Fee discount, burn after SO | ✓ VERIFIED | `PROMO_REDEEMED_PREFIX` used at lines 322, 496; `acquireLock` at line 327; `makersFeeRate` discounted at lines 394-395; burn at line 495-499 |
| `content/home.json` | promo-banner object with enabled, tag, text, cta, cta-href | ✓ VERIFIED | All 5 keys present; `enabled: true`, text contains FIRSTBATCH |
| `index.html` | #promo-banner element between hero and promo-section, .hidden class | ✓ VERIFIED | Line 155: `id="promo-banner" class="promo-banner hidden" role="banner"`, positioned after `</section>` of hero |
| `js/modules/13-init.js` | initPromoBanner function with localStorage check, kiosk guard, enabled check | ✓ VERIFIED | Function at line 2; localStorage check at line 5; kiosk guard at lines 9-11; `enabled` check at line 18; `classList.remove('hidden')` at line 37; called in `page === 'home'` block at line 300 |
| `css/styles.css` | promo-banner-dismiss, promo-code-row, promo-code-chip, reservation-subtotal--savings | ✓ VERIFIED | `promo-banner-dismiss` at lines 514, 532; `promo-code-row` at line 6689; `promo-code-chip` at line 6743; `reservation-subtotal--savings` at line 6767; total 15 promo-code-related rules |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `zoho-middleware/routes/promo.js` | `zoho-middleware/lib/cache.js` | `cache.get`, `cache.set`, `cache.del` | ✓ WIRED | All 3 cache methods used: GET for redemption check (line 37), SET for kiosk preset (line 104), DEL for admin reset (line 62) |
| `zoho-middleware/routes/promo.js` | `zoho-middleware/lib/constants.js` | `C.CACHE_KEYS.PROMO_REDEEMED_PREFIX`, `C.CACHE_KEYS.KIOSK_DISCOUNT_PRESETS` | ✓ WIRED | Both constants referenced: `PROMO_REDEEMED_PREFIX` at lines 37, 62; `KIOSK_DISCOUNT_PRESETS` at lines 77, 104 |
| `zoho-middleware/server.js` | `zoho-middleware/routes/promo.js` | `app.use('/', require('./routes/promo'))` | ✓ WIRED | `require('./routes/promo')` at line 389; API key bypass `/promo/validate` at line 234 |
| `js/modules/12-checkout.js` | `/api/promo/validate` | `fetch(mw + '/api/promo/validate', ...)` in `applyPromoCode()` | ✓ WIRED | Line 340: `fetch(mw + '/api/promo/validate', { method: 'POST', ... })` with response handling at lines 347-358 |
| `js/modules/12-checkout.js` | `/api/checkout` | `promo_code` field in both submit bodies | ✓ WIRED | Line 1417: dual-cart ferment body; line 1884: single-cart body |
| `zoho-middleware/routes/checkout.js` | `zoho-middleware/lib/cache.js` | `acquireLock`, `cache.get`, `cache.set` for promo | ✓ WIRED | `acquireLock(promoKey, 30)` at line 327; `cache.get(promoKey)` at line 336; `cache.set(burnKey, ...)` at line 497 |
| `js/modules/13-init.js` | `content/home.json` | `fetch('content/home.json')` in `initPromoBanner` | ✓ WIRED | Line 14: `fetch('content/home.json')` with JSON parse and `data['promo-banner']` read at line 17 |
| `js/modules/13-init.js` | `index.html` #promo-banner | `document.getElementById('promo-banner')` | ✓ WIRED | Line 20: `var el = document.getElementById('promo-banner')` with null guard; `el.classList.remove('hidden')` at line 37 |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `13-init.js` initPromoBanner | `config` (promo-banner object) | `fetch('content/home.json')` → `data['promo-banner']` | Yes — JSON file in repo with real FIRSTBATCH text | ✓ FLOWING |
| `12-checkout.js` renderPromoWidget | `_promoApplied` | Set by `applyPromoCode()` on successful fetch to `/api/promo/validate` | Yes — server returns `{ ok: true, discountPct: 20, code: 'FIRSTBATCH' }` from promo.js | ✓ FLOWING |
| `checkout.js` runCheckout | `promoDiscount` | `body.promo_code === 'FIRSTBATCH'` + `cache.get(promoKey)` check | Yes — reads from Redis with fail-open; sets 20 on valid promo | ✓ FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| promo.js exports router | `node -e "var r = require('./zoho-middleware/routes/promo'); console.log(typeof r === 'function')"` | `true` | ✓ PASS |
| constants.js has PROMO_REDEEMED_PREFIX | `grep -c "PROMO_REDEEMED_PREFIX" zoho-middleware/lib/constants.js` | `1` | ✓ PASS |
| server.js bypasses API key for /promo/validate | `grep "promo/validate" zoho-middleware/server.js` | line 234 found | ✓ PASS |
| 16 promo tests pass | `cd zoho-middleware && npm test -- --testPathPattern=promo` | 16/16 pass | ✓ PASS |
| Full middleware test suite (no regressions) | `cd zoho-middleware && npm test` | 426/426 pass, 19 suites | ✓ PASS |
| Full frontend test suite (no regressions) | `npm test` | 270/270 pass, 12 suites | ✓ PASS |
| content/home.json promo-banner.enabled | `python3 -c "import json; d=json.load(open('content/home.json')); print(d['promo-banner']['enabled'])"` | `True` | ✓ PASS |
| index.html has promo-banner with .hidden class | `grep 'class="promo-banner hidden"' index.html` | line 155 found | ✓ PASS |
| Redemption burn uses 5-year TTL | `grep "5 \* 365 \* 24 \* 60 \* 60" zoho-middleware/routes/checkout.js` | line 497 found | ✓ PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| PROMO-01 | 08-03-PLAN.md | Homepage displays a prominent banner advertising 20% off first batch with promo code FIRSTBATCH | ✓ SATISFIED | `index.html` `#promo-banner`, `content/home.json` `promo-banner.text` contains FIRSTBATCH, `initPromoBanner()` in `13-init.js` wired and called |
| PROMO-02 | 08-02-PLAN.md | Checkout flow accepts a promo code input field and applies 20% discount to kit line items when valid | ✓ SATISFIED | `_promoApplied` state, `renderPromoWidget()`, `applyPromoCode()` in `12-checkout.js`; discount applied to kit items in render, totals, buildLines, and Helcim charge calculation |
| PROMO-03 | 08-01-PLAN.md | Middleware validates promo code and enforces one redemption per email address via Redis | ✓ SATISFIED | `POST /api/promo/validate` with Redis get check; `checkout.js` re-validates with `acquireLock` + Redis get; burn after SO creation in `checkout.js` |

**Note:** REQUIREMENTS.md traceability table (lines 63-79) was last updated 2026-04-29 and does not include PROMO-01/02/03 rows mapping to Phase 8. This is a documentation gap — the requirements themselves are defined at lines 31-33 and the implementations are fully in place. The traceability table should be updated to mark these complete.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `REQUIREMENTS.md` traceability table | 63-79 | PROMO-01/02/03 not listed with Phase 8 mapping or completion status | ℹ️ Info | Documentation only — does not affect runtime behavior |

No code-level anti-patterns found. No TODO/FIXME/placeholder stubs in promo.js, checkout.js, 12-checkout.js, 13-init.js, or related files. All promo code paths have real implementations.

### Human Verification Required

#### 1. Homepage Banner Renders Visually

**Test:** Open `steinsandvines.ca` (or `staging.steinsandvines.ca`) in a browser and observe the area between the navigation header and the hero image.
**Expected:** A full-width burgundy banner strip displays with the "Limited Offer" tag, the text "20% off your first batch — use code FIRSTBATCH at checkout" (FIRSTBATCH in bold), and a "Reserve Your Batch" CTA link. Clicking the X button (top-right of banner) hides the banner. Refreshing the page confirms it stays hidden. Opening a private/incognito window confirms it reappears.
**Why human:** The banner is behind a `.hidden` class removed by JavaScript. CSS rendering, font rendering, and the burgundy color from `var(--color-burgundy)` require a real browser to confirm.

#### 2. Checkout Promo Widget — Apply/Remove Flow

**Test:** Add a kit item to the ferment cart. Navigate to `reservation.html?cart=ferment`. Scroll to the items section. Observe the promo code widget, enter "FIRSTBATCH" in the input, enter a valid email in the email field, click "Apply Code".
**Expected:** The input/button row is replaced by the chip "FIRSTBATCH — 20% off kits" with a "Remove Code" button. Kit line items show a "20% OFF" discount badge and a strikethrough on the original price with the discounted price shown. A savings row appears above the Total row showing the total discount. Clicking "Remove Code" restores all prices to the original amounts and hides the savings row.
**Why human:** UI state transitions (widget re-render, badge display, savings row injection) require browser execution.

#### 3. Ingredients Excluded from Promo in Dual-Cart

**Test:** Add a kit to the ferment cart AND an ingredient to the ingredient cart. Navigate to the dual-cart checkout page. Apply FIRSTBATCH. Observe both cart sections.
**Expected:** Kit items in the ferment section show 20% OFF badges and discounted prices. Ingredient items in the ingredient section show no discount badge and original prices. The total savings row reflects only the kit discount, not the ingredient prices.
**Why human:** Dual-cart rendering requires browser with both carts populated simultaneously.

#### 4. Helcim Charge Reflects Discounted Amount

**Test:** Apply FIRSTBATCH on a ferment cart checkout and proceed through to the payment step.
**Expected:** The Helcim payment iframe opens with a charge amount that is 20% less on the kit subtotal and Maker's Fee (plus tax on the discounted amounts), not the original pre-discount total. The amount shown in the Helcim iframe should match the "Total" row in the cart summary with promo applied.
**Why human:** Verifying the correct amount reaches Helcim requires a real payment flow execution. The code path (lines 1797-1814 in 12-checkout.js for single-cart, lines 1685-1716 for dual-cart) applies the discount before computing `charge` / `_dualCharge`, but only browser execution can confirm the value reaches the Helcim API correctly.

---

## Summary

All 5 must-have truths are verified in the codebase with full artifact, wiring, and data-flow confirmation. Both test suites pass cleanly (426 middleware tests, 270 frontend tests) with no regressions. The phase goal is implemented correctly.

The status is `human_needed` because 4 behavioral checks require browser verification: banner visual rendering, checkout widget UI state transitions, dual-cart ingredient exclusion display, and the Helcim charge amount at payment time. These are integration/visual behaviors that cannot be confirmed with grep and static analysis.

One informational finding: the `REQUIREMENTS.md` traceability table at lines 63-79 does not include PROMO-01/02/03 rows or their Phase 8 completion mapping. This is a documentation gap only and does not affect the implementation.

---

_Verified: 2026-05-03_
_Verifier: Claude (gsd-verifier)_
