---
title: "/api/checkout can void any Helcim payment the client names (rejectWithVoid has no ownership check, runs before reCAPTCHA)"
status: pending
created: 2026-10-29
source: Phase 100 research (100-RESEARCH.md Pitfall 1); owner chose "separate todo" 2026-10-29
area: middleware / money path / security
priority: high
---

## What

`moneyPath.rejectWithVoid` (`zoho-middleware/lib/money-path.js` ~l.149-175) voids `body.payment_token`
without proving the caller owns that transaction. `/api/checkout` (`zoho-middleware/routes/checkout.js`
~l.59 and ~l.90-127) calls it on validation 400s, **before** the reCAPTCHA check.

Helcim transaction ids are numeric and near-sequential. A malformed `/api/checkout` request naming
someone else's open-batch transaction could reverse that customer's sale.

**Not yet verified as exploitable.** The code path is confirmed by reading the code, but nobody has
tested whether Helcim allows the void in practice.

## Suggested direction

- Prove the payment belongs to this request before voiding. Phase 100 uses a server-minted nonce,
  bound as the Helcim `invoiceNumber` at initialize time, and checks it on readback. Reuse that
  pattern here.
- At minimum, run reCAPTCHA before any void, and void only a transaction whose readback amount and
  invoice reference match this checkout.
- Write a regression test first (CLAUDE.md rule 3). This touches the live money path, so test it on
  staging before prod.

## Related

- Phase 100 deliberately does not copy this pattern (CONTEXT D-17).
