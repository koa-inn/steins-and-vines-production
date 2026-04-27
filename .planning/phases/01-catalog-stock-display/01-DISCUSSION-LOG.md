# Phase 1: Catalog & Stock Display - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-27
**Phase:** 1-Catalog & Stock Display
**Areas discussed:** Stock overflow warning, Category filter cleanup, Stock freshness

---

## Stock Overflow Warning

### When should the warning appear?

| Option | Description | Selected |
|--------|-------------|----------|
| On every add past stock | Each time qty would exceed stock_on_hand, show confirm dialog with override. Same pattern as existing out-of-stock confirm. | ✓ |
| Only at checkout | Let them add freely, warn once when they try to pay. | |
| Inline badge, no block | Show a visual warning on the cart row but don't interrupt the add flow. | |

**User's choice:** On every add past stock
**Notes:** None

### What should the confirm dialog say?

| Option | Description | Selected |
|--------|-------------|----------|
| Show stock + cart qty | e.g. '"Merlot" — only 2 in stock, cart has 3. Add anyway?' | ✓ |
| Simple override | e.g. '"Merlot" exceeds available stock. Continue?' | |
| You decide | Claude picks best wording | |

**User's choice:** Show stock + cart qty
**Notes:** None

### Where should the warning trigger?

| Option | Description | Selected |
|--------|-------------|----------|
| Both grid and cart | Warn from product grid, cart +/- buttons, and cart qty input | ✓ |
| Grid only | Only warn from product grid | |

**User's choice:** All three: grid add, +/- buttons, and typed qty input
**Notes:** User initially selected grid + typed input only, then corrected to include +/- buttons as well

---

## Category Filter Cleanup

### What should happen with items that have no category_name?

| Option | Description | Selected |
|--------|-------------|----------|
| Exclude from filter | Only category_name values in dropdown | |
| Group as 'Other' | Uncategorized items under 'Other' filter option | ✓ |
| Use cf_type but skip product_type | Keep cf_type fallback, exclude 'goods'/'services' | |

**User's choice:** Group as 'Other'
**Notes:** None

### Should product cards show 'Other' as category label?

| Option | Description | Selected |
|--------|-------------|----------|
| Show 'Other' on card | Consistent with filter | |
| Hide category on card | Don't display category badge if no real category_name | ✓ |
| You decide | Claude picks whichever looks cleaner | |

**User's choice:** Hide category on card
**Notes:** None

---

## Stock Freshness

### After a kiosk sale, should stock refresh immediately?

| Option | Description | Selected |
|--------|-------------|----------|
| Yes, bust cache after sale | Invalidate kiosk product cache after successful sale | ✓ |
| No, let TTL expire | Accept up to 5 min stale stock | |
| Bust + force reload | Bust cache AND auto-refresh product grid in UI | |

**User's choice:** Bust cache after sale
**Notes:** None

### Should kiosk reflect cross-channel stock changes?

| Option | Description | Selected |
|--------|-------------|----------|
| 5-min TTL is fine | Other channels show up within 5 min via normal expiry | ✓ |
| Shorter TTL (2 min) | More responsive but more API calls | |
| Manual refresh button | Keep 5-min TTL, add staff refresh button | |

**User's choice:** 5-min TTL is fine
**Notes:** None

---

## Claude's Discretion

- Exact wording of stock overflow confirm dialog
- Whether to consolidate stock checks into a single function or keep separate

## Deferred Ideas

None — discussion stayed within phase scope
