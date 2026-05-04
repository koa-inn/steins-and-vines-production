---
phase: 08-first-batch-promo
reviewed: 2026-05-04T00:00:00Z
depth: standard
files_reviewed: 11
files_reviewed_list:
  - content/home.json
  - css/styles.css
  - js/modules/12-checkout.js
  - js/modules/13-init.js
  - tests/frontend/checkout-form-persistence.test.js
  - tests/frontend/checkout-promo-totals.test.js
  - zoho-middleware/__tests__/promo.test.js
  - zoho-middleware/lib/constants.js
  - zoho-middleware/routes/checkout.js
  - zoho-middleware/routes/promo.js
  - zoho-middleware/server.js
findings:
  critical: 2
  warning: 4
  info: 3
  total: 9
status: issues_found
---

# Phase 08: Code Review Report

**Reviewed:** 2026-05-04
**Depth:** standard
**Files Reviewed:** 11
**Status:** issues_found

## Summary

Phase 8 delivered: the FIRSTBATCH promo code system (server-side validate + burn-on-checkout), a dual-cart combined totals fix for promo rendering, checkout form localStorage persistence, and CSS for the promo banner and code widget.

The promo architecture is generally sound — server-re-validates at checkout, burns redemption after SO creation, locks against concurrent double-burn. However, the distributed lock in `checkout.js` is acquired but its result is never checked, so it provides zero concurrency protection. Additionally, the beer-waitlist form silently submits to placeholder URLs in production code. Both are BLOCKER-level issues. Four warnings and three info items follow.

---

## Critical Issues

### CR-01: Distributed promo lock acquired but result never used — double-burn not actually prevented

**File:** `zoho-middleware/routes/checkout.js:325-348`

**Issue:** The entire premise of the distributed lock is broken. `cache.acquireLock(promoKey, 30)` is called and its result stored in `lockAcquired`, but `lockAcquired` is never checked in any conditional. Whether the lock is acquired or not, the code falls through identically to the Redis `get` check and potential discount application. Two simultaneous checkout requests for the same email will both see `promoExisting = null` (before either burns it) and both receive `promoDiscount = 20`. The lock also is never explicitly released — it expires only after its 30-second TTL, creating a 30-second window where a *third* concurrent checkout for the same email would be blocked but the first two already slipped through.

**Fix:** Either actually gate on the result, or remove the lock and document the small concurrent-request race explicitly as accepted risk:

```javascript
// Option A: Gate on the result (block non-lock-holder from applying discount)
var lockAcquired = false;
try {
  lockAcquired = await cache.acquireLock(promoKey, 30);
} catch (lockErr) {
  lockAcquired = true; // fail open
  log.warn('[checkout] Promo lock acquisition failed, proceeding: ' + lockErr.message);
}

if (!lockAcquired) {
  // Another request is mid-flight for this email — reject with a retry message
  return res.status(409).json({ error: 'Your promo code is being processed. Please try submitting again in a moment.' });
}

// Now do the Redis check and burn, then release lock regardless of outcome
try {
  var promoExisting = await cache.get(promoKey);
  if (!promoExisting) {
    promoDiscount = 20;
  } else {
    log.warn('[checkout] Promo code FIRSTBATCH rejected — already redeemed by ' + customerEmail);
  }
} catch (promoCheckErr) {
  promoDiscount = 20;
  log.warn('[checkout] Promo Redis check failed, allowing discount: ' + promoCheckErr.message);
} finally {
  cache.releaseLock(promoKey).catch(function () {});
}
```

---

### CR-02: Beer-waitlist form submits to placeholder Google Form URL — silently fails in production

**File:** `js/modules/12-checkout.js:1620-1621`

**Issue:** `setupBeerWaitlistForm()` constructs a hidden `<form>` and submits it to `https://docs.google.com/forms/d/e/YOUR_BEER_WAITLIST_FORM_ID/formResponse` with `entry.YOUR_EMAIL_ENTRY_ID` as the field name. Both are literal placeholder strings. On the homepage, any visitor who submits their email via the beer waitlist form will see the success state (`beer-waitlist-confirm` shown, form hidden) but their email is silently dropped — it goes to a non-existent Google Form.

**Fix:** Replace the placeholders with the real Google Form ID and entry field ID, or if the form is not yet ready, disable the submit handler and show a "coming soon" message instead of a fake success:

```javascript
// If the form is not yet configured, don't show a false success
var WAITLIST_FORM_ID = 'YOUR_BEER_WAITLIST_FORM_ID'; // TODO: replace before shipping
if (WAITLIST_FORM_ID.indexOf('YOUR_') === 0) {
  // Show "coming soon" without fake success
  f.addEventListener('submit', function (e) {
    e.preventDefault();
    showToast('Beer waitlist coming soon — check back shortly!', 'info');
  });
  return;
}
```

---

## Warnings

### WR-01: Promo lock key is the redemption key itself — lock and data share the same Redis key

**File:** `zoho-middleware/routes/checkout.js:322, 327`

**Issue:** `promoKey` is `C.CACHE_KEYS.PROMO_REDEEMED_PREFIX + email` (e.g. `promo:firstbatch:redeemed:user@example.com`). `cache.acquireLock(promoKey, 30)` internally does `SET lock:promo:firstbatch:redeemed:user@example.com ... NX`. This is a different Redis key (prefixed with `lock:`), so there is no collision with the data key. However, if (once CR-01 is fixed) `releaseLock(promoKey)` is called, it deletes `lock:promo:firstbatch:redeemed:user@example.com` — not the redemption record. This is correct. But `cache.get(promoKey)` reads the *same key as the lock's base*, and the lock uses a distinct `lock:` prefix key. The naming is correct but non-obvious; a comment clarifying that the lock key differs from the data key would prevent future confusion.

**Fix:** Add a comment or use a separate named lock key for clarity:

```javascript
var promoLockKey = 'promo:lock:' + customerEmail.toLowerCase(); // distinct from redemption key
var lockAcquired = await cache.acquireLock(promoLockKey, 30);
```

---

### WR-02: `renderPromoWidget` hardcodes chip label — diverges from server response if discount changes

**File:** `js/modules/12-checkout.js:418`

**Issue:** The applied-promo chip always displays `"FIRSTBATCH — 20% off kits"` regardless of what `discountPct` was returned by the server. `_promoApplied` holds the server-returned `discountPct`, but it is not used in the chip label. If the promo is ever adjusted server-side to a different percentage, the displayed label will be wrong (e.g., chip says 20% but the actual discount at checkout is 15%).

**Fix:** Use the stored `_promoApplied` values:

```javascript
'<span class="promo-code-chip-label">' +
  escapeHTML(_promoApplied.code) + ' — ' +
  _promoApplied.discountPct + '% off kits' +
'</span>'
```

---

### WR-03: Kiosk attract screen only clears legacy `RESERVATION_KEY` — dual-cart data survives idle reset

**File:** `js/modules/13-init.js:430`

**Issue:** `showAttractScreen()` calls `localStorage.removeItem(RESERVATION_KEY)`. `RESERVATION_KEY` is the legacy pre-dual-cart key (`sv-reservation`). After the dual-cart migration, the active cart storage keys are `sv-cart-ferment` and `sv-cart-ingredients` (via `FERMENT_CART_KEY` and `INGREDIENT_CART_KEY` constants). An idle kiosk will appear to reset (attract screen activates) but the customer's cart items survive in the dual-cart keys. The next customer can tap to start, see the previous customer's cart items, and check them out.

**Fix:**

```javascript
function showAttractScreen() {
  // Clear ALL cart data — legacy key and both dual-cart keys
  localStorage.removeItem(RESERVATION_KEY);
  try { localStorage.removeItem(FERMENT_CART_KEY); } catch(e) {}
  try { localStorage.removeItem(INGREDIENT_CART_KEY); } catch(e) {}
  attract.classList.add('active');
}
```

---

### WR-04: `var noPayNotice` declared twice in `showDualCartConfirmation` — var hoisting creates confusing dead-code

**File:** `js/modules/12-checkout.js:1581, 1593`

**Issue:** The variable `noPayNotice` is declared with `var` twice in `showDualCartConfirmation` — once inside the `if (results.ingredientFailed)` branch (line 1581) and again inside the `else` branch (line 1593). ES5's `var` hoisting means both declarations merge into one, but this pattern is a lint error (no-redeclare), looks like a bug, and will fail if the project ever lints with strict duplicate-var checks.

**Fix:** Declare once above both branches:

```javascript
var noPayNotice = document.querySelector('.confirm-no-payment-notice');
if (results.ingredientFailed) {
  if (noPayNotice) { ... }
  // ...
} else {
  if (noPayNotice) { ... }
}
```

---

## Info

### IN-01: `content/home.json` promo news items are dated January 2026 — visibly stale to visitors

**File:** `content/home.json:29, 34`

**Issue:** Both "promo-news" entries carry dates "Jan 15, 2026" and "Jan 10, 2026". As of May 2026 these are four months old. Depending on where these are rendered, visitors may see "Grand Opening Special" as current news. This is a content issue, not a code bug, but it will undermine trust if a customer reads dates.

**Fix:** Update the dates and copy, or if the news section is intentionally archival, add a `"archived": true` flag and filter it in the renderer.

---

### IN-02: `promo.js` `/api/promo/validate` fails open on Redis error — any Redis outage allows code reuse

**File:** `zoho-middleware/routes/promo.js:43-46`

**Issue:** The validate endpoint is explicitly fail-open (comment says "Redis unavailable should not block legitimate customers"). This is a documented design decision. However, it is worth recording that a Redis outage lasting more than a browser session would allow any email/code combination to validate repeatedly, with the redemption burn (in `checkout.js`) also failing open. The net effect is that the promo discount becomes uncapped during a Redis outage. Given the 20% discount on a ~$280 kit = ~$56 exposure per order, this is an accepted business risk — flagged for visibility, not necessarily for fixing.

**Fix (optional):** Consider adding a circuit-breaker counter so that after N consecutive Redis failures in a rolling window, the endpoint switches to fail-closed. Or document the accepted risk in SECURITY.md.

---

### IN-03: `promo.js` `seed-kiosk` uses plain `.then()` style while adjacent routes use `async/await`

**File:** `zoho-middleware/routes/promo.js:76-112`

**Issue:** The `validate` and `delete` handlers use `async/await`, but `seed-kiosk` uses the older Promise `.then()` chain. This is not a bug — both patterns are correct — but the inconsistency across the same file will confuse future maintainers and may cause linting issues if the project enforces `prefer-async-await`.

**Fix:** Refactor `seed-kiosk` to match the pattern used in the rest of the file:

```javascript
router.post('/api/promo/seed-kiosk', async function (req, res) {
  try {
    var data = await cache.get(C.CACHE_KEYS.KIOSK_DISCOUNT_PRESETS);
    var presets = Array.isArray(data) ? data : [];
    // ... rest of logic with await
  } catch (err) {
    log.error('[promo/seed-kiosk] Failed to seed kiosk preset: ' + err.message);
    return res.status(500).json({ error: 'Failed to seed kiosk preset' });
  }
});
```

---

_Reviewed: 2026-05-04_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
