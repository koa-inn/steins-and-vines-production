---
phase: 10-checkout-payment-safety
reviewed: 2026-05-05T18:22:00Z
depth: standard
files_reviewed: 5
files_reviewed_list:
  - js/modules/12-checkout.js
  - zoho-middleware/lib/mailer.js
  - zoho-middleware/routes/checkout.js
  - tests/frontend/checkout-payment-safety.test.js
  - zoho-middleware/__tests__/checkout-fallback-email.test.js
findings:
  critical: 2
  warning: 4
  info: 2
  total: 8
status: issues_found
---

# Phase 10: Code Review Report

**Reviewed:** 2026-05-05T18:22:00Z
**Depth:** standard
**Files Reviewed:** 5
**Status:** issues_found

## Summary

Phase 10 adds: (1) a client-side payment state machine with a 30-second cooldown lock to prevent duplicate Helcim charges, (2) SMTP fallback email via `sendCustomerConfirmation` when Zoho email API fails, and (3) `eventLog` entries for staff/customer email failures. The implementation is structurally sound and covers the main failure paths. However, there are two critical issues related to payment safety race conditions and missing SMTP credential validation that could lead to silent data loss, plus several warnings around error handling and test coverage gaps.

## Critical Issues

### CR-01: Race condition between cooldown expiry and checkout submission allows duplicate charges

**File:** `js/modules/12-checkout.js:1735-1760`
**Issue:** The payment state machine sets `_paymentChargeInFlight = true` when Helcim reports SUCCESS (line 1735), then starts a 30-second cooldown timer that resets it to `false` (line 1736). The form submit handler checks this flag (line 1760) to block re-submission. However, if the checkout POST to `/api/checkout` takes longer than 30 seconds (e.g., Zoho is slow), the cooldown expires and `_paymentChargeInFlight` resets to `false`. At that point, the user can click "Submit" again, triggering a second `/api/checkout` POST with the same `_helcimTransactionId`. While the server-side idempotency key provides protection, the idempotency key is only generated once per submit cycle (line 1775: `_checkoutIdempotencyKey = generateIdempotencyKey()`) and only when `_helcimTransactionId` is falsy. On the re-entry path after payment (line 1740-1741), the form re-dispatches `submit` without generating a new key. If the cooldown expires mid-flight and the user clicks submit again, the same idempotency key is reused -- which is correct behavior for replay protection. However, the `_checkoutSubmitting` flag (line 1759) is the actual mutex, and it is reset to `false` on line 1740 (`_checkoutSubmitting = false; // allow re-entry on payment completion`) before the form re-dispatch on line 1741. This creates a window where a rapid double-click during the event loop tick between lines 1740 and 1741 could bypass the guard.

**Fix:** Do not reset `_checkoutSubmitting` before re-dispatching. Instead, keep it true and let the successful completion path (line 2008 `clearPaymentCooldown()`) or error path (line 2081) reset both flags. The postMessage handler should proceed directly to submission without toggling `_checkoutSubmitting`:
```javascript
// Line 1739-1741: Replace with:
if (_awaitingPaymentSubmit) {
  _awaitingPaymentSubmit = false;
  // Do NOT reset _checkoutSubmitting here -- it remains locked
  f.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
}
```

### CR-02: SMTP fallback sends email with undefined `from` field when SMTP_USER is unset

**File:** `zoho-middleware/lib/mailer.js:185`
**Issue:** `sendCustomerConfirmation` (and all other mailer functions) use `process.env.SMTP_USER` as the `from` field (line 185). The SMTP_* environment variables are classified as OPTIONAL in `validateEnv.js` (line 20-23), so the server boots successfully without them. When Zoho email API fails and the SMTP fallback fires, if `SMTP_USER` is not set, nodemailer will attempt to send with `from: undefined`. This will either throw an error (if the SMTP server rejects it) or -- worse -- silently fail depending on the transport configuration. The customer receives no confirmation email and the only signal is an error log line buried in `[checkout] Fallback SMTP email also failed`. Since this is a fallback for an already-failed primary path, two silent failures mean guaranteed data loss for the customer.

**Fix:** Add a guard at the top of `sendCustomerConfirmation` (and ideally all mailer functions) that fails fast with a clear error when SMTP is not configured:
```javascript
function sendCustomerConfirmation(data) {
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
    return Promise.reject(new Error('SMTP not configured — cannot send fallback email'));
  }
  var to = data.email;
  // ...rest of function
}
```

## Warnings

### WR-01: Cooldown timer silently expires without logging, masking slow-checkout scenarios

**File:** `js/modules/12-checkout.js:1629-1635`
**Issue:** `clearPaymentCooldown()` resets state silently. When the 30-second timer fires (line 1736), there is no indication to the user or developer that the cooldown has expired while a checkout was still in-flight. In production, if `/api/checkout` responses take >30s (Zoho rate limits, network issues), the cooldown expires invisibly. This makes debugging duplicate-submission reports very difficult because there is no trace of the state transition.

**Fix:** Add a flag or console warning when the timer expires while a checkout is still pending:
```javascript
function clearPaymentCooldown() {
  if (_checkoutSubmitting && _paymentChargeInFlight) {
    // Timer expired while checkout was still in-flight -- potential re-submit risk
    if (typeof console !== 'undefined') console.warn('[checkout] Payment cooldown expired while submission in-flight');
  }
  _paymentChargeInFlight = false;
  if (_paymentCooldownTimer) {
    clearTimeout(_paymentCooldownTimer);
    _paymentCooldownTimer = null;
  }
}
```

### WR-02: `generateIdempotencyKey` fallback uses weak randomness

**File:** `js/modules/12-checkout.js:1622-1627`
**Issue:** The fallback path `Date.now().toString(36) + '-' + Math.random().toString(36).substr(2, 9)` (line 1626) is used when `crypto.randomUUID` is unavailable. `Math.random()` is not cryptographically secure and on some browsers/environments the entropy is low. While this is an idempotency key (not a security token), a collision would cause a legitimate retry to receive a stale cached response from a different checkout attempt. Given this is a payment path, even low-probability collisions are unacceptable.

**Fix:** Use `crypto.getRandomValues` as a middle-tier fallback before `Math.random`:
```javascript
function generateIdempotencyKey() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    var arr = new Uint8Array(16);
    crypto.getRandomValues(arr);
    return Array.from(arr, function(b) { return b.toString(16).padStart(2, '0'); }).join('');
  }
  return Date.now().toString(36) + '-' + Math.random().toString(36).substr(2, 9);
}
```

### WR-03: Checkout route does not call `checkTransactionIdAndProceed` -- replay guard is bypassed

**File:** `zoho-middleware/routes/checkout.js:183-200`
**Issue:** The function `checkTransactionIdAndProceed()` (line 183) performs a Redis check to detect replay of a transaction_id. However, it is only called from `chargeAndProceed()` (line 866), and `chargeAndProceed()` only calls it after pre-validation passes. If `body.payment_token` is empty (line 770), it falls through directly to `checkTransactionIdAndProceed()`. But the issue is that if a caller provides `body.transaction_id` directly (without `payment_token`), the flow goes: `chargeAndProceed()` -> line 770 checks `body.payment_token` is falsy -> calls `checkTransactionIdAndProceed()` which reads `transactionId` from the outer closure (line 174: `var transactionId = body.transaction_id || ''`). This path is correct. However, there is no length/format validation on `body.transaction_id` beyond line 75 (max 64 chars, string type). An attacker could submit a valid `transaction_id` from a legitimate prior checkout (obtained by observing the client) along with a new `idempotency_key` to create a new order without paying. The Redis replay guard (line 188-199) only blocks if the exact `txnKey` (including `cart_key` suffix) was previously stored. If the original order used `cart_key: 'sv-cart-ferment'` but the attacker uses no `cart_key` or a different suffix, the replay guard key will differ and the check will pass.

**Fix:** Normalize the transaction replay key to ignore `cart_key` for the initial uniqueness check, and only use the cart_key suffix for the dual-cart exception:
```javascript
// Check global txn usage first (without cart_key)
var globalTxnKey = 'helcim:txn:' + transactionId;
var existing = await cache.get(globalTxnKey);
if (existing) {
  // Already used -- only allow through if this is a known dual-cart second leg
  if (!body.cart_key || !txnKeySuffix) {
    log.warn('[checkout] Replay detected: ' + transactionId);
    return res.status(409).json({ error: 'Payment already processed' });
  }
  // For dual-cart, check the specific cart_key variant
  var specificUsed = await cache.get(txnKey);
  if (specificUsed) {
    return res.status(409).json({ error: 'Payment already processed' });
  }
}
```

### WR-04: Staff email failure eventLog entry includes `orderNumber` which may correlate to PII

**File:** `zoho-middleware/routes/checkout.js:527-530`
**Issue:** The `eventLog.logEvent('checkout.staff_email_failed', { orderNumber: soNumber })` call passes the Zoho sales order number. While `soNumber` is not PII itself (it is a system identifier like "SO-001234"), the eventLog module's ZERO PII POLICY header states the data object "MUST NEVER contain" data that can identify a person. A sales order number is a direct key to retrieve customer name/email/phone from Zoho. This is borderline -- it depends on the project's PII policy interpretation -- but it mirrors the pattern already used elsewhere (`checkout.completed` includes `txnId`). If the policy is strict, this should be removed.

**Fix:** If strict PII interpretation is desired, hash or omit the order number:
```javascript
eventLog.logEvent('checkout.staff_email_failed', {
  errorMsg: (mailErr.message || '').substring(0, 100)
});
```

## Info

### IN-01: Test coverage for payment state machine is minimal

**File:** `tests/frontend/checkout-payment-safety.test.js`
**Issue:** The test file has only 4 simple tests that verify `generateIdempotencyKey` returns strings and `clearPaymentCooldown` resets one flag. There are no tests for the critical race condition scenarios: (1) cooldown expiry during in-flight checkout, (2) double form submission between `_checkoutSubmitting = false` and `dispatchEvent`, (3) the interaction between `_paymentChargeInFlight` guard and `_checkoutSubmitting` guard. Given this is a payment safety feature, more thorough unit tests would improve confidence.

**Fix:** Add tests that simulate the race condition timing:
- Set `_checkoutSubmitting = true` and `_paymentChargeInFlight = true`, call `clearPaymentCooldown`, verify `_checkoutSubmitting` remains `true`
- Verify that `generateIdempotencyKey` is not re-called on form re-dispatch after payment

### IN-02: Checkout fallback email test does not verify the actual fallback wiring in checkout.js

**File:** `zoho-middleware/__tests__/checkout-fallback-email.test.js`
**Issue:** The test file title mentions "fallback email + eventLog wiring in checkout.js" but only tests the `mailer.sendCustomerConfirmation` function in isolation. The actual fallback flow in `checkout.js` lines 571-585 (Zoho email fails -> call `mailer.sendCustomerConfirmation` -> if that fails too -> log `eventLog`) is not exercised. This means the integration between the checkout route and the mailer fallback path is untested.

**Fix:** Add an integration-level test that mocks `zohoPost` to fail on the email endpoint, verifies `mailer.sendCustomerConfirmation` is called, then mocks it to also fail and verifies `eventLog.logEvent` is called with `'checkout.customer_email_failed'`.

---

_Reviewed: 2026-05-05T18:22:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
