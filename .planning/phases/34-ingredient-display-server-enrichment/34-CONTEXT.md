# Phase 34: Ingredient Display & Server Enrichment - Context

**Gathered:** 2026-06-19
**Status:** Ready for planning

<domain>
## Phase Boundary

Enrich recipe ingredient data server-side with category metadata, then group recipe ingredients by type — consistently — across the admin recipe view, kiosk, and BrewPad. **Display + enrichment only.** No batch scaling, no add/remove/substitute, no recipe builder changes (those are Phase 35+). Requirements: RDISP-01, RDISP-02, RDISP-03.

</domain>

<decisions>
## Implementation Decisions

### Grouping dimension (the key decision)
- **D-01:** Group ingredients **hybrid: top-level by `cf_type`, nested by `cf_subcategory`.** The kickoff text "group by `cf_type`" was colloquial — the *real* brewing groups the requirement names (Grain/Hops/Yeast/Additive) live in `cf_subcategory`, not `cf_type`. Verified against the live ingredients cache:
  - `cf_type` values: `Ingredient` (128), `Equipment` (32), `Packaging` (14), `Cleaning/Sanitization` (7), *(none)* (19)
  - `cf_subcategory` values: `Additive` (56), `Hops` (46), `Yeast` (24), `Grain` (20), `Bottle` (6), `Fermenter` (5), `Bag` (1), *(none)* (40)
  - Grouping strictly by `cf_type` would collapse nearly all ingredients into one "Ingredient" bucket — useless for a recipe view. Hybrid gives the brewing sections inside Ingredient while still separating Packaging/Equipment.
- **D-02:** **Nest only when a top-level `cf_type` contains 2+ distinct `cf_subcategory` values.** A type with one (or zero) subcategory renders flat — no redundant single-child headers (no "Packaging › Packaging").

### Section order & labels
- **D-03:** **Brewing-process order** for sections — Grain → Hops → Yeast → Additive (within Ingredient), then Packaging, Equipment, Cleaning/Sanitization. Order defined **once** in the shared helper, not per-surface. The "Other" bucket (D-06) always renders last.
- **D-04:** **Reuse and extend `CATEGORY_DISPLAY_NAMES`** (currently in `js/modules/17-search-overlay.js`) for the section header labels (Grain→"Grains", Bottle+Bag→"Packaging", etc.) so labels match what customers already see site-wide. **Promote it to `js/lib/` as shared constants** so all surfaces import the same map.

### Within-section sort & unknowns
- **D-05:** **Recipe-entry order** within each section — preserve the order ingredients were authored in the recipe. RDISP-01 only requires *consistent* ordering, and entry order is already deterministic and honors the author's intent.
- **D-06:** Ingredients with a missing/unresolvable type go into an **"Other" section rendered last**. Nothing is ever hidden from a recipe.
- **D-07:** **Cold-cache fallback** — if the catalog cache is cold and ingredients can't be enriched, render a single **flat, ungrouped list** rather than erroring or dropping items.

### Enrichment shape & one source of truth (RDISP-02)
- **D-08:** The middleware attaches `cf_type`, `cf_subcategory`, and a resolved display-group label to **each ingredient as additive fields** — **the ingredient array shape stays unchanged.** This is deliberate: the same ingredient array flows into `lib/pricing.js` and the frozen `recipe_snapshot` (the server-authoritative money path the v4.3 milestone explicitly must not weaken). Do **not** restructure the array into a nested server-side object.
- **D-09:** The actual grouping/nesting (D-01, D-02) lives in **one shared JS helper in `js/lib/`** consumed by admin, kiosk, and BrewPad. Shared enrichment fields + shared grouping helper = the "one source of truth" that makes the three surfaces group **identically** (the real intent of RDISP-02), without changing the recipe API response contract.

### Cross-surface presentation (RDISP-03)
- **D-10:** **Same grouping/order/labels, native per-surface styling.** All three surfaces share the identical grouping via D-09's helper, but each renders within its own existing UI idiom (admin table rows, kiosk cards, BrewPad table). No pixel-identical shared component — the surfaces have different layouts/CSS today and a unified component is out of scope.
- **D-11:** Section headers show a **per-group item count** (e.g. "Hops (4)"). **All sections expanded by default; no collapsing.**

### Claude's Discretion
- **D-08 / D-09 (enrichment shape)** was explicitly delegated ("do whatever you think would work better"). Resolved as above: raw additive fields + shared client-side grouping helper, chosen to protect the hardened money-path snapshot shape while still guaranteeing identical cross-surface grouping. Planner/researcher have latitude on the exact helper API and field naming, but must honor: (a) ingredient array shape unchanged, (b) grouping logic in exactly one shared place.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements & milestone intent
- `.planning/ROADMAP.md` — Phase 34 line (RDISP-01/02/03) and Phase 35 boundary (scaling is NOT this phase)
- `.planning/REQUIREMENTS.md` §"Recipe Display (RDISP)" — RDISP-01, RDISP-02, RDISP-03 full text
- `.planning/PROJECT.md` — v4.3 milestone goal + kickoff key design decisions (note: "group by cf_type" superseded by D-01 hybrid after data verification)

### Middleware — enrichment hook point (RDISP-02)
- `zoho-middleware/routes/recipes.js` §`enrichWithComputedPrice` (~L75) and §`enrichListPrices` (~L112) — where recipe ingredients are already matched to the catalog by `item_id` and decorated with `rate`/`tax`/`tax_id`. This is where `cf_type`/`cf_subcategory`/display-label get attached. `GET /api/recipes` (L180), `GET /api/recipes/:id` (L219) are the two surfaces to enrich.
- `zoho-middleware/routes/catalog.js` (~L527, L851, L1002) — how `cf_type` is read from the Zoho list endpoint and written into the catalog cache (the source of the metadata)
- `zoho-middleware/routes/pos-recipe.js` (~L72, L209) — recipe→invoice/snapshot path; **must keep working unchanged** — confirms the ingredient array shape constraint in D-08

### Frontend — display surfaces (RDISP-01, RDISP-03) & reusable label map
- `js/modules/17-search-overlay.js` §`CATEGORY_DISPLAY_NAMES` (L52–73) — the label-collapsing map to promote to `js/lib/` (D-04)
- `js/admin.js` — admin recipe ingredient rendering (ingredients table; recipe detail view)
- `js/brewpad.js` §`buildRecipeIngredientTable` (~L3024) — BrewPad recipe ingredient table to convert to grouped rendering
- `js/kiosk.js` + `zoho-middleware/routes/pos-recipe.js` — kiosk recipe ingredient presentation
- `js/lib/constants.js`, `js/lib/utils.js` — existing shared-module home for the new grouping helper + promoted label constants

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `CATEGORY_DISPLAY_NAMES` (search-overlay): collapses subcategory values to friendly labels (Grain→"Grains", Bottle+Bag→"Packaging"). Promote to `js/lib/` and reuse for section headers (D-04).
- `enrichWithComputedPrice` / `enrichListPrices` in `recipes.js`: already iterate every ingredient and look it up in the catalog cache by `item_id` — the natural place to also attach `cf_type`/`cf_subcategory`/label with zero extra catalog round-trips.
- `js/lib/` shared-module pattern (utils.js, constants.js, auth.js): established home for the one shared grouping helper that admin/kiosk/BrewPad all call (D-09).

### Established Patterns
- ES5 / `var` throughout; frontend modules in `js/modules/` concatenated into `js/main.js` by `npm run build` (never edit `main.js`/`main.min.js` directly).
- Catalog metadata source of truth = `ingredients-cache.json` / Redis `INGREDIENTS` cache key; recipe routes already fall back to the file cache when Redis is cold (mirror this for the grouping cold-cache fallback, D-07).
- Frontend modules export pure helpers via `if (typeof module !== 'undefined' && module.exports)` for Jest — the new grouping helper should follow this so it's unit-testable.

### Integration Points
- Server: ingredient enrichment added inside the existing catalog-match loops in `recipes.js` (both list and detail endpoints).
- Client: one shared grouping helper consumed at three call sites — admin recipe view, `buildRecipeIngredientTable` (BrewPad), kiosk recipe ingredient render.
- **Constraint:** ingredient array shape consumed by `lib/pricing.js` + `recipe_snapshot` (via `pos-recipe.js`) must not change — enrichment is additive only.

</code_context>

<specifics>
## Specific Ideas

- Section labels should match site-wide customer-facing labels (via `CATEGORY_DISPLAY_NAMES`), not raw Zoho field values.
- Header format: "Label (count)" e.g. "Hops (4)", all expanded.
- Brewing-process section order is intentional staff-readability, not alphabetical/count-based.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope. Batch scaling, add/remove/substitute, and BrewPad recipe builder surfacing are already scoped as later v4.3 phases (35+), not deferrals.

</deferred>

---

*Phase: 34-ingredient-display-server-enrichment*
*Context gathered: 2026-06-19*
