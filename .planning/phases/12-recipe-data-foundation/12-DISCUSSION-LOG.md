# Phase 12: Recipe Data Foundation - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-09
**Phase:** 12-recipe-data-foundation
**Areas discussed:** Brewing fee structure, Recipe ingredient storage, Recipe status workflow, Feature flag scope

---

## Brewing Fee Structure

| Option | Description | Selected |
|--------|-------------|----------|
| Same split (Recommended) | Service fee + materials fee, same pattern as wine. Different amounts but same tax treatment. | ✓ |
| Single combined fee | One 'Brewing Fee' line item per recipe. Simpler, but may lose tax advantage. | |
| Per-recipe variable fees | Staff sets both fees individually per recipe. Maximum flexibility. | |

**User's choice:** Same split as wine
**Notes:** User confirmed same pattern, same tax treatment.

| Option | Description | Selected |
|--------|-------------|----------|
| Same as wine ($45 + $5) | Keep it simple — same fees regardless. | ✓ (with override) |
| Different default for beer | Higher default (e.g. $55 + $10) but allow per-recipe override. | |
| Per-recipe (no default) | Staff sets both fees manually for every recipe. | |

**User's choice:** Same as wine for now, but with per-recipe override capability
**Notes:** User wants $45/$5 as baseline defaults with the ability to set different amounts per recipe.

| Option | Description | Selected |
|--------|-------------|----------|
| Reuse existing items | Same Maker's Fee + Materials Fee Zoho items for wine and beer. | |
| New separate items | Create 'Brewing Service Fee' + 'Brewing Materials Fee' in Zoho. | |
| You decide | Let Claude pick. | ✓ |

**User's choice:** You decide
**Notes:** Claude chose to reuse existing items — same tax rules, no Zoho config needed.

---

## Recipe Ingredient Storage

| Option | Description | Selected |
|--------|-------------|----------|
| JSON in one column | JSON array in one cell. Simpler schema but staff can't edit in Sheet. | |
| Separate tab (Recommended) | RecipeIngredients tab with individual rows. Matches existing pattern. | ✓ |
| You decide | Let Claude pick. | |

**User's choice:** Separate tab
**Notes:** Matches existing multi-tab pattern (BatchTasks, PlatoReadings).

| Option | Description | Selected |
|--------|-------------|----------|
| Minimal (ID + qty + unit) | item_id, item_name, quantity, unit. Category derived from Zoho at display time. | ✓ |
| With category | Adds category column (grain/hops/yeast/misc). Allows grouped display without Zoho lookup. | |
| You decide | Let Claude decide. | |

**User's choice:** Minimal fields
**Notes:** No category column needed — derive from Zoho when needed.

---

## Recipe Status Workflow

| Option | Description | Selected |
|--------|-------------|----------|
| Draft / Active / Inactive | 3 states. BeerXML imports start as draft. Simple and sufficient. | ✓ |
| Draft / Active / Seasonal / Archived | 4 states. Adds seasonal and archived. More expressive. | |
| Just Active / Inactive | 2 states. No draft concept. | |

**User's choice:** Draft / Active / Inactive

| Option | Description | Selected |
|--------|-------------|----------|
| Deactivate only (Recommended) | Recipes never deleted, only set to Inactive. | |
| Delete if no batches | Allow deletion only if no batches reference the recipe. | ✓ |
| You decide | Let Claude decide. | |

**User's choice:** Delete if no batches
**Notes:** Once a recipe has been used in a sale, it can only be deactivated. Batch snapshot preserves ingredient data.

---

## Feature Flag Scope

| Option | Description | Selected |
|--------|-------------|----------|
| Sales only (Recommended) | Only gates kiosk recipe sales confirm endpoint. Admin works regardless. | |
| Sales + public visibility | Gates kiosk sales AND public recipe browsing. Admin still works. | ✓ |
| Everything | Gates all recipe features including admin creation. | |

**User's choice:** Sales + public visibility
**Notes:** User wanted the extra safety of hiding recipes from public view too. Asked for elaboration on options before deciding. Admin recipe management always works regardless of flag so staff can build the catalog pre-licence.

---

## Claude's Discretion

- D-03: Reuse existing Maker's Fee + Materials Fee Zoho items (user said "you decide")

## Deferred Ideas

None — discussion stayed within phase scope.
