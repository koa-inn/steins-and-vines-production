# Phase 12: Recipe Data Foundation - Context

**Gathered:** 2026-05-09
**Status:** Ready for planning

<domain>
## Phase Boundary

Establish the recipe data model in Google Sheets, Apps Script CRUD actions, the feature flag, and the Zoho fee items — the schema foundation that all downstream phases (admin UI, kiosk sales, BeerXML import) build on. No UI or sale flows in this phase.

</domain>

<decisions>
## Implementation Decisions

### Brewing Fee Structure
- **D-01:** Beer uses the same fee split as wine: a service fee + a materials fee. Same tax treatment (service = GST only, materials = GST + PST).
- **D-02:** Default amounts are $45 service + $5 materials (same as wine), but both are overridable per recipe. The recipe schema stores `service_fee` and `materials_fee` fields.
- **D-03:** Reuse the existing Maker's Fee and Materials Fee Zoho service items rather than creating new ones. Wine vs beer revenue is distinguishable by the line items on the sales order (kits vs recipe ingredients).

### Recipe Ingredient Storage
- **D-04:** Ingredients stored in a separate `RecipeIngredients` Google Sheets tab (not a JSON blob in one column). Matches existing multi-tab pattern (BatchTasks, PlatoReadings). Staff can view/edit in the Sheet directly as a fallback.
- **D-05:** Ingredient fields are minimal: `recipe_id`, `item_id`, `item_name`, `quantity`, `unit`. No category column — category derived from Zoho at display time if needed.

### Recipe Status Workflow
- **D-06:** Three statuses: `draft`, `active`, `inactive`. BeerXML imports start as `draft`. Staff manually activate after setting price/fees.
- **D-07:** Recipes can be deleted only if no batches reference them. Once a recipe has been used in a sale, it can only be deactivated (set to `inactive`). The `recipe_snapshot` on the batch preserves the historical ingredient data.

### Feature Flag Scope
- **D-08:** `BEER_SALES_ENABLED` gates both kiosk recipe sales AND public recipe visibility. Admin recipe creation, editing, and BeerXML import work regardless of the flag — staff can build the full recipe catalog while waiting for the federal brewing licence. The flag is an env var on Railway, defaults to `false`.

### Claude's Discretion
- **D-03 rationale:** Claude chose to reuse existing Maker's Fee + Materials Fee Zoho items. Same tax rules apply automatically, no Zoho configuration needed. If revenue separation between wine and beer becomes important later, creating separate Zoho items is a non-breaking change.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project Context
- `.planning/PROJECT.md` — Current milestone goals, constraints, key decisions
- `.planning/REQUIREMENTS.md` — 25 v2.0 requirements with traceability (RDM-01 through RDM-05 are this phase)
- `.planning/ROADMAP.md` — Phase 12 success criteria and dependency chain

### Research
- `.planning/research/SUMMARY.md` — Synthesized research: stack, features, architecture, pitfalls
- `.planning/research/STACK.md` — Technology recommendations (fast-xml-parser, multer, Sheets schema)
- `.planning/research/ARCHITECTURE.md` — Integration architecture, data flow, component mapping
- `.planning/research/PITFALLS.md` — Critical pitfalls: locked_price, recipe_snapshot, batch detection

### Existing Patterns
- `apps-script/adminApi.gs` — Existing Apps Script CRUD pattern for batches, schedules, tasks
- `zoho-middleware/lib/brewpad-integration.js` — Batch creation from kiosk sales (recipe batch path must be separate)
- `zoho-middleware/lib/constants.js` — Redis key namespaces, fee item patterns

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `adminApi.gs` batch CRUD pattern: `doPost()` action routing, `handleCreateBatch()`, `handleGetBatches()`, `handleUpdateBatch()` — recipe CRUD follows identical structure
- `APPS_SCRIPT_SERVER_TOKEN` auth pattern in `adminApi.gs` — server-token branch for middleware→Apps Script calls
- Existing Batches sheet column layout — `recipe_id` and `recipe_snapshot` columns are additive

### Established Patterns
- **Multi-tab Sheets schema:** Batches + BatchTasks + PlatoReadings + FermSchedules + VesselHistory — RecipeIngredients tab follows this pattern
- **Apps Script action routing:** `doPost()` dispatches by `action` field, each handler is a standalone function
- **Env var feature flags:** `PAYMENT_DISABLED` in `01-config.js`, `INVENTORY_LEDGER_ENABLED` in middleware — `BEER_SALES_ENABLED` follows this pattern
- **Fee service items:** `MAKERS_FEE_ITEM_ID` env var pattern on Railway — reused for recipe fees

### Integration Points
- `adminApi.gs` `doPost()` — add `create_recipe`, `get_recipes`, `update_recipe`, `delete_recipe` actions
- Batches sheet — add `recipe_id` and `recipe_snapshot` columns
- `zoho-middleware/lib/validateEnv.js` — add `BEER_SALES_ENABLED` to optional env vars
- `zoho-middleware/lib/constants.js` — add `CACHE_KEYS.RECIPES` for Redis recipe cache key

</code_context>

<specifics>
## Specific Ideas

- Competitive pricing benchmarked against Terminal City Brewing ($170-$215/48L batch) — locked_price should be in that range for core recipes
- Fee defaults match wine ($45/$5) but beer may need higher fees later as the brewing process is refined — per-recipe override handles this without schema changes
- Two one-off brews completed so far — the first real recipes will be entered manually via admin before BeerXML import is built (Phase 15)

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 12-Recipe Data Foundation*
*Context gathered: 2026-05-09*
