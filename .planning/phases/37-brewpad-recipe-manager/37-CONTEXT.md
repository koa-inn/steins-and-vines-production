# Phase 37: BrewPad Recipe Manager - Context

**Gathered:** 2026-06-20
**Status:** Ready for planning

<domain>
## Phase Boundary

Bring recipe **browse / view / create / edit** (and, per discussion, activate + delete) into BrewPad — the recipe builder is no longer admin-only. Reuse the existing recipe CRUD endpoints and the activation guardrails (`locked_price > 0` AND ≥1 ingredient) rather than building a parallel path. Delivers BPR-01 (browse/view the recipe catalogue from within BrewPad) and BPR-02 (create/edit recipes from within BrewPad).

This phase is about **surfacing recipe management inside BrewPad's iPad/PWA UI**. It does NOT change the recipe data model, the server-authoritative pricing/money path, or the recipe CRUD endpoints themselves.

</domain>

<decisions>
## Implementation Decisions

### Placement & Navigation
- **D-01:** Recipes is a **new 5th bottom tab** in BrewPad — Dashboard / Batches / Tasks / Readings / **Recipes** — following the existing `.bp-tab` (`data-tab`) + `bp-panel-{name}` panel pattern. It is browsable on its own, not buried inside the batch recipe-attach flow.

### Editor Approach
- **D-02:** **Port admin's existing recipe builder** (logic + markup) into a BrewPad-styled panel, re-skinned for BrewPad's touch/iPad UI. Reuse the same validation rules, ingredient autocomplete, and the same middleware recipe CRUD endpoints. Do NOT fork a second, divergent editor model — keep behavior consistent with admin so there is one source of truth for "how a recipe is built."

### Action Scope
- **D-03:** BrewPad supports the **full recipe lifecycle: browse, view, create, edit, activate, AND delete.** Reuse `GET/POST/PUT/DELETE /api/recipes` and the activation guardrail. (Delete was explicitly added beyond the roadmap's "browse/view/create/edit" wording.)
- **D-04:** Because BrewPad runs on a shared iPad, **delete (and any destructive action) must route through BrewPad's existing confirm-sheet pattern** before executing — no one-tap deletes.

### Field Scope & Validation
- **D-05:** **Full metadata parity with admin** — name, style, abv, ibu, batch size, pricing mode (locked/dynamic), locked price, ingredient rows with catalogue autocomplete, and notes. No feature gap vs the admin recipe builder.
- **D-06:** The **activation guardrail (`locked_price > 0` AND ≥1 ingredient) is surfaced inline** — the Activate control is disabled with a hint until the recipe satisfies it. The server still validates on `PUT /api/recipes/:id`; the inline check is UX, not the authority.

### Claude's Discretion
Deferred to research/planning against existing BrewPad patterns:
- Delete-confirm UX specifics (copy, double-confirm vs single confirm-sheet).
- Offline behavior for recipe writes — BrewPad is a PWA with an offline cache, but create/edit/activate/delete are network writes; require connectivity and surface a clear error when offline (mirror existing `adminApiPost` / authenticated-fetch behavior).
- Recipe-list cache invalidation after a write — reuse `POST /api/recipes/bust-cache` then refresh the list.
- The recipe **detail view** should display ingredients grouped via the Phase 34 `groupRecipeIngredients` helper (already loaded on `brewpad.html`) for consistency with admin/kiosk.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase scope & requirements
- `.planning/ROADMAP.md` — Phase 37 goal + the 2 success criteria (browse with draft/active status + search; detail view with grouped ingredients).
- `.planning/REQUIREMENTS.md` — BPR-01, BPR-02, and the activation guardrail definition (`locked_price > 0` and ≥1 ingredient before activation). Note the "Out of Scope / Future Requirements" lists (recipe versioning/history is explicitly deferred).

### Prior-phase context this builds on
- `.planning/phases/34-ingredient-display-server-enrichment/34-CONTEXT.md` — grouping decisions (D-09 single source of truth) that the BrewPad recipe detail view should honour.
- `.planning/phases/34-ingredient-display-server-enrichment/34-03-SUMMARY.md` — `recipe-grouping.js` + `groupRecipeIngredients` are already loaded on `brewpad.html`; BrewPad's recipe_snapshot now carries `cf_type`/`cf_subcategory`/`display_group`.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **Admin recipe builder** (`js/admin.js`, `_recipesState` at ~L8443+): `loadRecipeList` / `renderRecipeList` / `showRecipesListView` (browse), `renderIngredientRows` + `attachIngredientRowListeners` (editable ingredient table with autocomplete), `loadIngredientCatalogForRecipes` (catalogue for autocomplete), and the save/activate flow. This is the logic to port.
- **Recipe CRUD endpoints** (`zoho-middleware/routes/recipes.js`): `GET /api/recipes` (list, `?status=`), `GET /api/recipes/:id` (detail, now enriched), `POST /api/recipes` (`create_recipe`), `PUT /api/recipes/:id` (`update_recipe`, parses/validates `locked_price`), `DELETE /api/recipes/:id`, `POST /api/recipes/bust-cache`.
- **Grouping helper** (`js/lib/recipe-grouping.js`): `groupRecipeIngredients` — already loaded on `brewpad.html`; reuse for the recipe detail view.

### Established Patterns
- **BrewPad tab/panel model:** `.bp-tab[data-tab]` buttons in `.bp-tab-bar`, `#bp-panel-{name}` panels toggled by the tab handler (`js/brewpad.js` ~L1495). A new Recipes tab + `#bp-panel-recipes` follows this exactly.
- **Authenticated middleware calls in BrewPad:** `mwUrl()` / `mwApiKey()` helpers; mutating writes via `adminApiPost(...)` or `fetch` with `x-api-key`.
- **Destructive-action confirm:** BrewPad confirm-sheet (e.g. `bp-confirm-sheet`) — use for delete (D-04).
- **ES5 / `var` throughout;** `escapeHTML` (`js/lib/utils.js`) wraps all dynamic HTML; never hand-edit `main.js`/`main.min.js` (BrewPad is a standalone `js/brewpad.js` bundle, minified to `brewpad.min.js` by `npm run build`).

### Integration Points
- `brewpad.html`: add the 5th tab button to `.bp-tab-bar` and a `#bp-panel-recipes` panel; `recipe-grouping.js` is already script-loaded.
- `js/brewpad.js`: new recipes panel render + editor (ported from admin), wired into the existing tab switch + `renderDashboard`-style panel init.

</code_context>

<specifics>
## Specific Ideas

- The BrewPad editor should **match admin's recipe-builder behavior and validation**, just re-skinned for BrewPad's touch UI — staff shouldn't have to learn a different recipe-building flow on the iPad.
- Recipe **detail view groups ingredients** using the Phase 34 helper (consistent labelled sections with admin/kiosk).
- Browse list shows **draft / active status indicators** and **search/filter by name** (from the ROADMAP success criteria).

</specifics>

<deferred>
## Deferred Ideas

- **Recipe versioning / edit history** — explicitly in REQUIREMENTS.md "Future Requirements (deferred to a later milestone)." Not this phase.
- **Per-ingredient scaling overrides / unit conversion / customer-facing recipe config** — future-milestone items per REQUIREMENTS.md.
- Delete-confirm copy, offline-write handling, and cache-bust timing are implementation details for research/planning, not new capabilities.

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 37-brewpad-recipe-manager*
*Context gathered: 2026-06-20*
