# Phase 10: Checkout Payment Safety - Context

**Gathered:** 2026-05-05
**Status:** Ready for planning
**Source:** Production incident audit (customer charged without confirmation, multiple payment prompts)

<domain>
## Phase Boundary

Fix critical production bug where customers get charged multiple times by Helcim with no confirmation shown to either party. Root cause is stale frontend payment state not being cleared on error paths, allowing the Helcim iframe to re-open and charge again. Secondary issue: fire-and-forget confirmation emails can silently fail.

**What this phase delivers:**
- Bulletproof payment state machine in 12-checkout.js (both single-cart and dual-cart paths)
- Client-side idempotency key generation to prevent server-side duplicate orders
- Fallback email confirmation when Zoho email fails
- Proper error UX that prevents user from accidentally re-triggering payment

**What this phase does NOT touch:**
- No changes to Helcim SDK integration itself (start.js)
- No changes to kiosk POS checkout (separate flow in kiosk.js)
- No changes to the booking/timeslot system
- No changes to promo code logic

</domain>

<decisions>
## Implementation Decisions

### D-01: Clear ALL Helcim state on every error path
- On single-cart catch (line 2034): clear both `_helcimTransactionId = null` AND `_helcimCheckoutToken = null`
- On dual-cart onError callback (line 1812): clear both `_helcimTransactionId = null` AND `_helcimCheckoutToken = null`
- On ABORTED postMessage (line 1720): clear `_helcimCheckoutToken = null` (already clears txnId)
- On payment initialize .catch() (lines 1913, 1845): clear `_helcimCheckoutToken = null`

### D-02: Add payment cooldown lock after charge
- After Helcim SUCCESS postMessage fires (line 1711), set a `_paymentChargeInFlight = true` flag
- The submit handler must check this flag BEFORE the `!_helcimTransactionId` check at lines 1825/1895
- If `_paymentChargeInFlight` is true, show "Payment processing — please wait..." toast and return
- Flag is cleared only when: (a) checkout succeeds and confirmation shows, (b) void confirmed, (c) 30-second safety timeout fires

### D-03: Generate client-side idempotency key
- Generate a unique key (crypto.randomUUID or fallback to timestamp+random) when the form submit starts
- Store in `_checkoutIdempotencyKey` variable
- Send as `idempotency_key` in the `/api/checkout` POST body
- Key persists across the payment iframe cycle (set on first submit, reused on re-entry after postMessage)
- New key generated on each fresh submit (when `_helcimTransactionId` is null at entry)
- Server already supports `idempotency_key` (line 111 in checkout.js) — just not being sent from frontend

### D-04: Fallback confirmation email via SMTP
- In processCheckout (checkout.js), after the Zoho email fire-and-forget at line 559, add a `.catch()` that triggers a fallback
- The fallback calls `mailer.sendCustomerConfirmation({ email, orderNumber, items, timeslot })` — a new mailer function
- This sends a plain-text confirmation via the existing SMTP transport (no Zoho dependency)
- Only fires when the Zoho email `.catch()` is triggered (not on every order)

### D-05: Make staff notification non-silent
- The staff notification email at line 519 currently has a `.catch()` that only logs
- If staff email fails, fire a warning event via eventLog so it's visible in monitoring
- Do NOT block the response on email — keep fire-and-forget but make failures visible

### D-06: Frontend success page must show before emails
- The current flow already shows the confirmation page immediately on `oR.ok` (line 1966)
- This is correct — do NOT make the frontend wait for email delivery
- The confirmation page is the customer's primary receipt; emails are secondary

### Claude's Discretion
- Exact implementation of the 30-second safety timeout (setTimeout vs setInterval)
- Whether to add a visual "refund processing" spinner or just disable the button
- Error message wording for the cooldown state
- Whether to use crypto.randomUUID() with a Math.random() fallback or just Date.now() + Math.random()
- Test file organization (new file vs extending existing)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Frontend checkout
- `js/modules/12-checkout.js` — Main checkout module with payment flow (lines 1690-2043 are the critical section)
- `js/modules/12a-checkout-validation.js` — Form validation helpers

### Middleware checkout
- `zoho-middleware/routes/checkout.js` — Server-side checkout with void logic, idempotency, email sending
- `zoho-middleware/routes/payments.js` — Payment initialize/void/refund endpoints
- `zoho-middleware/lib/helcim.js` — Helcim API wrapper (initializeCheckout, voidTransaction)
- `zoho-middleware/lib/mailer.js` — Email transport (needs new sendCustomerConfirmation function)
- `zoho-middleware/lib/eventLog.js` — Event logging

### Tests
- `tests/frontend/` — Frontend Jest tests (jsdom)
- `zoho-middleware/__tests__/` — Middleware Jest tests

</canonical_refs>

<specifics>
## Specific Ideas

### Bug 1 location: `_helcimCheckoutToken` never cleared
- Set at line 1842 (dual-cart) and 1910 (single-cart)
- Never reset to null anywhere except initial declaration
- The postMessage listener at line 1710 uses it to match events — stale value causes cross-iframe leakage

### Bug 2 location: Dual-cart onError doesn't clear txnId
- Lines 1812-1815: `_checkoutSubmitting = false` + button re-enable + toast
- Missing: `_helcimTransactionId = null; _helcimCheckoutToken = null;`
- Result: on retry, line 1825 check passes (stale txnId is truthy), skips iframe, sends stale txnId to server

### Bug 3 location: Fire-and-forget Zoho email
- Line 559-568: `zohoPost('/salesorders/' + soId + '/email', {...}).catch(...)` — catch only logs
- If Zoho email API is down, customer gets no email, store gets no notification
- Staff email at line 519-527 has same silent-failure pattern

### Idempotency already partially implemented server-side
- Line 111: `var idempotencyKey = ... body.idempotency_key ...`
- Line 121-133: Redis cache check + proceed logic
- Frontend just never sends the key — easy win

</specifics>

<deferred>
## Deferred Ideas

- Server-side void confirmation webhook (would allow frontend to wait for confirmed void rather than timeout)
- Retry queue for failed confirmation emails (beyond scope — single retry is sufficient)
- Real-time payment status websocket (overkill for this volume)
- Helcim webhook for online checkout completion (they only support terminal webhooks currently)

</deferred>

---

*Phase: 10-checkout-payment-safety*
*Context gathered: 2026-05-05 via production incident audit*
