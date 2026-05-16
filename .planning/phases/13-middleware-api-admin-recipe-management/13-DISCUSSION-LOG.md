# Phase 13: Middleware API + Admin Recipe Management - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-16
**Phase:** 13-middleware-api-admin-recipe-management
**Areas discussed:** Recipe list & editor layout, Zoho SKU lookup, Availability checking, Middleware routes

---

## Recipe List & Editor Layout

### Tab placement

| Option | Description | Selected |
|--------|-------------|----------|
| After Batches | Operationally close to batch tracking | |
| After Ingredients | Recipes built from ingredients, natural grouping | |
| You decide | Claude places it where it fits best | ✓ |

**User's choice:** You decide
**Notes:** Claude will determine optimal tab placement.

### List vs editor structure

| Option | Description | Selected |
|--------|-------------|----------|
| Table list with edit modal | Click row to open modal overlay, list stays visible | |
| List → detail view swap | Click recipe replaces list with full editor, back button returns | ✓ |
| You decide | | |

**User's choice:** List → detail view swap
**Notes:** More room for ingredient editor was the deciding factor.

### Ingredient editing UX

| Option | Description | Selected |
|--------|-------------|----------|
| Editable rows with add/remove | Rows with SKU, name, quantity, unit fields, save all at once | |
| Inline autocomplete rows | Same + autocomplete that searches Zoho ingredient catalog as you type | |
| You decide | Claude designs the approach | ✓ |

**User's choice:** You decide
**Notes:** Claude will design ingredient editing. Autocomplete is the natural choice.

### Activation guardrails

| Option | Description | Selected |
|--------|-------------|----------|
| Activate anytime | Trust staff judgment | |
| Require price + at least one ingredient | Block activation if locked_price empty or no ingredients | ✓ |
| You decide | | |

**User's choice:** Require price + at least one ingredient
**Notes:** Prevents half-baked recipes from going active.

---

## Zoho SKU Lookup

### Data loading strategy

| Option | Description | Selected |
|--------|-------------|----------|
| Pre-load on tab open | Fetch full ingredient catalog, search client-side | ✓ |
| Live API search | Debounced keystroke API calls for fresh data | |
| You decide | | |

**User's choice:** Pre-load on tab open
**Notes:** Catalog size (~200-500 items) makes client-side search fast enough.

### Auto-populate fields

| Option | Description | Selected |
|--------|-------------|----------|
| Name + unit only | Basic auto-fill, staff enters quantity | |
| Name + unit + stock level | Also show current stock as hint | ✓ |
| You decide | | |

**User's choice:** Name + unit + stock level
**Notes:** Stock hint avoids discovery of missing ingredients at sale time.

### Ingredient reference key

| Option | Description | Selected |
|--------|-------------|----------|
| Zoho item_id | Internal numeric ID, consistent with checkout flow | ✓ |
| SKU string | Human-readable but needs lookup at sale time | |
| You decide | | |

**User's choice:** Zoho item_id
**Notes:** Consistent with how checkout and inventory deduction already work.

---

## Availability Checking

### When to check

| Option | Description | Selected |
|--------|-------------|----------|
| On recipe detail load | Auto-check, staff always see stock status | ✓ |
| On-demand button | Staff click to check when they care | |
| Defer to Phase 14 | Only check at kiosk sale time | |

**User's choice:** On recipe detail load
**Notes:** Staff see stock status without thinking about it.

### How to display

| Option | Description | Selected |
|--------|-------------|----------|
| Per-ingredient indicator | Green/yellow/red dot per ingredient row | |
| Per-ingredient + recipe-level summary | Same dots plus top banner summary | ✓ |
| You decide | | |

**User's choice:** Per-ingredient + recipe-level summary
**Notes:** Clear at both levels — quick scan via banner, detail via per-row indicators.

### Low stock threshold

| Option | Description | Selected |
|--------|-------------|----------|
| Batch count based | Yellow when stock < 3 batches of this recipe | ✓ |
| Fixed threshold | Yellow when stock below set number | |
| You decide | | |

**User's choice:** Batch count based
**Notes:** Contextual to each recipe's ingredient quantities.

---

## Middleware Routes

### Route file structure

| Option | Description | Selected |
|--------|-------------|----------|
| New routes/recipes.js | Dedicated file, matches route-per-domain pattern | |
| Extend routes/catalog.js | Fewer files, but mixes Zoho and Apps Script sources | |
| You decide | Claude decides structure | ✓ |

**User's choice:** You decide
**Notes:** New dedicated file is the natural fit.

### Cache strategy

| Option | Description | Selected |
|--------|-------------|----------|
| Long TTL + explicit invalidation | 10-15 min cache, bust on every write | ✓ |
| Short TTL, no invalidation | 60-90 second cache, simpler | |
| You decide | | |

**User's choice:** Long TTL + explicit invalidation
**Notes:** Recipes don't change often; middleware controls the write path so cache busting is reliable.

### API response shaping

| Option | Description | Selected |
|--------|-------------|----------|
| Reshape to clean REST contract | Middleware normalizes Apps Script response | |
| Pass through | Forward Apps Script JSON as-is | |
| You decide | Claude decides approach | ✓ |

**User's choice:** You decide
**Notes:** Clean middleware contract recommended to decouple frontend from Apps Script internals.

---

## Claude's Discretion

- Tab placement in admin panel
- Ingredient editor UX design (autocomplete + editable rows)
- Route file structure (new vs extend existing)
- API response reshaping (normalize vs pass-through)

## Deferred Ideas

None — discussion stayed within phase scope.
