# Phase 44: Kiosk gift card / certificate lifecycle - Discussion Log

> **Audit trail only.** Decisions are captured in CONTEXT.md.

**Date:** 2026-06-27
**Phase:** 44-kiosk-gift-card-certificate-lifecycle
**Areas discussed:** Balance store, Redemption UX, Certificate numbers, Accounting mechanism

---

## Balance-of-record store

| Option | Selected |
|--------|----------|
| Zoho (store credit / customer advance) | |
| Google Sheets (new tab, like batches) | |
| Redis (middleware) | |
| You decide / research it | ✓ |

**Choice:** Research it (deferred). Intertwined with the accounting mechanism (R-01/R-02).

## Redemption UX

| Option | Selected |
|--------|----------|
| Full: enter cert# → auto balance + auto-apply | |
| Assisted: lookup + manual amount | ✓ |
| Minimal: manual balance tracking | |

**Choice:** Assisted — system shows balance, staff enter amount to apply, remainder on terminal. Partial redemption supported. (D-01)

## Certificate numbers

| Option | Selected |
|--------|----------|
| System-suggested number + uniqueness check | ✓ |
| Fully manual + duplicate guard | |
| You decide / research it | |

**Choice:** System suggests next number (GC-NNNNNN), staff can override, server rejects duplicates. (D-02)

## Accounting mechanism (Zoho liability)

| Option | Selected |
|--------|----------|
| No — research best practice | ✓ |
| Yes — I'll provide it | |
| Keep it simple for v1 | |

**Choice:** Research best practice for Zoho liability/revenue-on-redemption (R-01).

## Deferred Ideas
- Pre-printed barcoded cards, digital/emailed codes, customer-facing balance lookup, card-stock inventory — post-v1.
