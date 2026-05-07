---
status: resolved
trigger: "Ingredient-only checkout stuck on 'Waiting for payment...' after Helcim iframe accepts payment. Card charged but no Zoho invoice created. postMessage callback never advanced the page."
created: 2026-05-07T15:15:00Z
updated: 2026-05-07T15:45:00Z
---

## Current Focus

hypothesis: postMessage eventName uses secretToken from Helcim API, but frontend matched against checkoutToken
test: verified Helcim SDK watchForExit uses .includes('helcim-pay-js'), and Helcim API returns both checkoutToken and secretToken
expecting: matching against secretToken fixes the stuck payment flow
next_action: deploy to staging and test

## Symptoms

expected: After completing payment in Helcim iframe, page should advance to success page and create a Zoho Sales Order/Invoice
actual: Page stuck on "Waiting for payment..." button text. No Zoho invoice created. Card was charged by Helcim.
errors: "405 Preflight on exec endpoint, cross-origin frame errors from browser extensions (fido2-content-script.js, bootstrap-autofill-overlay.js). Blocked frame access between secure.helcim.app and staging.steinsandvines.ca."
reproduction: Go to staging.steinsandvines.ca, add ingredient items to cart, go to checkout (reservation.html?cart=ingredient), fill form, submit, complete Helcim payment in iframe
started: Discovered 2026-05-07 during UAT testing. Ingredient-only checkout path.

## Eliminated

- Browser extension errors: noise from fido2-content-script.js and bootstrap-autofill-overlay.js (not our code)
- reCAPTCHA 405 error: getRecaptchaToken always calls its callback (empty string on failure), never blocks flow
- CSP blocking postMessage: postMessage is exempt from same-origin restrictions; CSP frame-src correctly allows secure.helcim.app
- Service worker caching: sw.js is a self-unregister script, not caching anything
- bfcache pageshow handler: only fires when page is restored from bfcache (user navigates away and back), not during iframe interaction
- _checkoutSubmitting guard: properly cleared in postMessage SUCCESS handler before re-dispatch
- _paymentChargeInFlight guard: already fixed in commit f5bae5a to bypass when _helcimTransactionId is set
- Payment section not found: payment-section element exists in reservation.html, listener is set up

## Evidence

- timestamp: 2026-05-07T15:15:00Z source: code_review detail: "postMessage handler at line 1810 checks data.eventName against 'helcim-pay-js-' + _helcimCheckoutToken. Helcim API returns both checkoutToken (for iframe URL) and secretToken (for postMessage eventName). Middleware only returned checkoutToken, discarding secretToken."
- timestamp: 2026-05-07T15:20:00Z source: helcim_sdk detail: "Helcim SDK start.js TOKEN_LENGTH=22, watchForExit checks event.data.eventName.includes('helcim-pay-js') - confirms eventName prefix format but uses includes() not exact match"
- timestamp: 2026-05-07T15:25:00Z source: git_history detail: "Commit 42a35a7 (Mar 13) introduced 'helcim-pay-js-{checkoutToken}' format. Commit dc9d50e (Apr 8) moved listener outside .then() callback to use dynamic _helcimCheckoutToken. Neither commit verified which token Helcim uses in eventName."
- timestamp: 2026-05-07T15:30:00Z source: helcim_api detail: "zoho-middleware/lib/helcim.js initializeCheckout() only returned { checkoutToken: data.checkoutToken }, discarding data.secretToken from Helcim API response"

## Resolution

root_cause: Helcim's postMessage eventName uses secretToken (not checkoutToken) from the /v2/helcim-pay/initialize API response. The middleware discarded secretToken and only passed checkoutToken to the frontend. The frontend's postMessage handler matched against checkoutToken, which never matched the eventName from Helcim's iframe, causing the handler to silently return without processing the payment success.
fix: Three-layer fix - (1) zoho-middleware/lib/helcim.js now returns secretToken alongside checkoutToken, (2) zoho-middleware/routes/payments.js passes secretToken to frontend, (3) js/modules/12-checkout.js stores secretToken and uses it for postMessage eventName matching with checkoutToken fallback. Also added JSON.parse fallback for event.data in case Helcim sends stringified JSON.
verification: All 341 frontend tests pass, all 460 middleware tests pass, lint clean (0 errors). Needs staging deployment and manual checkout test.
files_changed:
  - zoho-middleware/lib/helcim.js
  - zoho-middleware/routes/payments.js
  - js/modules/12-checkout.js
  - js/main.js (build artifact)
  - tests/frontend/checkout-postmessage.test.js
