# Phase 4: Sales Order Management - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-27
**Phase:** 04-sales-order-management
**Areas discussed:** Import-to-cart flow, Post-payment SO lifecycle, Status filter design

---

## Import-to-cart flow

### Q1: Purpose of importing SO line items into the cart

| Option | Description | Selected |
|--------|-------------|----------|
| Review before paying | Staff sees line items in cart to verify, then pays SO balance as-is. Read-only preview. | |
| Modify then pay | Staff imports line items, can adjust quantities or remove items, then pays updated balance. | ✓ |
| Replace direct-pay entirely | Remove current 'Pay' button. All SO payments go through cart import flow. | |

**User's choice:** Modify then pay
**Notes:** Staff needs ability to adjust orders before collecting payment.

### Q2: When does the Zoho SO get updated after staff modifies items?

| Option | Description | Selected |
|--------|-------------|----------|
| Update SO at payment time | Cart edits are local only. Middleware updates Zoho SO with modified items first, then charges new balance via terminal. | ✓ |
| Update SO immediately on edit | Every cart edit sends API call to update Zoho SO in real-time. Always in sync but more API calls. | |
| Create new SO, void old | Void/cancel old SO and create new one from modified cart. Cleaner audit trail but two SOs per transaction. | |

**User's choice:** Update SO at payment time
**Notes:** Minimizes Zoho API calls; batch-updates at the critical moment.

### Q3: What happens to existing cart items when importing an SO?

| Option | Description | Selected |
|--------|-------------|----------|
| Clear cart first | Show confirm dialog if cart has items: "This will replace your current cart. Continue?" | ✓ |
| Block if cart has items | Disable import button when cart is non-empty. Staff must clear manually first. | |
| Separate SO mode | Switch kiosk into visually distinct 'SO mode'. Regular cart preserved but hidden. | |

**User's choice:** Clear cart first
**Notes:** Confirm dialog pattern matches existing kiosk UX.

### Q4: Can staff add NEW products after importing?

| Option | Description | Selected |
|--------|-------------|----------|
| Yes, add from catalog | Staff can browse product grid and add more items. SO gets all items at payment time. | ✓ |
| No, only modify existing | Can only adjust quantities or remove items from original SO. No adding new products. | |

**User's choice:** Yes, add from catalog
**Notes:** Full flexibility — staff can augment existing orders.

---

## Post-payment SO lifecycle

### Q1: Explicitly update SO status or rely on Zoho auto-close?

| Option | Description | Selected |
|--------|-------------|----------|
| Rely on Zoho auto-close | Zoho auto-marks SOs as 'closed' when balance hits 0 via /customerpayments. Simpler code. | |
| Explicitly confirm SO | After recording payment, make second API call to explicitly set status. Belt-and-suspenders. | |
| You decide | Let Claude research Zoho API behavior and pick most reliable approach. | ✓ |

**User's choice:** You decide
**Notes:** Deferred to Claude's research during implementation.

### Q2: How should the kiosk UI respond after successful SO payment?

| Option | Description | Selected |
|--------|-------------|----------|
| Receipt then refresh list | Show receipt, then auto-refresh the SO list with updated status. | |
| Receipt then return to cart | Show receipt, return to empty cart/product grid view. Staff goes to SO list manually. | ✓ |
| Receipt then auto-clear | Show receipt, auto-clear imported cart, stay on SO list view. | |

**User's choice:** Receipt then return to cart
**Notes:** Consistent with normal kiosk sale flow.

### Q3: What happens if Zoho SO update succeeds but terminal payment fails?

| Option | Description | Selected |
|--------|-------------|----------|
| Revert SO to original | Roll back Zoho SO to original line items on payment failure. Complex. | |
| Keep modified SO, retry | Leave Zoho SO as modified. Show retry option. SO reflects what customer wants. | ✓ |
| You decide | Let Claude pick most practical approach. | |

**User's choice:** Keep modified SO, retry
**Notes:** Simpler and the modified SO accurately represents the intended transaction.

---

## Status filter design

### Q1: How should staff filter SO statuses?

| Option | Description | Selected |
|--------|-------------|----------|
| Toggle chips | Horizontal row of status chips (Open, Draft, Closed, Paid, All). Multiple can be active. Matches kiosk category filter pattern. | ✓ |
| Single dropdown | Dropdown select with All, Open, Draft, Closed, Paid. One status at a time. | |
| Two-tab split | Two tabs: 'Active' (open + draft) and 'History' (closed + paid). | |

**User's choice:** Toggle chips
**Notes:** Consistent with existing kiosk filter UI patterns.

### Q2: Default active filters?

| Option | Description | Selected |
|--------|-------------|----------|
| Open + Draft | Show actionable orders by default. Staff sees what needs attention first. | ✓ |
| All statuses | Show everything by default. | |
| Open only | Narrowest default — only confirmed open orders. | |

**User's choice:** Open + Draft
**Notes:** Matches current behavior — actionable orders first.

### Q3: Fetch strategy for all statuses

| Option | Description | Selected |
|--------|-------------|----------|
| Fetch all, filter client-side | Middleware fetches all statuses in parallel, caches combined result. Frontend filters. | |
| Fetch per-status on demand | Fetch only selected status(es) from Zoho per chip toggle. | |
| You decide | Let Claude pick based on Zoho rate limits and existing cache pattern. | ✓ |

**User's choice:** You decide
**Notes:** Deferred to Claude's judgment given rate limit constraints.

### Q4: Actions on paid/closed SO cards?

| Option | Description | Selected |
|--------|-------------|----------|
| Hide action buttons | Paid/closed cards are view-only. No Pay or Import. | |
| Show Import only | Hide Pay, keep Import for re-creating similar orders. | |
| Hide all, show 'Reorder' | No Pay/Import. Show 'Reorder' button that creates a new SO with same line items. | ✓ |

**User's choice:** Hide all, show 'Reorder'
**Notes:** Clean separation — closed orders get a dedicated "Reorder" action for repeat transactions.

---

## Claude's Discretion

- Zoho SO auto-close behavior: research whether `/customerpayments` with `salesorders_to_apply` auto-closes SOs when balance = 0, or if explicit status update is needed
- Fetch strategy: batch-fetch all statuses and filter client-side vs. per-status on demand (likely batch given existing cache pattern)
- Chip styling: match existing kiosk category filter CSS

## Deferred Ideas

None — discussion stayed within phase scope.
