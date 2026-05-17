# Phase 15: BeerXML Import - Context

**Gathered:** 2026-05-17
**Status:** Ready for planning

<domain>
## Phase Boundary

Staff can import a recipe from any BeerSmith-compatible .xml export rather than entering every ingredient manually, with a mandatory review step before any data is saved. The import pre-fills the existing recipe editor form — it does NOT create a separate import workflow.

</domain>

<decisions>
## Implementation Decisions

### Upload & Parsing Location
- **D-01:** Browser-side parsing using DOMParser. No file upload to the middleware. The XML is parsed entirely in the browser JS, ingredients are extracted, and the final mapped recipe is sent to the existing `create_recipe` API via the middleware.
- **D-02:** File size validation (500KB max) and basic XML well-formedness check happen client-side before parsing. Malformed or oversized files show a clear error message.

### Import Entry Point
- **D-03:** "Import from BeerXML" button lives inside the admin recipe editor (Recipes tab), alongside the existing "New Recipe" button. Clicking it opens a file picker, parses the XML, and pre-fills the recipe form (name, style, ABV, batch size, ingredients). Staff reviews and saves like any manual recipe.
- **D-04:** No import from the kiosk — admin panel only. Kiosk recipe editor is a future feature (deferred).

### Ingredient Matching UX
- **D-05:** Auto-match each parsed ingredient against the Zoho ingredient catalog using fuzzy name matching. Reuse the existing `filterIngredientCatalog()` function in admin.js.
- **D-06:** Show a review table after parsing: BeerXML ingredient name → best Zoho match + confidence indicator. Staff can accept, change (via search dropdown reusing existing pattern), or skip/remove each row. Unmatched items flagged visually.
- **D-07:** All matches must be confirmed by staff before saving — no silent auto-save. The review table IS the mandatory review step required by the success criteria.

### Unit Handling
- **D-08:** Auto-convert all weights to kg (grains, fermentables) or g (hops, small additions). BeerXML AMOUNT field is in kg per spec, but detect and convert if values appear to be in lbs.
- **D-09:** Show both original BeerXML value and converted value in the review table so staff can verify the conversion is correct.
- **D-10:** Yeast items use "pcs" as unit (1 packet = 1 pcs). Misc items keep their BeerXML unit or default to g.

### Claude's Discretion
- **BeerXML element mapping:** Claude decides which BeerXML elements to extract (FERMENTABLES, HOPS, YEASTS, MISCS) and how to map them to the recipe schema fields (name, style, abv from RECIPE element; ingredients from sub-elements).
- **Fuzzy matching algorithm:** Claude decides the matching approach — could be simple substring/includes, Levenshtein distance, or a scoring heuristic. Should produce reasonable matches for common brewing ingredients (e.g., "Pale Malt 2-Row" → "Gambrinus Pale Malt").
- **Review table layout:** Claude designs the mapping review table. Should be scannable, with clear accept/change/skip actions per row.
- **Error handling:** Claude decides how to handle BeerXML files with multiple recipes (import first recipe only? Let staff choose?), missing fields, or unusual ingredient types.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### BeerXML Spec
- No local spec — BeerXML 1.0 format is documented at beerxml.com. Key elements: RECIPES > RECIPE (name, style, est_abv, batch_size), FERMENTABLES > FERMENTABLE (name, amount in kg), HOPS > HOP (name, amount in kg), YEASTS > YEAST (name, amount), MISCS > MISC (name, amount).
- AMOUNT is always in kg (BeerXML spec). DISPLAY_AMOUNT is localized string — do NOT use.

### Existing Recipe CRUD
- `zoho-middleware/routes/recipes.js` — create_recipe, update_recipe, get_recipe API
- `js/admin.js` — `openRecipeDetail()`, `saveRecipe()`, `addIngredientRow()`, `filterIngredientCatalog()` functions in the recipe IIFE section

### Requirements
- `.planning/REQUIREMENTS.md` — IMP-01 through IMP-04

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `filterIngredientCatalog(query)` in admin.js — fuzzy ingredient search against Zoho catalog. Returns matching items. Reuse for auto-matching parsed BeerXML ingredients.
- `addIngredientRow()` in admin.js — adds an ingredient row to the recipe editor form. Can be called programmatically to pre-fill from import.
- `openRecipeDetail(null)` — opens a blank recipe form. Import flow should call this first, then populate fields.

### Established Patterns
- Recipe form fields: name, style, description, batch_size_l, abv, ibu, colour_srm, locked_price, service_fee, materials_fee, pricing_mode, status, ingredients[]
- Each ingredient row has: item_id (Zoho), item_name, quantity, unit
- `saveRecipe()` sends the full form payload to `POST /api/recipes` (create) or `PUT /api/recipes/:id` (update)
- File input pattern: no existing file upload in admin.js — this would be the first

### Integration Points
- The import button goes next to the existing "New Recipe" button in the Recipes tab
- Parsed recipe data flows into the same form fields as manual entry
- Ingredient mapping uses the same Zoho catalog (fetched via middleware) that the manual ingredient search uses

</code_context>

<specifics>
## Specific Ideas

No specific requirements — open to standard approaches for XML parsing and fuzzy matching.

</specifics>

<deferred>
## Deferred Ideas

- **Kiosk inline recipe editor** — full recipe create/edit form in kiosk.html (noted from Phase 14 discussion)
- **Kiosk BeerXML import** — import from the kiosk page, not just admin

None — discussion stayed within phase scope

</deferred>

---

*Phase: 15-beerxml-import*
*Context gathered: 2026-05-17*
