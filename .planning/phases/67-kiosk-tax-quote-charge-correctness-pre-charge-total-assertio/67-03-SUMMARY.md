---
phase: 67-kiosk-tax-quote-charge-correctness
plan: 03
status: complete
completed: 2026-08-11
requirements: [KIOSK-TAX-QUOTE-01]
---

# Plan 67-03 Summary — Live verification (owner checkpoint)

## Outcome

Owner approved 2026-08-11 after the full stack went live.

**Deploy record (2026-08-04):**
- Staging push `dd5bce2b..3453a4a2`; production force-push `15be9486...3453a4a2`.
- Prod frontend confirmed live: `steinsandvines.ca/kiosk.html` serves `kiosk-core.min.js?v=msf5gxir` (matches local build).
- Railway middleware did NOT auto-deploy on push (contradicting docs/DEPLOYMENT.md); owner triggered a manual dashboard deploy — restart confirmed via `/health` uptime reset (25s). Post-deploy sanity: `GET /api/kiosk/products` returns 520 items, `750-champ-fl` at `tax_percentage: 12` ("GST + PST").
- Deploy-order safety held by design: the skew window (new frontend + old middleware) was safe because the old middleware ignores the new `client_grand_total`/`client_tax_total` fields and the new middleware asserts only when they are present.

**Verification performed (owner, 2026-08-11):**
- Display-level check on the live kiosk: compound-tax amounts display correctly ("the amounts look good").

**Verification NOT performed (recorded honestly):**
- No actual test invoice/charge was rung through — the literal end-to-end equality (kiosk-displayed total == Helcim charge == Zoho invoice on a completed sale) was not exercised.
- The divergent-total rejection path was not exercised live.

## Residual risk assessment

Low. Both sides carry regression suites (1046 frontend / 1340 middleware green at deploy), and the pre-charge assertion is now live: if a client/server total divergence ever recurs, the server rejects before charging ("Totals changed — refresh the product list and re-ring the sale") instead of silently charging a different amount than displayed — the INV-000160 failure mode can no longer occur silently. The first real compound-tax sale in normal operation will de-facto exercise the happy-path equality; any mismatch now surfaces as a loud rejection rather than a quiet under-quote.

## Follow-up

- None required for this phase. If a "Totals changed" rejection is ever reported by staff, that is the assertion working — investigate catalog staleness at that time.
