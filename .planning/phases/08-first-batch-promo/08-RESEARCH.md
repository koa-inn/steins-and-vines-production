# Phase 8: First-Batch Promo - Research

**Researched:** 2026-05-03
**Domain:** Promo code validation, Redis redemption tracking, checkout discount integration, homepage banner
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** Full-width hero banner on the homepage — bold strip positioned above or below the hero section for maximum visibility.
- **D-02:** Banner is dismissible with localStorage memory — once dismissed, it doesn't reappear for that visitor.
- **D-03:** Banner content is JSON-driven via `content/home.json` — a `promo-banner` object with text, code, and `enabled` flag. Toggle the promo on/off by editing the JSON and pushing. No expiry date — disable via JSON toggle.
- **D-04:** Promo code field appears in the online checkout flow. Placement is Claude's discretion (standard e-commerce positioning).
- **D-05:** Validation happens on "Apply" button click — a new middleware endpoint validates code AND checks email eligibility in one call. Email field must be filled before applying.
- **D-06:** Applied code is removable — a small "x" or "Remove" link lets the user clear the discount and restore original pricing before payment.
- **D-07:** Kiosk integration — connect FIRSTBATCH to the existing kiosk discount presets system so staff can apply it there too. Same server-side redemption enforcement applies.
- **D-08:** Email is required at code validation time (Apply click). The validate endpoint checks both code validity and whether the email has already redeemed.
- **D-09:** Redemption is "burned" only on successful payment — if the customer abandons checkout, the code remains available.
- **D-10:** No expiry date — promo runs until disabled via JSON toggle in `content/home.json`.
- **D-11:** 20% off applies to all kit line items AND Maker's Fee in the cart. Not limited to one kit — all kits get the discount.
- **D-12:** Ingredients/supplies in the dual-cart are NOT discounted. The promo is about the "first batch" ferment-in-store experience only.

### Claude's Discretion

- Banner placement on products page (in addition to homepage) — pick based on conversion funnel logic
- Exact positioning of promo code field in checkout layout
- How to integrate FIRSTBATCH into kiosk discount presets (auto-appear as a preset vs. separate code input)
- Admin tooling for viewing/resetting redemptions — minimum viable approach (simple endpoint or Redis CLI)
- Redis key structure for redemption tracking
- Error message copy for already-redeemed and invalid code states
- Whether to show the discount breakdown per-line-item or as a single summary line

### Deferred Ideas (OUT OF SCOPE)

None — discussion stayed within phase scope.
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| PROMO-01 | Homepage displays a prominent banner advertising 20% off first batch with promo code FIRSTBATCH | Banner rendered from `content/home.json` `promo-banner` object; new element in `index.html` above or below `.hero` section; dismissible via `localStorage`; `js/modules/13-init.js` content loader can drive the toggle |
| PROMO-02 | Checkout flow accepts a promo code input field and applies 20% discount to kit line items when valid | `js/modules/12-checkout.js` already has per-item `discount` field pipeline (badge rendering, price math); promo field lives in Step 1 (Review Items) before payment; `_promoApplied` module-level state tracks active code; discount propagated via `item.discount` on ferment lines; Maker's Fee also receives 20% discount |
| PROMO-03 | Middleware validates promo code and enforces one redemption per email address via Redis | New `POST /api/promo/validate` endpoint; Redis key `promo:firstbatch:redeemed:<email>` with TTL = 0 (permanent); redemption burned in `processCheckout` after successful Zoho SO creation; `buildLineItems` already accepts `item.discount` and passes it as `discountPct` to `computeLineItem` |
</phase_requirements>

---

## Summary

Phase 8 adds a promotional offer — 20% off the first batch — to the Steins & Vines website. The implementation spans three independently-deployable areas: (1) a dismissible homepage banner driven by `content/home.json`, (2) a promo code input widget in the checkout flow that talks to a new `/api/promo/validate` endpoint, and (3) server-side discount enforcement with Redis-backed one-use-per-email tracking.

The codebase already contains all the primitives needed. The per-item `discount` field already flows through the entire checkout pipeline — client-side badge rendering, price display, and server-side `computeLineItem(product, qty, { discountPct: N })`. The content loader in `13-init.js` already fetches JSON and injects into DOM elements. The Redis cache module (`lib/cache.js`) provides get/set/del primitives used throughout the app. The kiosk discount presets system (`routes/discounts.js`) stores preset configurations in Redis with full CRUD — FIRSTBATCH can be seeded as a preset.

The primary new work is: a new route file `zoho-middleware/routes/promo.js`, a new `POST /api/promo/validate` endpoint, modifications to `processCheckout` in `routes/checkout.js` to burn redemptions, modifications to `12-checkout.js` to add the promo UI widget, and modifications to `content/home.json` + `index.html` for the banner.

**Primary recommendation:** Build the promo route first (pure server logic with no UI dependency), then add the checkout widget, then add the homepage banner last (purely additive).

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Banner display (homepage) | Browser / Client | Frontend Server (static) | Static HTML + JSON fetch; no auth needed; localStorage for dismiss state |
| Promo code validation | API / Backend | — | Email-keyed Redis lookup; server must be authoritative to prevent bypass |
| Discount application (server) | API / Backend | — | C3 constraint: server never trusts client-supplied discount; must pass through `buildLineItems` |
| Redemption burn | API / Backend | — | Must fire after successful Zoho SO creation, not before charge |
| Kiosk discount preset seeding | API / Backend | — | Writes to Redis via existing discounts CRUD pattern |
| Client-side discount state | Browser / Client | — | `_promoApplied` state in `12-checkout.js`; affects payment amount calculation |

---

## Standard Stack

### Core (all already in project)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Redis (via `lib/cache.js`) | — | Redemption tracking | Already used for all server-side state; `cache.get` / `cache.set` are the established pattern |
| Express.js | — | New `/api/promo/validate` route | All middleware routes use Express Router |
| `zoho-middleware/lib/pricing.js` | — | Server-side discount math | `computeLineItem(product, qty, { discountPct: 20 })` — already handles discounts authoritatively |
| `zoho-middleware/lib/constants.js` | — | Redis key constants | New `PROMO_REDEEMED_PREFIX` added here following established pattern |

### No New Dependencies Required

All required libraries are already in the project. No npm installs needed for this phase.

---

## Architecture Patterns

### System Architecture Diagram

```
Browser (index.html)
  └── fetch content/home.json
        └── promo-banner.enabled? → render banner strip (dismissible via localStorage)

Browser (reservation.html, Step 1)
  └── promo code input + email + "Apply" button
        └── POST /api/promo/validate { code, email }
              ├── Invalid code → 400 { error: "Invalid promo code" }
              ├── Already redeemed → 400 { error: "This code has already been used" }
              └── Valid → 200 { ok: true, discountPct: 20 }
                    └── Client sets _promoApplied = { code, discountPct: 20 }
                          └── Re-renders cart with discount badges + updated totals
                                └── payment/initialize called with discounted amount

Browser (form submit)
  └── Ferment items include item.discount = 20 for each kit
        └── POST /api/checkout { items: [..., discount: 20], promo_code: "FIRSTBATCH" }
              └── chargeAndProceed() → runCheckout()
                    └── buildLineItems: computeLineItem({ rate }, qty, { discountPct: 20 })
                          └── Zoho SO created
                                └── Burn redemption: cache.set(PROMO_REDEEMED_PREFIX + email, timestamp, 0)
```

### Recommended Project Structure

```
zoho-middleware/
├── routes/
│   └── promo.js              # NEW: POST /api/promo/validate
├── lib/
│   └── constants.js          # MODIFIED: add PROMO_REDEEMED_PREFIX
├── __tests__/
│   └── promo.test.js         # NEW: unit tests for validate endpoint
js/modules/
├── 12-checkout.js            # MODIFIED: promo widget + _promoApplied state
├── 13-init.js                # MODIFIED: banner rendering on page=home
content/
└── home.json                 # MODIFIED: add promo-banner object
index.html                    # MODIFIED: add #promo-banner element
css/styles.css                # MODIFIED: .promo-banner styles
```

### Pattern 1: Redis Redemption Key

**What:** Email-keyed permanent Redis entry records that a specific email has burned the code.

**When to use:** On successful Zoho SO creation in `processCheckout`, AFTER the sales order is confirmed.

**Key structure:**
```javascript
// Source: derived from established CONTACT_PREFIX pattern in zoho-middleware/lib/constants.js
var PROMO_REDEEMED_PREFIX = 'promo:firstbatch:redeemed:';

// Write on burn (TTL = 0 → no expiry; use a large TTL like 5 years = 157,680,000 seconds)
var key = PROMO_REDEEMED_PREFIX + email.trim().toLowerCase();
cache.set(key, { redeemedAt: new Date().toISOString() }, 5 * 365 * 24 * 60 * 60);

// Check on validate
var existing = await cache.get(key);
if (existing) { return res.status(400).json({ error: 'This offer has already been redeemed with this email.' }); }
```

**Note:** TTL = 0 is not valid for Redis SET EX. Use a large TTL (5 years in seconds = 157,680,000). [VERIFIED: lib/cache.js `set` uses `EX: ttlSeconds`]

### Pattern 2: Client-Side Promo State

**What:** Module-level variable in `12-checkout.js` tracks the applied promo code.

**When to use:** After the user clicks "Apply" and the server responds with `{ ok: true, discountPct: 20 }`.

```javascript
// Source: [VERIFIED: 12-checkout.js module-level var pattern, e.g. _makersFeeItem, _isDualCart]
var _promoApplied = null; // { code: 'FIRSTBATCH', discountPct: 20 } or null

// On Apply success:
_promoApplied = { code: code.toUpperCase().trim(), discountPct: data.discountPct };
// Apply discount to ferment items in-memory (not to localStorage — cart items stay at full price)
// Re-render cart table → discount badges appear, prices show strikethrough + sale

// On Remove:
_promoApplied = null;
// Re-render cart table → badges removed, original prices restored
```

**Key insight:** Do NOT write `discount` back to `localStorage`/cart items. Apply discount only at render and submission time from `_promoApplied` state. This prevents stale discounts persisting after the user leaves and returns.

### Pattern 3: Discount Transmission to Server

**What:** Ferment line items include `discount` field when promo is applied; server validates it against the promo code.

**When to use:** At form submit time in the single-cart and dual-cart `buildLines` helpers.

```javascript
// Source: [VERIFIED: 12-checkout.js lines 1204-1213 — buildLines function]
// Existing buildLines:
function buildLines(items) {
  return items.map(function (i) {
    return {
      name: i.name,
      quantity: i.qty || 1,
      rate: parseFloat(String(i.price || '0').replace(/[^0-9.]/g, '')) || 0,
      item_id: i.zoho_item_id,
      discount: i.discount  // already present
    };
  });
}

// With promo applied — override discount for kit items:
// discount: _promoApplied && (item.item_type || 'kit') === 'kit' ? _promoApplied.discountPct : (i.discount || 0)
```

**And pass promo_code in the checkout payload:**
```javascript
body: JSON.stringify({
  customer: contactData,
  items: lines,
  payment_token: ...,
  promo_code: _promoApplied ? _promoApplied.code : undefined,  // NEW
  ...
})
```

### Pattern 4: Maker's Fee Discount (D-11)

**What:** Maker's Fee is added as an additional line item in `runCheckout`. When FIRSTBATCH is applied, it must also receive 20% discount.

**When to use:** In `processCheckout`'s `runCheckout` function where `makersFeeItem` is appended to line items.

```javascript
// Source: [VERIFIED: zoho-middleware/routes/checkout.js — Maker's Fee added to lineItems]
// Existing line item build does NOT pass discountPct for Maker's Fee.
// When promo_code = 'FIRSTBATCH' is in body and is valid/redeemed:
var promoDiscount = (body.promo_code === 'FIRSTBATCH' && body.promo_code_valid) ? 20 : 0;

// For each kit item in buildLineItems: pass discountPct = promoDiscount
// For Maker's Fee item separately: also pass discountPct = promoDiscount
```

**Implementation note:** Server must re-validate the promo code's email eligibility even though `/api/promo/validate` was called earlier — the user could have theoretically submitted two concurrent checkout requests. The validate call at checkout time is the final guard.

### Pattern 5: Banner Rendering from content/home.json

**What:** `13-init.js` content loader already fetches `content/home.json` and injects into `[data-content]` elements. The banner requires slightly different logic (show/hide + localStorage check) so it should be handled in a separate block.

**When to use:** In the `page === 'home'` block in `13-init.js`'s `DOMContentLoaded`.

```javascript
// Source: [VERIFIED: 13-init.js lines 115-146 — content loader, lines 245-249 — home block]
// After content loader Promise.all resolves:
if (page === 'home' && data['promo-banner'] && data['promo-banner'].enabled) {
  var banner = data['promo-banner'];
  var dismissed = localStorage.getItem('sv-promo-banner-dismissed');
  if (!dismissed) {
    renderPromoBanner(banner); // NEW function
  }
}
```

**OR:** Call a standalone `initPromoBanner()` in the `page === 'home'` block after `loadFeaturedProducts()`. The banner fetch can be piggyback on the existing `content/home.json` fetch that the content loader already does, or done independently.

**Recommended:** Independent fetch in `initPromoBanner()` for clarity. The content loader replaces `[data-content]` elements only; the banner has different logic (dismiss state) and doesn't fit cleanly into `[data-content]` pattern.

### Pattern 6: Kiosk Discount Preset Seeding

**What:** FIRSTBATCH appears as a kiosk discount preset so staff can apply it via the kiosk UI. This uses the existing `POST /api/kiosk/discounts` endpoint.

**When to use:** Either seed it manually via the admin panel, or add a seeding step to the promo route that creates the preset on first use.

**Recommended approach (Claude's Discretion):** Add FIRSTBATCH as a kiosk discount preset via a one-time admin action (or document it as a manual setup step in the plan). The discount preset system stores arbitrary presets — staff would select the FIRSTBATCH preset from the kiosk UI, then the server validates redemption when the sale processes. The kiosk `POST /api/kiosk/sale` flow is separate from the online checkout and would need its own redemption burn path, which requires knowing the customer email. Since the kiosk collects customer name but not always email, this is the integration complexity — see Open Questions.

### Anti-Patterns to Avoid

- **Writing discount to localStorage cart items:** Once discount is stored in cart, it survives page reload and can be submitted without a valid code. Keep discount in `_promoApplied` module state only.
- **Burning redemption before Zoho SO is created:** If Zoho creation fails after burning, the customer loses their one-time code. Always burn AFTER the `salesorder_id` is returned.
- **Trusting `discount` from client without server re-validation:** `buildLineItems` already accepts `item.discount` and passes it to `computeLineItem`. This is acceptable only if the server also validates the promo code from `body.promo_code`. Without that check, any client can submit arbitrary discounts.
- **Applying promo discount to ingredient items:** PROMO-02 / D-12 explicitly exclude ingredients. The server should apply `discountPct` only to items not in the services/ingredients catalog.
- **Using TTL = 0 for Redis SET:** Redis `SET EX 0` is an error. Use a large TTL (5 years = 157,680,000 seconds). [VERIFIED: lib/cache.js uses `EX: ttlSeconds`]

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Redis key-value storage | Custom file/DB store | `lib/cache.js` `get`/`set`/`del` | Already wired to Redis with graceful degradation |
| Discount math | Custom percentage math | `pricing.computeLineItem({ rate }, qty, { discountPct: 20 })` | Handles float rounding, zero-rated edge cases, already tested (36 tests) |
| Email normalization | Custom trim/lowercase | `email.trim().toLowerCase()` (project pattern) | Consistent with `CONTACT_PREFIX` key pattern in constants.js |
| Kiosk discount CRUD | New endpoint | Existing `POST /api/kiosk/discounts` | Full CRUD already exists with validation and Redis persistence |

**Key insight:** The discount pipeline is fully built. The new work is exclusively the validation gate (promo code + email check) and the redemption burn — not the discount math itself.

---

## Runtime State Inventory

> This is a greenfield feature, not a rename/refactor. No runtime state migration required.

| Category | Items Found | Action Required |
|----------|-------------|-----------------|
| Stored data | None — no existing promo redemptions | None |
| Live service config | None — no existing promo code configured | Manual step: seed FIRSTBATCH kiosk discount preset after deploy |
| OS-registered state | None | None |
| Secrets/env vars | None — no new env vars required | None (promo code is hardcoded as "FIRSTBATCH") |
| Build artifacts | None | None |

---

## Common Pitfalls

### Pitfall 1: Race Condition — Double Redemption
**What goes wrong:** Two concurrent checkout requests for the same email both pass the Redis check simultaneously before either burns the redemption.
**Why it happens:** Redis `get` + `set` is not atomic; two requests can both see `null` and both proceed.
**How to avoid:** Use `cache.acquireLock` (already exists in `lib/cache.js`) around the validate-and-burn sequence inside `processCheckout`. Alternatively, use Redis `SET NX` (set if not exists) for the burn — treat a failed burn as "already redeemed" and void the transaction. The lock pattern is already used in the codebase.
**Warning signs:** Duplicate redemption records for the same email in Redis.

### Pitfall 2: Promo Applied But Payment Amount Not Recalculated
**What goes wrong:** The user applies the promo code, but the Helcim payment initialization was already called with the full amount. The customer pays full price even though the discount was applied.
**Why it happens:** `_helcimTransactionId` is set before the promo is applied, or `payment/initialize` is called before the promo widget renders the discounted total.
**How to avoid:** (1) The promo widget must be visible and usable BEFORE the payment section. (2) The "Apply" button must trigger `renderReservationItems()` to update displayed totals. (3) `payment/initialize` is called at form submit time (not on page load) — the amount is computed from `_promoApplied` state at submit time. This flow is safe if the promo widget is in Step 1 (Review Items) and payment init fires at Step 3 submit. [VERIFIED: checkout.js lines 1647-1671 — payment initialize fires at form submit]
**Warning signs:** Payment amount charged does not match displayed discounted total.

### Pitfall 3: Maker's Fee Not Discounted
**What goes wrong:** Kit items show 20% discount but Maker's Fee is still full price, contradicting D-11.
**Why it happens:** `buildLineItems` processes the items array. Maker's Fee is added separately in `runCheckout` after `buildLineItems` returns, so it doesn't receive the `discountPct` from the item-level loop.
**How to avoid:** When `promo_code === 'FIRSTBATCH'` and code is valid, pass `discountPct: 20` explicitly when building the Maker's Fee line item in `runCheckout`. [VERIFIED: routes/checkout.js — Maker's Fee appended separately from `buildLineItems`]
**Warning signs:** Cart total math shows full Maker's Fee on a discounted order.

### Pitfall 4: Banner Appears After localStorage Dismiss Is Cleared
**What goes wrong:** If the user clears their browser data, the banner reappears. Also: banner could appear on the kiosk if `IS_KIOSK` mode is detected.
**Why it happens:** localStorage dismiss key is cleared by browser data purge. Kiosk mode shares the same `index.html`.
**How to avoid:** Accept re-appearance after localStorage clear as expected behavior (D-02 says "localStorage memory"). For kiosk: check `IS_KIOSK` flag and skip banner entirely if true.
**Warning signs:** Staff report seeing the promo banner on the kiosk attract screen.

### Pitfall 5: Dual-Cart — Promo Applied to Both Carts
**What goes wrong:** When `_isDualCart = true`, the promo discount accidentally gets applied to the ingredient order items, violating D-12.
**Why it happens:** The `buildLines` helper in `submitDualCart` is called for both ferment and ingredient items. If the discount is applied unconditionally, ingredients get discounted too.
**How to avoid:** In `submitDualCart`, pass `_promoApplied` discounts only to ferment lines where `item_type === 'kit'`, not to `ingLines`. On the server side, apply `discountPct` only to items not in the ingredients catalog. [VERIFIED: 12-checkout.js buildLines at line 1204 — `discount: i.discount`; server uses `body.items[v].item_id` to look up in catalog]
**Warning signs:** Ingredient items show discount badges; ingredient SO in Zoho shows discounted rates.

### Pitfall 6: Checkout Request Missing `promo_code` Field
**What goes wrong:** Client sends discounted item rates but omits `promo_code` from the checkout body. Server receives `discount: 20` in items but cannot validate it was legitimately applied.
**Why it happens:** The single-cart submit path (lines 1690-1705) builds the checkout body inline. If `promo_code` is not explicitly added there, it silently goes missing.
**How to avoid:** Explicitly add `promo_code: _promoApplied ? _promoApplied.code : undefined` in both the single-cart submit body AND the dual-cart `submitDualCart` function. The server rejects `discount` values on items when no valid `promo_code` is present.
**Warning signs:** Server logs show `discount: 20` on items but `promo_code` is missing/undefined.

---

## Code Examples

### Promo Validate Endpoint (new route)

```javascript
// Source: [VERIFIED: routes/discounts.js — established pattern for new route files]
'use strict';

var express = require('express');
var cache = require('../lib/cache');
var log = require('../lib/logger');
var C = require('../lib/constants');

var PROMO_CODE = 'FIRSTBATCH';
var PROMO_DISCOUNT_PCT = 20;

var router = express.Router();

router.post('/api/promo/validate', async function (req, res) {
  var body = req.body || {};
  var code = (typeof body.code === 'string') ? body.code.trim().toUpperCase() : '';
  var email = (typeof body.email === 'string') ? body.email.trim().toLowerCase() : '';

  if (!code) return res.status(400).json({ error: 'Promo code is required' });
  if (!email || email.indexOf('@') === -1) return res.status(400).json({ error: 'Valid email is required' });
  if (code !== PROMO_CODE) return res.status(400).json({ error: 'Invalid promo code' });

  var key = C.CACHE_KEYS.PROMO_REDEEMED_PREFIX + email;
  try {
    var existing = await cache.get(key);
    if (existing) {
      return res.status(400).json({ error: 'This offer has already been used with this email address.' });
    }
    return res.json({ ok: true, discountPct: PROMO_DISCOUNT_PCT, code: PROMO_CODE });
  } catch (err) {
    log.error('[promo/validate] Redis error: ' + err.message);
    // Fail open — allow code to be applied if Redis is unavailable
    return res.json({ ok: true, discountPct: PROMO_DISCOUNT_PCT, code: PROMO_CODE });
  }
});

module.exports = router;
```

### Redemption Burn in processCheckout

```javascript
// Source: [VERIFIED: routes/checkout.js — runCheckout function, post SO creation]
// After: var soId = data.salesorder ? data.salesorder.salesorder_id : null;
if (soId && body.promo_code === 'FIRSTBATCH' && customerEmail) {
  var promoKey = C.CACHE_KEYS.PROMO_REDEEMED_PREFIX + customerEmail.toLowerCase();
  cache.set(promoKey, { redeemedAt: new Date().toISOString(), soId: soId }, 5 * 365 * 24 * 60 * 60)
    .catch(function (e) { log.error('[promo] Failed to burn redemption: ' + e.message); });
}
```

### Client-Side Promo Widget Sketch

```javascript
// Source: [ASSUMED] — placement in Step 1 (Review Items), after reservation-items div
// Module-level state:
var _promoApplied = null; // { code: 'FIRSTBATCH', discountPct: 20 }

function renderPromoWidget(container) {
  var wrap = document.createElement('div');
  wrap.className = 'promo-code-section';
  wrap.id = 'promo-code-section';

  if (_promoApplied) {
    // Applied state: show code + Remove link
    wrap.innerHTML = '<div class="promo-applied">'
      + '<span class="promo-applied-badge">FIRSTBATCH applied — 20% off your batch</span>'
      + '<button type="button" class="promo-remove-btn" id="promo-remove-btn">Remove</button>'
      + '</div>';
    wrap.querySelector('#promo-remove-btn').addEventListener('click', function () {
      _promoApplied = null;
      renderReservationItems();
    });
  } else {
    // Entry state: input + Apply button
    wrap.innerHTML = '<div class="promo-input-row">'
      + '<input type="text" id="promo-code-input" class="promo-code-input" placeholder="Promo code" autocomplete="off" maxlength="32">'
      + '<button type="button" class="btn-secondary promo-apply-btn" id="promo-apply-btn">Apply</button>'
      + '</div>'
      + '<div class="promo-code-error" id="promo-code-error"></div>';
    wrap.querySelector('#promo-apply-btn').addEventListener('click', applyPromoCode);
  }
  container.appendChild(wrap);
}

function applyPromoCode() {
  var code = (document.getElementById('promo-code-input').value || '').trim();
  var email = (document.getElementById('res-email') ? document.getElementById('res-email').value : '').trim();
  var errEl = document.getElementById('promo-code-error');
  if (!code) { if (errEl) errEl.textContent = 'Enter a promo code.'; return; }
  if (!email || email.indexOf('@') === -1) { if (errEl) errEl.textContent = 'Enter your email first.'; return; }
  if (errEl) errEl.textContent = '';

  var mw = (typeof SHEETS_CONFIG !== 'undefined') ? (SHEETS_CONFIG.MIDDLEWARE_URL || '') : '';
  fetch(mw + '/api/promo/validate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: code, email: email })
  }).then(function (r) { return r.json(); }).then(function (data) {
    if (data.ok) {
      _promoApplied = { code: data.code, discountPct: data.discountPct };
      renderReservationItems(); // re-render with discount badges
    } else {
      if (errEl) errEl.textContent = data.error || 'Invalid promo code.';
    }
  }).catch(function () {
    if (errEl) errEl.textContent = 'Could not verify code — check your connection and try again.';
  });
}
```

### content/home.json — New promo-banner Object

```json
{
  "promo-banner": {
    "enabled": true,
    "text": "New customers: <strong>20% off your first batch</strong> — use code <strong>FIRSTBATCH</strong> at checkout",
    "cta-text": "Reserve Your Kit",
    "cta-url": "products/ferment-in-store.html"
  }
}
```

### Homepage Banner HTML (index.html)

```html
<!-- Promo Banner — rendered by JS from content/home.json when promo-banner.enabled -->
<div id="promo-banner" class="promo-banner hidden" role="alert" aria-live="polite">
  <div class="container promo-banner-inner">
    <span class="promo-banner-text"></span>
    <button type="button" class="promo-banner-dismiss" aria-label="Dismiss offer">&times;</button>
  </div>
</div>
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Client-supplied discount trusted | Server re-computes from `discountPct` in `computeLineItem` | Established (pricing.js) | Discount must always pass through server; client display is estimate only |
| Single cart | Dual-cart (`sv-cart-ferment` + `sv-cart-ingredients`) | Feb 2026 | Promo applies to ferment cart only; ingredient cart explicitly excluded (D-12) |

---

## Open Questions

1. **Kiosk email collection for redemption enforcement**
   - What we know: Kiosk checkout (`POST /api/kiosk/sale`) requires customer name but email is optional — `simplifyKioskCheckout()` in `13-init.js` hides the email field on reservation.html in kiosk mode. The kiosk discount presets system stores discount configurations but doesn't currently validate promo codes against redemption records.
   - What's unclear: D-07 says "same server-side redemption enforcement applies" for kiosk. But without an email, the per-email enforcement cannot work. The kiosk sale also goes through `/api/kiosk/sale` (not `/api/checkout`), which is a completely separate route.
   - Recommendation: For the kiosk path, treat FIRSTBATCH as a staff-applied discount with no per-email enforcement (staff are trusted). Surface this clarification to the user if needed. The online checkout path has full enforcement. This is a "Claude's Discretion" area per CONTEXT.md.

2. **Admin redemption reset tooling**
   - What we know: The CONTEXT.md marks this as Claude's Discretion — "minimum viable approach (simple endpoint or Redis CLI)."
   - What's unclear: Whether a full admin UI endpoint or a documented Redis CLI command is sufficient.
   - Recommendation: Add a `DELETE /api/promo/redemption/:email` endpoint protected by `requireApiKey` middleware. This is minimal — one route, no UI needed, callable via curl or admin panel in the future. Include it in the plan.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | Middleware | yes | v20.17.0 | — |
| Redis | Redemption tracking | Not running locally (redis-cli unavailable) | — | Promo validate fails open (returns valid) if Redis unavailable — same pattern as other cache misses |

**Missing dependencies with fallback:**
- Redis is not running locally in this environment, but `lib/cache.js` already handles Redis unavailability gracefully (returns `null` on get, swallows set errors). The promo validate endpoint should follow the same fail-open pattern — if Redis is down, allow the code to be applied (matching the existing cart validation approach). This is an acceptable risk for a promotional feature.

---

## Project Constraints (from CLAUDE.md)

- **ES5 style throughout** — use `var`, not `const`/`let`. Function declarations, not arrow functions. This applies to all new code in `js/modules/`.
- **Never edit `js/main.js` or `js/main.min.js` directly** — edit source in `js/modules/`, then run `npm run build`.
- **Run `npm test` AND `cd zoho-middleware && npm test` before every commit** — never commit with failing tests.
- **Write regression test FIRST** for any bug fix before fixing it.
- **Run `npm run lint` before committing** — fix all ESLint errors.
- **Middleware has its own `node_modules`** — always `cd zoho-middleware` before running middleware commands.
- **Staging first** — deploy to `origin` (staging) before `production`. No direct production pushes.
- **After changing shared utilities** (`js/lib/*.js`, `zoho-middleware/lib/*.js`), run the FULL test suite for both frontend and middleware.
- **Export pattern for frontend modules**: append `if (typeof module !== 'undefined' && module.exports) { module.exports = {...}; }` at the bottom of any module needing test access.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Redemption burn should fire after Zoho SO creation, not before | Architecture Patterns / Pattern 1 | If SO creation succeeds but burn fails, customer can reuse code — but this is recoverable by admin reset. If burn fires before SO and SO fails, customer loses code permanently — worse outcome. Post-SO burn is safer. |
| A2 | Promo widget belongs in Step 1 (Review Items) before the payment section | Code Examples / Client-Side Promo Widget | If placed in Step 3, the payment amount has already been initialized and would need re-initialization after applying the code. Step 1 placement ensures the amount passed to `payment/initialize` at form submit already reflects the discount. |
| A3 | No new npm dependencies required | Standard Stack | If a future requirement needs atomic Redis operations (SETNX), this is already in `lib/cache.js` via `acquireLock`. No new packages needed. |
| A4 | Kiosk path uses staff-trusted enforcement (no per-email check) | Open Questions | If the client wants strict per-email enforcement on kiosk too, the kiosk checkout flow needs email collection added — a larger change than this phase's scope. |

---

## Sources

### Primary (HIGH confidence — verified by direct code inspection)

- `js/modules/12-checkout.js` — per-item discount pipeline (lines 407-455, 614-639, 1204-1213, 1640-1710), `_promoApplied` state pattern derived from `_makersFeeItem` pattern, payment init timing
- `zoho-middleware/routes/checkout.js` — `processCheckout`, `chargeAndProceed`, `buildLineItems` call, post-SO state updates
- `zoho-middleware/lib/checkout-helpers.js` — `buildLineItems` function (lines 132-151), `discount` field passthrough to `computeLineItem`
- `zoho-middleware/lib/pricing.js` — `computeLineItem` with `discountPct` option (lines 46-77)
- `zoho-middleware/routes/discounts.js` — kiosk discount preset CRUD, Redis storage pattern
- `zoho-middleware/lib/cache.js` — `get`/`set`/`del`/`acquireLock` API, TTL via `EX: ttlSeconds`
- `zoho-middleware/lib/constants.js` — existing Redis key patterns (`CONTACT_PREFIX`, `KIOSK_DISCOUNT_PRESETS`)
- `js/modules/13-init.js` — content loader pattern (lines 115-146), home page block (lines 245-249)
- `content/home.json` — existing `promo-news` and `promo-featured-skus` keys (establishes JSON schema convention)
- `reservation.html` — checkout stepper structure, Step 1 `#reservation-list`, Step 3 `#reservation-form-section`
- `index.html` — homepage structure, hero section, promo-section placement
- `.planning/config.json` — `nyquist_validation: false`, `security_enforcement: true`, `security_asvs_level: 1`

### Tertiary (LOW confidence — assumed from patterns)

- Exact HTML for promo-banner element in `index.html` — based on CSS pattern conventions in the project
- Promo widget CSS class names — `promo-code-section`, `promo-applied`, etc. — follow project naming conventions [ASSUMED]

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all stack elements are existing project code verified by inspection
- Architecture: HIGH — patterns derived directly from existing code; no new architectural decisions
- Pitfalls: HIGH — derived from direct inspection of the affected code paths (dual-cart, payment init, Maker's Fee)
- Kiosk integration: MEDIUM — depends on unanswered question about email collection in kiosk mode

**Research date:** 2026-05-03
**Valid until:** 2026-06-03 (30 days — stable codebase)
