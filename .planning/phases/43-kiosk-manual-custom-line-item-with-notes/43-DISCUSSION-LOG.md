# Phase 43: Kiosk manual custom line item with notes - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-26
**Phase:** 43-kiosk-manual-custom-line-item-with-notes
**Areas discussed:** UI affordance & placement, Note vs description data shape, Field rules & defaults, Cart editing behaviour

---

## Pre-discussion locked decisions (with owner, during inline investigation)

| Question | Choice |
|----------|--------|
| Tax treatment | GST 5% default with per-line tax-exempt toggle |
| Price bounds | Allow negative + large; UI confirms for >$2000 or negative; server keeps grand-total guards (>$0, ≤$10k) |

---

## UI affordance & placement

| Option | Description | Selected |
|--------|-------------|----------|
| Modal/sheet from cart button | 'Add custom item' button in cart opens a focused modal; big touch targets; easiest to keep identical across forked files | ✓ |
| Inline form in cart sidebar | Fields expand inline; cramped, more divergence risk | |
| Dedicated view/screen | Separate kiosk view; overkill | |

**User's choice:** Modal/sheet from cart button
**Notes:** Drives identical modal + handler in kiosk.js and admin.js.

---

## Note vs description data shape

| Option | Description | Selected |
|--------|-------------|----------|
| Two fields: Description + optional Note | Description = line label (receipt + Zoho line name); Note appended to Zoho description as "Description — Note" | ✓ |
| Single Description field only | One field doubles as label + note | |

**User's choice:** Two fields
**Notes:** Matches owner's earlier "ad-hoc line + note in description" design.

---

## Field rules & defaults

| Option | Description | Selected |
|--------|-------------|----------|
| Description required, qty default 1, taxable on | Description required (1–100 chars), price required, qty=1, taxable on | ✓ |
| Description optional | Allow price-only line with generic label | |

**User's choice:** Description required, qty default 1, taxable on

---

## Cart editing behaviour (discounts)

| Option | Description | Selected |
|--------|-------------|----------|
| Exclude custom lines from discounts | Never discounted by presets; staff enter net price or negative line | ✓ |
| Include in cart-scope discounts | Whole-cart discounts also reduce custom lines | |

**User's choice:** Exclude custom lines from discounts

---

## Claude's Discretion

- qty +/- and remove for custom lines reuse existing cart controls (behave like catalog lines).
- Custom-line cart key scheme, server line object shape, sanitization specifics, receipt rendering, exact modal implementation (match existing kiosk modal patterns).

## Deferred Ideas

- Phase 42 kiosk de-fork (js/kiosk-core.js) — would remove the duplicate-into-both-files burden.
- Optional Railway env KIOSK_GST_TAX_ID as belt-and-suspenders for the GST tax_id (human action, not code).
