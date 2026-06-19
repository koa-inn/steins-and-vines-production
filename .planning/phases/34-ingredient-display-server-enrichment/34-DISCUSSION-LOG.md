# Phase 34: Ingredient Display & Server Enrichment - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-19
**Phase:** 34-ingredient-display-server-enrichment
**Areas discussed:** Grouping field, Section order & labels, Within-section sort & unknowns, Cross-surface presentation

---

## Grouping field

| Option | Description | Selected |
|--------|-------------|----------|
| cf_subcategory primary | Group by cf_subcategory (Grain/Hops/Yeast/Additive), fall back to cf_type for items lacking a subcategory. | |
| Hybrid: cf_type → cf_subcategory | Top-level by cf_type (Ingredient/Packaging/Equipment), nested by cf_subcategory inside Ingredient. | ✓ |
| cf_type literal | Group strictly by cf_type — collapses ~all ingredients into one "Ingredient" bucket. | |

**User's choice:** Hybrid: cf_type → cf_subcategory
**Notes:** Decision grounded in live `ingredients-cache.json` data — cf_type is dominated by "Ingredient" (128), while the brewing groups (Grain/Hops/Yeast/Additive) live in cf_subcategory. Kickoff's "group by cf_type" treated as colloquial.

### Follow-up: Nesting rule

| Option | Description | Selected |
|--------|-------------|----------|
| Only Ingredient nests | Only Ingredient sub-groups; Packaging/Equipment/Cleaning flat. | |
| All types nest | Every cf_type sub-groups by cf_subcategory. | |
| Nest only when 2+ subcats | Sub-group within a cf_type only when it has 2+ distinct subcategories. | ✓ |

**User's choice:** Nest only when 2+ subcategories — avoids redundant single-child headers.

### Follow-up: Enrichment shape

| Option | Description | Selected |
|--------|-------------|----------|
| Raw fields, surfaces group | Server attaches cf_type + cf_subcategory + label; surfaces build structure via shared helper. | ✓ (Claude's discretion) |
| Server emits grouped structure | Server returns pre-built nested group array. | |

**User's choice:** Deferred to Claude ("do whatever you think would work better"). Resolved as raw additive fields + shared client helper, to keep the ingredient array shape (consumed by pricing/recipe_snapshot money path) unchanged.

---

## Section order & labels

| Option | Description | Selected |
|--------|-------------|----------|
| Brewing-process order | Grain→Hops→Yeast→Additive, then Packaging, Equipment, Cleaning/Sanitization. | ✓ |
| Alphabetical | Sort sections A–Z. | |
| By item count | Largest groups first (mirrors search overlay). | |

**User's choice:** Brewing-process order — defined once in the shared helper.

| Option | Description | Selected |
|--------|-------------|----------|
| Reuse/extend CATEGORY_DISPLAY_NAMES | Reuse the search overlay's collapsing map, promoted to js/lib/. | ✓ |
| Raw field values | Show cf_type/cf_subcategory verbatim. | |

**User's choice:** Reuse/extend CATEGORY_DISPLAY_NAMES.

---

## Within-section sort & unknowns

| Option | Description | Selected |
|--------|-------------|----------|
| Recipe-entry order | Preserve authored order. | ✓ |
| Alphabetical by name | Sort A–Z within section. | |
| Quantity descending | Largest quantities first. | |

**User's choice:** Recipe-entry order.

| Option | Description | Selected |
|--------|-------------|----------|
| 'Other' section at bottom | Untyped → 'Other' last; cold cache → flat ungrouped list. | ✓ |
| Keep ungrouped above sections | Untyped as plain leading list. | |
| Hide untyped | Only show resolvable-type items. | |

**User's choice:** 'Other' section at bottom, with flat-list cold-cache fallback.

---

## Cross-surface presentation

| Option | Description | Selected |
|--------|-------------|----------|
| Same grouping, native styling | Shared grouping/order/labels; each surface renders in its own UI idiom. | ✓ |
| Pixel-identical component | One shared rendered component across all three. | |

**User's choice:** Same grouping, native styling.

| Option | Description | Selected |
|--------|-------------|----------|
| Count shown, all expanded | Header "Hops (4)", expanded, no collapsing. | ✓ |
| Count shown, collapsible | Count + collapse/expand state. | |
| No count, all expanded | Plain headers, no counts. | |

**User's choice:** Count shown, all expanded.

---

## Claude's Discretion

- **Enrichment shape:** User deferred. Resolved as raw additive fields (cf_type, cf_subcategory, display label) on each ingredient + a single shared js/lib/ grouping helper — chosen to keep the ingredient array shape unchanged for the pricing/recipe_snapshot money path while still guaranteeing identical cross-surface grouping.

## Deferred Ideas

None — discussion stayed within phase scope.
