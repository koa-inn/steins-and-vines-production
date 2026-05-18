# Phase 16: Recipe Management — BrewPad, Kiosk & Batch Integration - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-17
**Phase:** 16-recipe-management-brewpad-kiosk-batch-integration
**Areas discussed:** Recipe picker in BrewPad, Recipe editing surfaces, Recipe data in batch context, Kiosk recipe browsing scope

---

## Recipe Picker in BrewPad

### How should recipes appear in the New Batch form?

| Option | Description | Selected |
|--------|-------------|----------|
| Tabbed picker | Two tabs: "Kits" (Zoho products) and "Recipes" (from Sheets). Clean separation. | ✓ |
| Unified search | Single search field searching both kits and recipes together with badges. | |
| Separate Recipe button | Keep product search for kits, add a "From Recipe" button for modal picker. | |

**User's choice:** Tabbed picker
**Notes:** None

### When a recipe is selected, what should auto-fill?

| Option | Description | Selected |
|--------|-------------|----------|
| Name + snapshot | Pre-fills product name and attaches full recipe_snapshot JSON. | ✓ |
| Name only | Just sets product name. No recipe data attached to batch. | |
| Name + snapshot + schedule | Same plus auto-selects fermentation schedule. Needs new mapping. | |

**User's choice:** Name + snapshot
**Notes:** None

---

## Recipe Editing Surfaces

### Full editor or lighter version in BrewPad/kiosk?

| Option | Description | Selected |
|--------|-------------|----------|
| Full editor everywhere | Same ingredient list, pricing, status controls in all three surfaces. | |
| View + quick edit | Read-only ingredient list, inline editing for key fields. Full CRUD in admin only. | ✓ |
| View only | Browse and view but all editing through admin. | |

**User's choice:** View + quick edit, with the addition that recipe data should be editable once loaded into a batch
**Notes:** User wants to be able to change the recipe on a batch if things change (e.g., ingredient substitution)

### Batch recipe edits: batch-local or update master?

| Option | Description | Selected |
|--------|-------------|----------|
| Batch-local only | Edits modify that batch's snapshot only. Master recipe unchanged. | ✓ |
| Update master too | Changes propagate back to master recipe record. | |
| Ask each time | Prompt staff for each edit. | |

**User's choice:** Batch-local only
**Notes:** None

### What fields editable on batch recipe snapshot?

| Option | Description | Selected |
|--------|-------------|----------|
| Ingredients + quantities | Add/remove/swap ingredients and change quantities. | |
| Full recipe fields | Ingredients, quantities, plus name, style, ABV, batch size, notes. | ✓ |
| You decide | Claude picks appropriate editable fields. | |

**User's choice:** Full recipe fields
**Notes:** None

---

## Recipe Data in Batch Context

### How should recipe display in batch detail?

| Option | Description | Selected |
|--------|-------------|----------|
| Expandable section | Collapsible "Recipe" section, collapsed by default. | ✓ |
| Always visible | Inline at top, always shown. | |
| Separate tab | New tab alongside existing batch sections. | |

**User's choice:** Expandable section
**Notes:** User liked the preview mockup

### Should kit batches also show recipe section?

| Option | Description | Selected |
|--------|-------------|----------|
| Recipe-sourced only | Only show when recipe_snapshot exists. | |
| All batches + attach | Every batch gets Recipe section. Kit batches get "Attach Recipe" button. | |
| All batches + create recipe | Same plus "Create Recipe" to generate recipe from kit batch info. | ✓ |

**User's choice:** All batches + create recipe
**Notes:** User asked to clarify what "create recipe" meant — confirmed it means generating a new recipe record from a kit batch's product info, turning one-off brews into reusable recipes.

---

## Kiosk Recipe Browsing Scope

### Should kiosk recipe browsing work when BEER_SALES_ENABLED=false?

| Option | Description | Selected |
|--------|-------------|----------|
| Browsing/editing ungated | View and quick-edit anytime. Only sales blocked by gate. | ✓ |
| Everything gated | Recipes tab hidden until BEER_SALES_ENABLED=true. | |
| Browsing ungated, editing gated | View-only until gate enabled. | |

**User's choice:** Browsing/editing ungated
**Notes:** None

### Kiosk recipe edit style?

| Option | Description | Selected |
|--------|-------------|----------|
| Same as BrewPad | Consistent quick-edit across both surfaces. | ✓ |
| View only in kiosk | Read-only, editing through admin/BrewPad. | |
| You decide | Claude picks appropriate level. | |

**User's choice:** Same as BrewPad
**Notes:** None

---

## Claude's Discretion

- Recipe tab styling in BrewPad batch form
- Collapsible recipe section design in batch detail
- "Create Recipe from Batch" UX flow
- Kiosk recipe card layout

## Deferred Ideas

None
