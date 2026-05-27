# Cart Merge Feasibility Assessment
## Merging Dual-Cart (sv-cart-ferment + sv-cart-ingredients) into Single Cart

**Assessment Date:** 2026-05-04
**Author:** GSD Executor (Phase 08, Plan 06)
**Status:** Recommendation — proceed with phased refactor

---

## 1. Current Architecture

### 1.1 Storage Layer

Two independent localStorage keys hold separate carts:

| Key | Constant | Contents |
|-----|----------|----------|
| `sv-cart-ferment` | `CART_KEYS.FERMENT` | Kits (item_type: `kit`), kit-purchases routed here by mistake in legacy code |
| `sv-cart-ingredients` | `CART_KEYS.INGREDIENTS` | Ingredients (`ingredient`), Services (`service`), Kit-purchases (`kit-purchase`) |
| `sv-reservation` | `CART_KEYS.LEGACY_RESERVATION` | Migration-only; no new writes; auto-migrated on `DOMContentLoaded` |

A legacy auto-migration (`migrateReservationData` in `11-cart.js:16`) reads `sv-reservation` on every page load, splits items by type, and writes to both new keys. This migration runs unconditionally in `13-init.js:220`.

### 1.2 Routing Logic

`getCartKey(product)` (`11-cart.js:41`): Routes by `_item_type` or `item_type`:
- `'ingredient'` → `INGREDIENT_CART_KEY`
- `'kit-purchase'` → `INGREDIENT_CART_KEY` (take-home kit purchase via catalog "Buy Kit" button)
- everything else → `FERMENT_CART_KEY`

`getCartKeyForTab(tab)` (`11-cart.js:36`): Routes by active sidebar tab:
- `'ingredients'` → `INGREDIENT_CART_KEY`
- everything else → `FERMENT_CART_KEY`

### 1.3 Dual-Cart Activation on Checkout

`initReservationPage` (`12-checkout.js:114`): Sets `_isDualCart = true` when:
1. No `?cart=` URL param forces a single cart, AND
2. Both `getReservation(FERMENT_CART_KEY)` and `getReservation(INGREDIENT_CART_KEY)` return non-empty arrays

When `_isDualCart` is false, the checkout renders a single cart (whichever key the `?cart=` param or tab indicates).

### 1.4 Checkout URL Logic

`getCheckoutUrl` (`11-cart.js:632`):
- Both carts non-empty → `/reservation.html` (no param — triggers dual-cart mode)
- Active tab is kits → `/reservation.html?cart=ferment`
- Active tab is ingredients → `/reservation.html?cart=ingredient`

### 1.5 Operational Business Rules Enforced by Cart Separation

The split is not just cosmetic. These rules require item_type discrimination, not cart key discrimination:

| Rule | Current Enforcement | Cart-agnostic? |
|------|---------------------|----------------|
| Promo discount applies to kit items only | `_promoApplied && item_type !== 'ingredient' && !== 'service'` | Yes — already item_type based |
| Maker's Fee applies to kit items only | `item_type === 'kit'` count in charge calc | Yes — already item_type based |
| Milling fee applies to grain ingredients only | `item.millable` flag on ingredient items | Yes — item property |
| Timeslot booking required for ferment items | Ferment order POSTs to `/api/bookings` before `/api/checkout`; ingredient order skips booking | No — currently cart-key based in `submitDualCart` |
| Separate Zoho SOs for operational traceability | Two sequential `/api/checkout` calls with different `cart_key` values | No — cart-key based at server |

---

## 2. Code Impact Matrix

### 2.1 `js/lib/constants.js` (50 lines)

| Function/Symbol | Lines | Dual-cart use | Merge impact |
|-----------------|-------|---------------|--------------|
| `CART_KEYS.FERMENT` | 12 | One of two active keys | Retain as `CART_KEYS.UNIFIED = 'sv-cart'`; keep FERMENT/INGREDIENTS for migration read |
| `CART_KEYS.INGREDIENTS` | 13 | One of two active keys | Keep read-only for migration; remove as write target |
| `CART_KEYS.LEGACY_RESERVATION` | 14 | Already migration-only | Keep as-is |

**Estimated lines affected:** 5 (add `UNIFIED` key, add comment)
**Disposition:** Simplified — add new key, deprecate old write targets

---

### 2.2 `js/modules/11-cart.js` (1243 lines)

| Function | Lines | Dual-cart logic | Merge impact |
|----------|-------|-----------------|--------------|
| `migrateReservationData` | 16–34 | Splits legacy `sv-reservation` into 2 keys | Extend: also fold `sv-cart-ferment` + `sv-cart-ingredients` into new `sv-cart` key; retain read of old keys |
| `getCartKeyForTab` | 36–39 | Returns key based on `_activeCartTab` | Delete — concept of tab-to-cart routing disappears |
| `getCartKey` | 41–46 | Routes by item_type to FERMENT or INGREDIENTS key | Simplify: always return single `UNIFIED_CART_KEY` |
| `getReservation` | 48–55 | Reads from specified key | Simplify: single key, `cartKey` param becomes no-op or removed |
| `saveReservation` | 57–67 | Writes to specified key | Simplify: single key write |
| `getReservedQty` | 69–80 | Searches both keys when no cartKey given | Simplify: search single array |
| `getAllCartItems` | 82–86 | Concat of both keys | Simplify: return single key array |
| `setReservationQty` | 103–168 | Calls `getCartKey()` to route | Simplify: no routing needed |
| `getCheckoutUrl` | 632–639 | Returns URL without `?cart=` when both carts non-empty | Simplify: always `/reservation.html` |
| `initReservationBar` | 641–683 | Clear button clears both keys | Simplify: clear single key |
| `renderCartSidebar` | 741–912 | Unified view already; type badges when mixed | Minor — type badges still appropriate by item_type |
| `renderCartDrawer` | 920–1120 | Unified view already; type badges when mixed | Minor — same |
| `initCartDrawer` | 1150–1203 | Clear button clears both keys (lines 1162, 1176) | Simplify: clear single key |
| `hasMinQtyIngredients` | 1207–1213 | Reads from `INGREDIENT_CART_KEY` only | Update: filter single cart by item_type |

**Estimated lines affected:** ~150 lines deleted/simplified across these functions
**Estimated lines net change:** -120 lines (deletion of dual-key logic)

**Special case — `setReservationQty` line 161:**
```javascript
if (typeof _isDualCart !== 'undefined' && _isDualCart && typeof renderCheckoutIngredientSection === 'function') {
  renderCheckoutIngredientSection();
}
```
This cross-module call into `12-checkout.js` will be removed entirely — the ingredient section disappears with cart merge.

---

### 2.3 `js/modules/12-checkout.js` (2066 lines) — PRIMARY COMPLEXITY

This file carries the overwhelming majority of dual-cart complexity.

#### Module-level state (lines 36)
| Symbol | Line | Purpose | Merge impact |
|--------|------|---------|--------------|
| `var _isDualCart = false` | 36 | Flag set in `initReservationPage` | Delete; checkout is always "unified" |

#### Functions to delete entirely
| Function | Lines (approx) | Description |
|----------|---------------|-------------|
| `renderDualCartBanner` | 1070–1080 | Renders "2 separate orders" banner | Delete |
| `renderCheckoutIngredientSection` | 1081–1409 | Entire Section B for ingredient items (~330 lines) | Delete — items merge into Section A |
| `submitDualCart` | 1411–1520 | Dual sequential API calls with booking + ingredient | Delete |
| `showDualCartConfirmation` | 1522–1615 | Confirmation screen for dual-cart results | Delete; merge into single confirmation |
| `updateDualCartTotalSummary` | 1626–1684 | Combined total row near submit button | Delete |

**Estimate: ~560 lines deleted**

#### Functions with dual-cart branches to simplify
| Function | Lines | Dual-cart logic | What changes |
|----------|-------|-----------------|-------------|
| `getActiveCheckoutCart` | 106–112 | Returns `FERMENT_CART_KEY` or `INGREDIENT_CART_KEY` from `?cart=` param | Simplify or remove — `?cart=` concept disappears |
| `initReservationPage` | 114–280 | Lines 126–131: dual-cart detection; lines 253–276: timeslot note + dual-cart banner | Remove detection block; always single path |
| `renderReservationItems` | 475–958 | Lines 485–490: shows FERMENT items only when dual-cart; lines 508–510: ingredient-cart fallback logic; lines 821–824: milling section conditional; lines 933–945: clear button text/handler differs | Simplify: always show all items; remove branch at 485–490, 508–510 |
| `updateMillingTotals` | 1060–1069 | Line 1061: `if (_isDualCart)` guard | Remove guard |
| `applyPromoCode` | 350–400 | Line 390: `if (_isDualCart) renderCheckoutIngredientSection()` | Remove this line |
| `renderPromoWidget` | 401–474 | Line 426: `if (_isDualCart) renderCheckoutIngredientSection()` | Remove this line |
| `setupReservationForm` (submit handler) | 1733–1860 | Lines 1748–1858: entire dual-cart submit branch (`if (_isDualCart)`) | Delete ~110-line branch |

**Estimate: ~220 lines simplified/deleted in these functions**

#### Total 12-checkout.js impact: ~780 lines removed or rewritten (38% of file)

---

### 2.4 `js/modules/07-catalog-kits.js`

| Function | Line | Dual-cart logic | Merge impact |
|----------|------|-----------------|-------------|
| `renderKitBuyControl` (unnamed) | 1418–1419 | `getReservedQty(productKey, INGREDIENT_CART_KEY)` — scopes qty lookup to ingredient cart | Change to `getReservedQty(productKey)` after item_type-scoped lookup is added |

**Estimated lines affected:** 3
**Disposition:** Minor update — after merge, `kit-purchase` items still need qty lookup scoped by type to avoid cross-contamination with `kit` reservations for the same product

---

### 2.5 `js/modules/13-init.js`

| Location | Lines | Dual-cart logic | Merge impact |
|----------|-------|-----------------|-------------|
| Stale cart warning | 227–228 | Reads from both keys for 14-day check | Replace with `getAllCartItems()` |
| Kiosk cart badge | 400 | Reads both keys | Replace with `getAllCartItems()` |
| `migrateReservationData()` call | 220 | Triggers dual-cart migration | Extend migration to fold dual keys into unified key |

**Estimated lines affected:** 5
**Disposition:** Simplified

---

### 2.6 `zoho-middleware/routes/checkout.js` (857 lines)

| Location | Lines | Dual-cart logic | Merge impact |
|----------|-------|-----------------|-------------|
| Replay guard | 181–192 | `txnKeySuffix = body.cart_key ? ':' + body.cart_key : ''` — adds cart_key to replay key to allow two orders through | Simplify: single order = no suffix needed |
| Catalog lookup | 300–302 | Loads ingredients cache to validate ingredient items in dual-cart | Keep: ingredient items will still be in unified cart |
| Promo enforcement | 320–350 | Already item_type based; no cart_key reference | No change needed |
| Maker's Fee injection | 380–400 | Already item_type based | No change needed |
| Error handler — dual-cart void guard | 630–668 | Checks if other cart_key's transaction already used; skips void if so; logs `checkout.void_skipped_dual_cart` | Delete ~40-line guard block |
| `txnMark` | 584–586 | Marks txn with cart_key suffix | Simplify: no suffix |
| Success response | 591 | Includes `cartKey` in response body | Remove `cartKey` field |

**Estimated lines affected:** ~55 lines deleted/simplified
**Critical question: Single SO or two SOs?**

With a single cart, the server currently receives one call with all items. This is the standard single-cart path. Two Zoho SOs would require the server to split items by type and call Zoho twice — adding server-side complexity in exchange for operational separation.

**Recommendation:** Keep single Zoho SO for merged cart. Staff already distinguish kit items from ingredients via `item_type` in the SO line items. If operational separation is needed post-launch, it can be added as a separate server-side feature.

---

## 3. Behavioral Changes

### 3.1 User-Facing Changes

| Behavior | Before | After |
|----------|--------|-------|
| Checkout URL from product page | `/reservation.html` (both) or `/reservation.html?cart=ferment` | Always `/reservation.html` |
| Checkout form layout | Section A (ferment) + Section B (ingredients) with dual banner | Single unified item list |
| Combined total display | Separate subtotals + "Combined Total" row | Single total |
| Timeslot selection | Required when ferment items present | Required when any `item_type === 'kit'` present (unchanged behavior, different trigger) |
| Cart clear on checkout | Clears only succeeded cart in partial failure | N/A — single SO, no partial failure scenario |
| Confirmation screen | Shows two order numbers (ferment + ingredient) | Shows one order number |
| Milling option | Appears in Section B (ingredient section) | Appears in main item list for grain items |
| Cart sidebar/drawer | Already unified — no visible change | No change |

### 3.2 Business Rule Preservation

All business rules can be preserved using item_type checks instead of cart key checks:

- **Promo discount:** Already `item_type !== 'ingredient' && !== 'service'` — no change needed
- **Maker's Fee:** Already `item_type === 'kit'` count — no change needed
- **Milling:** Already `item.millable` flag on item — no change needed
- **Timeslot:** Change trigger from `FERMENT_CART_KEY has items` to `items.some(item_type === 'kit')` — simple

### 3.3 Operational Impact on Staff

- Staff see one Zoho SO per customer visit (instead of two)
- Line items in the SO will contain both kit and ingredient lines, distinguished by item_type
- If separate Zoho SOs are operationally required (e.g., separate picking workflow for ingredients), this is a soft blocker — needs staff input before proceeding

---

## 4. Migration Strategy

### 4.1 localStorage Key Migration

Existing users may have items in either or both old keys at the time of deployment.

**Proposed migration function (`migrateToUnifiedCart`):**
```javascript
function migrateToUnifiedCart() {
  var newKey = 'sv-cart';
  try {
    var existing = JSON.parse(localStorage.getItem(newKey)) || [];
    if (existing.length > 0) return; // already migrated
    var ferment = JSON.parse(localStorage.getItem(FERMENT_CART_KEY)) || [];
    var ingredients = JSON.parse(localStorage.getItem(INGREDIENT_CART_KEY)) || [];
    var merged = ferment.concat(ingredients);
    if (merged.length > 0) {
      localStorage.setItem(newKey, JSON.stringify(merged));
    }
    // Keep old keys until confirmed read successfully — remove after migration verified
    localStorage.removeItem(FERMENT_CART_KEY);
    localStorage.removeItem(INGREDIENT_CART_KEY);
  } catch (e) {}
}
```

**Conflict handling:** The same physical product cannot exist in both carts in the current system (cart routing is deterministic: same product always routes to same key). Edge case: a product whose `item_type` was changed server-side between adds — unlikely in practice since product data is fetched fresh each page load.

**Timing:** Run in `DOMContentLoaded` after `migrateReservationData()`, before any cart reads. This replaces the dual-key migration with a single-key migration.

### 4.2 URL Param Cleanup

`?cart=ferment` and `?cart=ingredient` URL params used in checkout links and the reservation bar must be removed. Any bookmarked or emailed checkout URLs with these params will redirect to the unified checkout (gracefully — the URL param will simply be ignored).

### 4.3 Backward Compatibility Window

Run both old keys (read-only) and new unified key (write) for at least one release cycle. The migration function in step 4.1 handles this: it reads old keys and consolidates into new key on first load, then removes old keys.

---

## 5. Server-Side Impact

### 5.1 Zoho SO Creation

**Current:** Two sequential `/api/checkout` POSTs with different `cart_key` values. The first POST creates a ferment SO, the second creates an ingredient SO.

**After merge:** One `/api/checkout` POST with all items (mixed item_types).

**Impact:**
- Server already handles mixed-type carts via the single-cart path (lines 1864–2040 in 12-checkout.js)
- Ingredient items already validated via ingredients cache (lines 300–302 in routes/checkout.js)
- Single SO with mixed line items is already how single-cart checkout works

**Unknown:** Whether operations staff have a workflow dependency on separate Zoho SOs for kit bookings vs ingredient orders. **This is the primary human validation requirement before commit.**

### 5.2 Replay Guard Simplification

Current replay guard (`routes/checkout.js:181–192`):
```javascript
var txnKeySuffix = body.cart_key ? ':' + body.cart_key : '';
var txnKey = 'helcim:txn:' + transactionId + txnKeySuffix;
```

This was added specifically to allow two orders (ferment + ingredient) to share one Helcim transaction. After merge, this simplifies to:
```javascript
var txnKey = 'helcim:txn:' + transactionId;
```

### 5.3 Dual-Cart Void Guard Removal

The most complex server-side dual-cart code is the void guard (`routes/checkout.js:629–668`). This 40-line block handles the partial-failure scenario where ferment SO succeeded but ingredient SO failed: it detects whether the other cart_key was already used for this transactionId, and skips the void to avoid reversing the successful order.

After merge, this entire block is deleted. The partial failure scenario does not exist with a single order.

### 5.4 Helcim Payment Flow

No change needed. Helcim already receives a single payment for the combined total. The calculation path (`_dualCharge` in dual-cart mode and `charge` in single-cart mode) will unify into the single-cart calculation, which already handles all item_types correctly.

### 5.5 Booking API

Timeslot booking (`/api/bookings` POST before `/api/checkout`) must still be called when the cart contains kit items. The trigger currently is `submitDualCart` calling `/api/bookings` before the ferment order. After merge, the single-cart submit flow must add this conditional booking step:

```javascript
var hasKits = items.some(function(i) { return (i.item_type || 'kit') === 'kit'; });
var bookingProm = (hasKits && slot && slot !== 'Walk-in')
  ? fetch('/api/bookings', ...) : Promise.resolve({ booking_id: null });
```

The single-cart path currently calls `/api/bookings` unconditionally when a timeslot is selected (line 1935). The merge must preserve this — timeslot selection only appears when kit items are present.

---

## 6. Risk Assessment

### 6.1 Breaking Changes

| Risk | Severity | Mitigation |
|------|----------|------------|
| Staff workflow requires separate Zoho SOs | High | Validate with staff before Phase C |
| Existing cart data lost during migration | Medium | Migration function consolidates both keys; test with production data snapshot |
| `?cart=ferment` / `?cart=ingredient` bookmark links break | Low | These are internal links; no external bookmarks expected |
| Timeslot booking skipped for kit items after merge | High | Include booking conditional in single-cart submit; regression test required |
| Partial-failure scenario leaves payment without order | Medium | Removed with void guard simplification; single order = atomic |
| `kit-purchase` items (take-home kits) qty cross-contamination | Medium | Must update `getReservedQty` call in `07-catalog-kits.js` to use item_type-scoped lookup |

### 6.2 Test Coverage Gaps

**Frontend tests with no dual-cart coverage:**
- `submitDualCart` — NOT tested (0 tests in any file)
- `showDualCartConfirmation` — NOT tested
- `renderCheckoutIngredientSection` — tested only via `checkout-promo-totals.test.js` (the combined-total display, not the full rendering)
- `updateDualCartTotalSummary` — NOT tested directly
- Timeslot booking path in dual-cart mode — NOT tested
- Partial-failure scenario (`ingredientFailed: true`) — NOT tested

**Middleware tests with no dual-cart coverage:**
- Dual-cart replay guard (`txnKeySuffix` with `cart_key`) — NOT tested (confirmed: 0 matches in `checkout.test.js`)
- Dual-cart void guard (lines 630–668) — NOT tested
- Two sequential `/api/checkout` calls with same `transactionId` — NOT tested
- `checkout.void_skipped_dual_cart` event log — NOT tested

**Implication for merge:** The untested code will be deleted, not migrated. The post-merge single-cart path has existing coverage. No new tests needed for deleted code, but regression tests for the timeslot booking conditional are required.

### 6.3 Rollback Strategy

The migration function uses a new `sv-cart` key and removes old keys after successful read. Rollback path:
1. Revert code deployment (restore dual-cart routing)
2. The old `sv-cart-ferment` and `sv-cart-ingredients` keys will be missing for already-migrated users
3. **Impact:** Users who had items in cart before rollback lose their cart state

Mitigation: Preserve a backup key (`sv-cart-backup-ferment` / `sv-cart-backup-ingredients`) during migration, removed only after one full release cycle.

### 6.4 Soft Blockers

**Operations validation (human action required):**
> Are two separate Zoho SOs per transaction a hard operational requirement? Specifically:
> - Does the picking/fulfillment workflow separate ferment kits from ingredient orders?
> - Do staff reconcile by SO number, and do dual orders create confusion or are they expected?
>
> If separate SOs are required: the server-side refactor becomes a soft fork — keep two `/api/checkout` calls but route to single frontend cart (Phase C becomes a partial simplification, not full unification).

---

## 7. Recommended Implementation Phases

### Overview

The refactor is delivered in 4 sub-plans across a new phase (suggested: Phase 09). Each is sized for a single agent context budget (~2,000 lines of code changes max per plan).

---

### Phase A: Cart Module Refactor (11-cart.js + constants.js)

**Goal:** Replace dual-key storage with unified `sv-cart` key. Migrate legacy data. Simplify all cart utility functions.

**Files:**
- `js/lib/constants.js` — add `CART_KEYS.UNIFIED = 'sv-cart'`
- `js/modules/11-cart.js` — rewrite `getCartKey`, `getReservation`, `saveReservation`, `getAllCartItems`, `getReservedQty`, `migrateReservationData`, `getCheckoutUrl`, clear handlers
- `js/modules/13-init.js` — update stale-cart check and kiosk badge
- `tests/frontend/cart.test.js` — update / add migration tests

**Context cost:** Medium (11-cart.js is 1,243 lines; changes affect ~200 lines)
**Prerequisite:** Staff validation on Zoho SO separation (Section 6.4)
**Produces:** Single-cart storage system. Sidebar/drawer and reservation bar work correctly. All existing cart tests pass.
**Does not touch:** 12-checkout.js (checkout UX still uses old dual-cart flow, but storage layer is now unified)

**Key decision in this phase:** Does `getCartKeyForTab` become a no-op that always returns `UNIFIED_CART_KEY`, or is it deleted? Recommend delete + grepping for all callers.

---

### Phase B: Checkout Flow Simplification (12-checkout.js)

**Goal:** Remove `_isDualCart` flag, delete dual-cart functions, simplify `initReservationPage` and `setupReservationForm` submit handler.

**Files:**
- `js/modules/12-checkout.js` — delete `_isDualCart`, `renderDualCartBanner`, `renderCheckoutIngredientSection`, `submitDualCart`, `showDualCartConfirmation`, `updateDualCartTotalSummary`; simplify `initReservationPage`, `renderReservationItems`, `setupReservationForm` submit handler
- `tests/frontend/checkout-promo-totals.test.js` — remove `_setDualCartForTest` usage and dual-cart test suite
- `tests/frontend/checkout-completion.test.js` — update if needed

**Context cost:** High (12-checkout.js is 2,066 lines; ~780 lines affected)
**Prerequisite:** Phase A complete and deployed to staging
**Produces:** Single checkout flow. Ingredient section gone. Combined total replaced by single total. Booking conditional added for kit items.

**Pitfall:** The milling section (`renderMillingSection`) currently renders inside `renderCheckoutIngredientSection` in dual-cart mode. After deletion of the ingredient section, `renderMillingSection` must be called from `renderReservationItems` unconditionally for ingredient items with `millable` flag.

---

### Phase C: Server-Side Unification (zoho-middleware/routes/checkout.js)

**Goal:** Remove dual-cart replay suffix and void guard. Simplify `txnKey` construction. Remove `cart_key` from response body.

**Files:**
- `zoho-middleware/routes/checkout.js` — simplify replay guard (lines 181–192), delete void guard (lines 629–668), clean up `txnMark` (line 584), remove `cartKey` from response (line 591)
- `zoho-middleware/__tests__/checkout.test.js` — add regression tests for single-order payment-then-SO path; verify void fires correctly without the skip guard

**Context cost:** Low-Medium (857 lines; ~60 lines changed)
**Prerequisite:** Phase B complete. Staff validation confirmed (Section 6.4).
**Produces:** Clean single-order server-side path. Replay guard is simple. Void fires correctly for single orders.

**If staff validation fails (separate SOs required):** Phase C becomes: split items by item_type server-side and call Zoho twice internally, while still accepting a single `/api/checkout` call from frontend. The void guard would need to be adapted (not deleted) to handle partial Zoho failure. This is a more complex outcome — delay Phase C until validation is complete.

---

### Phase D: Test Updates and Cleanup

**Goal:** Remove dual-cart test helpers, update cart test coverage for unified storage, add integration tests for merged checkout flow.

**Files:**
- `tests/frontend/cart.test.js` — add migration-to-unified tests
- `tests/frontend/checkout-promo-totals.test.js` — remove dual-cart suite, update single-cart assertions
- `tests/frontend/checkout-completion.test.js` — verify timeslot booking fires when kit items present
- `zoho-middleware/__tests__/checkout.test.js` — add: (a) single cart with mixed item_types, (b) booking skipped when no kit items
- Remove from `module.exports` in `12-checkout.js`: `_setDualCartForTest` (line 2063), `_setPromoAppliedForTest` remains (still needed)

**Context cost:** Low (test-only changes, ~150 lines)
**Prerequisite:** Phases A, B, C complete

---

### Summary Table

| Phase | Plan | Files | Lines Changed | Prereq | Context Budget |
|-------|------|-------|--------------|--------|----------------|
| A | Cart storage | constants.js, 11-cart.js, 13-init.js | ~220 | Staff validation | Medium |
| B | Checkout UX | 12-checkout.js, 2 test files | ~800 | Phase A | High |
| C | Server-side | routes/checkout.js, checkout.test.js | ~70 | Phase B + staff validation | Low |
| D | Test cleanup | 4 test files | ~150 | Phases A–C | Low |

**Total estimated reduction:** ~900 lines of production code deleted across all phases.

---

## Appendix: Grep Commands for Verification

Run these before beginning Phase A to confirm no additional callers were added since this assessment:

```bash
# All FERMENT_CART_KEY write references (should only be in 11-cart.js after Phase A)
grep -rn "FERMENT_CART_KEY\|sv-cart-ferment" js/modules/ js/lib/

# All INGREDIENT_CART_KEY write references
grep -rn "INGREDIENT_CART_KEY\|sv-cart-ingredients" js/modules/ js/lib/

# All _isDualCart references
grep -rn "_isDualCart" js/modules/

# All cart_key references in middleware
grep -rn "cart_key" zoho-middleware/routes/

# All submitDualCart callers
grep -rn "submitDualCart\|renderCheckoutIngredientSection\|showDualCartConfirmation\|updateDualCartTotalSummary" js/modules/
```
