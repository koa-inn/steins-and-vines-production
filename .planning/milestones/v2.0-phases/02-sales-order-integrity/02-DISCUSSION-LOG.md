# Phase 2: Sales Order Integrity - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-28
**Phase:** 2-Sales Order Integrity
**Areas discussed:** Invoice vs Sales Order, Per-item tax rules, Failure notification UX, Post-sale stock refresh

---

## Invoice vs Sales Order

### Q1: Zoho record type for direct kiosk sales

| Option | Description | Selected |
|--------|-------------|----------|
| Keep Invoices (Recommended) | Fix tax and line-item accuracy on the existing invoice flow. Stock auto-decrements, accounting is immediate. Simplest path — fewer API calls, no stock gap. | ✓ |
| Hybrid: SO → Invoice | Create SO first (order record), auto-convert to Invoice on payment. More API calls but gives both an SO reference and proper stock/accounting. | |
| Pure Sales Orders | Switch to SOs only. Matches Phase 4 endpoints but stock won't auto-decrement — needs manual inventory adjustment or ledger workaround. | |

**User's choice:** Keep Invoices
**Notes:** User asked about implications of Invoice vs SO before selecting. Key factor was that Invoices auto-decrement stock while SOs do not.

### Q2: Phase 4 SO-pay flow stock gap

| Option | Description | Selected |
|--------|-------------|----------|
| Leave for later | Phase 2 focuses on direct-sale invoice path only. Phase 4's SO flow is already shipped — stock gap is a known limitation. | |
| Fix both now | Update salesorder-pay to also create an invoice so stock deducts on all payment paths. More scope but closes the gap everywhere. | ✓ |
| You decide | Claude's discretion based on implementation complexity during planning. | |

**User's choice:** Fix both now
**Notes:** None

---

## Per-Item Tax Rules

### Q1: Tax method

| Option | Description | Selected |
|--------|-------------|----------|
| Pass tax_id per line (Recommended) | Each invoice line item includes tax_id from catalog. Zoho calculates tax using its own rules. Handles mixed-tax carts correctly. | ✓ |
| Keep flat rate | Keep KIOSK_TAX_RATE as single percentage applied to whole cart. Won't match Zoho rules if items have different tax treatments. | |
| You decide | Claude picks based on Zoho API behavior and catalog data quality. | |

**User's choice:** Pass tax_id per line
**Notes:** None

### Q2: Tax fallback for missing tax_id

| Option | Description | Selected |
|--------|-------------|----------|
| Fall back to default tax | Use KIOSK_TAX_RATE (5% GST) as fallback for items without tax_id. Ensures no item goes tax-free by accident. | ✓ |
| Reject the sale | Refuse to process if any line item lacks tax_id. Stricter but could block sales. | |
| Let Zoho decide | Send line item without tax_id — Zoho applies contact/org default tax rule. | |

**User's choice:** Fall back to default tax
**Notes:** None

---

## Failure Notification UX

### Q1: Staff-facing error on Zoho failure + auto-void

| Option | Description | Selected |
|--------|-------------|----------|
| Prominent error banner (Recommended) | Full-screen error view with clear message: payment voided, no charge, transaction ID. "Try Again" or "Cancel." | ✓ |
| Toast notification | Non-blocking toast with error details. Less disruptive but could be missed. | |
| You decide | Claude picks based on existing kiosk error handling patterns. | |

**User's choice:** Prominent error banner
**Notes:** None

### Q2: Void failure (worst case) UX

| Option | Description | Selected |
|--------|-------------|----------|
| Error + manager instructions | Same error but with specific instructions to contact manager with txn ID and amount. | |
| Same error banner | Show same error view regardless. Void-failure email handles escalation. Staff doesn't need to know the difference. | ✓ |
| You decide | Claude picks based on how critical void failures are. | |

**User's choice:** Same error banner
**Notes:** None

---

## Post-Sale Stock Refresh

### Q1: When to refresh frontend stock

| Option | Description | Selected |
|--------|-------------|----------|
| On receipt dismiss (Recommended) | When staff taps "Done", auto-reload products with ?bust=1. Fresh stock immediately. Small 1-2s delay acceptable. | ✓ |
| Background during receipt | Start refresh while receipt shows. Faster but more complex. | |
| You decide | Claude picks based on implementation simplicity. | |

**User's choice:** On receipt dismiss
**Notes:** None

### Q2: Refresh on all payment paths

| Option | Description | Selected |
|--------|-------------|----------|
| Yes, all payment paths | Any successful payment triggers refresh on receipt dismiss. Consistent everywhere. | ✓ |
| Direct sale only | Only refresh after direct kiosk sales. SO payments less frequent. | |

**User's choice:** Yes, all payment paths
**Notes:** None

### Q3: Negative stock display (user-initiated question)

| Option | Description | Selected |
|--------|-------------|----------|
| Show negative numbers | Display actual count like "-3 in stock" for shortfall visibility. Only staff see kiosk. | ✓ |
| Keep "Out of stock" | Anything <= 0 shows "Out of stock". Simpler. Staff checks Zoho for exact shortfall. | |
| You decide | Claude picks based on existing stock display patterns. | |

**User's choice:** Show negative numbers
**Notes:** User proactively asked whether stock can go negative to show shortfall. Motivated by reorder planning needs.

---

## Claude's Discretion

- Exact wording of full-screen error messages
- SO-to-Invoice conversion mechanism (Zoho convert API vs separate invoice)
- KIOSK_TAX_RATE env var lifecycle (keep as fallback, deprecate, or remove)

## Deferred Ideas

None — discussion stayed within phase scope
