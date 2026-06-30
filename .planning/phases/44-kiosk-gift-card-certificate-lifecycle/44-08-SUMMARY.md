---
plan: 44-08
phase: 44-kiosk-gift-card-certificate-lifecycle
status: complete
result: partial-uat (live terminal-sale checks deferred by owner)
completed: 2026-06-29
---

## 44-08 — Deploy + iPad Safari UAT gate

### What happened
- **Full gate green:** frontend 928 + middleware 1033 tests pass; lint clean; build clean.
- **Deployed:** staging frontend (`git push origin main`) + prod Railway middleware (`railway up`). Backend re-verified live post-deploy: phantom `/issue` + `/reload` routes return 404 (decommissioned), `next-number` → GC-000001, Referer guard blocks foreign origins (403).
- **UAT round 1** found blocking gap **G-44-01** (issuance recorded a phantom paid Zoho invoice with no real Helcim charge). Closed via gap-closure cycle: plans **44-09** (server: gift_cert cart line, activate-on-payment, kill phantom routes, confirm idempotency) + **44-10** (frontend: modals add a cart line + activation-failure alert, D-08).
- **UAT round 2** (post gap fix): owner verified the visible/no-charge behavior on staging — looks good. G-44-01 resolved.

### Deferred (owner, 2026-06-29) — tracked in 44-08-UAT.md
Live terminal-sale verification (real card charge → Zoho accounting → cert activation on payment):
issue, reload, partial redeem, full redeem. The phase is NOT production-promoted until these pass.

### Accounting model (confirmed live in Wave 1 probes)
- Gift-cert line zero-tax via the item's own EXEMPT setting (no `tax_id`; ZOHO_TAX_ZERO_ID not needed).
- Issue/reload now produce ONE cart invoice paid by the REAL terminal payment (no phantom; nothing in Undeposited Funds).
- Redeem gift portion posts `payment_mode:'others'` to the **Gift Card Redemptions** clearing account (`109900000000873231`).
- Monthly manual deferral journal (Dr Gift Card Sales income / Cr Gift Cards Sold liability) for unredeemed balance — bookkeeper cadence, not code.

### Traceability
REQUIREMENTS.md: GIFTCARD-01 (a–e) added → Phase 44, "Built + on staging; live terminal-sale UAT deferred; not yet production-promoted."

### Next step
Owner runs the deferred live terminal-sale checks (real/test card) → flip 44-08-UAT.md to `status: passed` → then production promotion (`git push production main --force` + `railway up`) as a separate owner-gated step.
