# Phase 36: Cross-Surface Selection & Recipe Modification - Context

**Gathered:** 2026-06-20
**Status:** Ready for planning

<domain>
## Phase Boundary

Take the target-volume (batch-size) control already built for the **admin** recipe-sale flow in Phase 35 and extend it to the **kiosk recipe-sale** (`js/kiosk.js`) and **BrewPad recipe-attach** (`js/brewpad.js`) surfaces with the *same* visual control + validation rules (SEL-01). The chosen size carries through the whole flow — cart line items → Zoho invoice → frozen `recipe_snapshot` → created batch record — with no re-entry at any later step (SEL-02).

On top of cross-surface selection, staff can make a **one-off ingredient modification** at recipe-selection time — **add** an item from the ingredient catalog, **remove** a line, or **substitute** one ingredient for another — for a single modified sale/batch **without mutating the saved recipe template** (MOD-01). The modified ingredient list is priced **server-authoritatively** (same `pos-recipe.js` / `lib/pricing.js` path) and frozen into the invoice + snapshot (MOD-02). Staff can optionally **save the modification as a new recipe** via the existing recipe-create endpoint (MOD-03).

**In scope:** porting the Phase 35 target-volume control to kiosk + BrewPad attach; carry-through of batch size into cart/invoice/snapshot/batch record; ingredient add/remove/substitute on all three surfaces (edit at base, then scale); server-authoritative pricing of modified lists incl. the locked-price treatment below; save-as-new-recipe.

**Out of scope:** changes to the scaling math, the locked/dynamic base formula, the control's design/validation, or the grouping helper (all locked in Phases 34/35); recipe versioning/history; customer-facing recipe config; any new BrewPad tabs beyond what recipe-attach needs.
</domain>

<decisions>
## Implementation Decisions

### Cross-surface control & carry-through (SEL-01, SEL-02)
- **D-01:** The target-volume control is added to **all three** recipe-selection surfaces — admin recipe-sale (already done in Phase 35), **kiosk recipe-sale**, and **BrewPad recipe-attach** — reusing the **identical** Phase 35 design & validation: pre-fill base `batch_size_l`, 0.5 L steps, `>0` & `≤~10× base` bounds, no-base ⇒ disabled, `"1.5× base 20 L"` readout (Phase 35 D-10/D-11). Do NOT design a second control variant — the rule is one consistent control on every surface.
- **D-02:** The chosen batch size **carries through with no re-entry**: kiosk sale → `recipe_snapshot` (already carries `target_volume_l` + `scale_factor` + `scaledIngredients` from SCALE-04) → the auto-created batch record reads the volume from the snapshot. Verify the batch-creation path (`lib/brewpad-integration.js` / Apps Script `create batch`) persists/derives `target_volume_l` onto the batch so it's never re-asked.

### Modification scope & edit/scale order (MOD-01)
- **D-03:** Ingredient **add / remove / substitute is available on all three surfaces** (admin, kiosk, BrewPad attach) — not sale-surfaces-only. (User chose "all three" over the narrower default.)
- **D-04:** **Edit at base, then scale.** Staff modify the list at the recipe's **base quantities**; the scale factor then multiplies the full modified list (linear for weight, `Math.max(1, Math.ceil())` for discrete — Phase 35 D-01/D-02). This preserves the `scaled = base × factor` invariant and reuses the existing scaling engine unchanged. The **modified base list** (pre-scale) is the canonical edit state that flows into both pricing and save-as-new (D-12).
- **D-05:** **Substitute = remove + add** at the data level; UX reuses the existing recipe-builder ingredient-row **autocomplete** (admin `js/admin.js` ingredient rows / BrewPad `attachIngredientRowListeners` + `loadIngredientCatalogForRecipes`). No new catalog-search component. (Claude's discretion on exact row UX — see below.)

### Server-authoritative pricing of modified lists (MOD-02)
- **D-06:** Modified ingredient lists price through the **same server path** as a standard sale (`pos-recipe.js` quote + confirm; the `computeRecipeQuote` helper from 35-06 drives the displayed-==-charged guarantee). The client never computes price; it sends the modified base list + `target_volume_l` and the server returns the authoritative total. Added/removed lines must be reflected in the `/api/kiosk/recipe-quote` dry-run so the displayed Add-to-Cart price already includes them.
- **D-07:** **Locked-price recipe + ADD ingredient:** charge = `locked_price × scale_factor + service_fee + materials_fee` **+ (added ingredient scaled_qty × catalog rate)`. The locked portion stays intact; each added ingredient is a transparent extra line on the invoice + snapshot.
- **D-08:** **Locked-price recipe + REMOVE ingredient:** **no credit** — `locked_price × scale_factor + fees` is unchanged. The locked price is not itemized, so a removal is a recipe tweak, not a discount. ⚠ **Intentional asymmetry** (adds cost money, removals don't refund) — margin-protective and owner-approved; surface it in UAT so staff understand it.
- **D-09:** **Dynamic-price recipe + any modification:** prices naturally as `Σ(scaled_qty × catalog rate over the modified list) + service_fee + materials_fee` (Phase 35 D-07) — adds and removals are both reflected because the dynamic total already sums the live list.

### BrewPad recipe-attach semantics (SEL/MOD on a non-sale surface)
- **D-10:** BrewPad attach **freezes the scaled + modified `recipe_snapshot`** (target volume, scale factor, scaled+modified ingredients) onto the existing batch via the current `updateBatch` path — **no pricing computation and no Helcim charge.** Attach is record-keeping for what's being brewed; the money path lives only on the admin/kiosk sale surfaces. (Extends today's minimal-snapshot attach at `js/brewpad.js` ~L3801.)
- **D-11:** On attach, the scaled-quantity **stock check is a soft advisory warning, never a hard-block** — staff may attach a recipe before restocking. (Contrast: the *sale* surfaces keep Phase 35 D-08's hard-block + manager override; attach does not charge or deduct, so it never blocks.)

### Save-as-new-recipe (MOD-03)
- **D-12:** Save stores the **modified base list (pre-scale)** at the recipe's **base `batch_size_l`** — i.e. persist the canonical edit state from D-04 directly, NOT the scaled (ceil-rounded) quantities. This yields a clean template that re-scales like any other recipe and avoids reversing discrete rounding.
- **D-13:** The new recipe is created in **dynamic** pricing mode (prices from live catalog rates). A modified ingredient set has no meaningful inherited `locked_price`, and dynamic keeps it self-consistent.
- **D-14:** Save **prompts the staff member for a name** and creates the recipe as a **draft (inactive)**; it must pass the existing **activation guardrail** (`locked_price > 0` AND ≥1 ingredient — note: dynamic recipes may need their own guardrail check, confirm) before it can go live. Uses the existing `POST /api/recipes` (`SV-R-…` ID). The **original recipe is never touched** by any modification or save action.

### Claude's Discretion
- Exact ingredient-row modification UX on each surface (inline editable rows vs an "edit ingredients" sub-panel) — reuse the closest existing recipe-builder pattern per surface; keep it touch-friendly for kiosk/BrewPad iPad.
- Where the modification affordance sits relative to the target-volume input within each surface's existing recipe-selection layout.
- Whether substitution is exposed as a distinct "swap" affordance or simply remove-then-add (D-05 treats them identically at the data layer).
- Whether the kiosk surface gates ingredient modification / manager override behind any additional staff permission (kiosk is a staff-operated in-store iPad POS; mirror admin unless research surfaces a permission boundary).
- Save-as-new activation guardrail detail for dynamic recipes (the documented guardrail is `locked_price > 0` & ≥1 ingredient, which assumes locked recipes — confirm the correct guardrail for a dynamic save against `routes/recipes.js`).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase scope & requirements
- `.planning/ROADMAP.md` §"Phase 36: Cross-Surface Selection & Recipe Modification" — goal, 5 success criteria, dependency on Phase 35.
- `.planning/REQUIREMENTS.md` — SEL-01, SEL-02 (lines ~33-34), MOD-01, MOD-02, MOD-03 (lines ~38-40) + traceability table.
- `.planning/PROJECT.md` — v4.3 milestone goal + key design decisions (locked vs dynamic scaling, server-authoritative money path must not weaken, `recipe_snapshot` frozen at sale time).

### Prior-phase context this builds directly on (READ FIRST)
- `.planning/phases/35-batch-scaling-engine/35-CONTEXT.md` — D-01..D-11: unit classification/rounding, locked formula `locked_price×factor + fees`, dynamic formula, stock hard-block + manager override, target-volume control design (pre-fill base, 0.5 L steps, bounds, no-base disable). **Phase 36 reuses all of this unchanged.**
- `.planning/phases/35-batch-scaling-engine/35-04-SUMMARY.md` — admin Kiosk-Sale UI: the `#kiosk-recipe-prompt` target-volume input + factor readout + 409 override that gets ported to kiosk + BrewPad.
- `.planning/phases/35-batch-scaling-engine/35-06-SUMMARY.md` — `GET /api/kiosk/recipe-quote` dry-run + `computeRecipeQuote` helper (displayed-==-charged guarantee, 350 ms debounce). The quote must extend to modified ingredient lists (D-06).
- `.planning/phases/34-ingredient-display-server-enrichment/34-CONTEXT.md` — `cf_type`/`cf_subcategory` enrichment + `groupRecipeIngredients` shared helper used to render ingredient lists consistently across surfaces.

### Server pricing & sale path (the code Phase 36 extends)
- `zoho-middleware/routes/pos-recipe.js` — `POST /api/kiosk/recipe-sale`, `/api/kiosk/recipe-sale/confirm`, `GET /api/kiosk/recipe-quote`, `computeRecipeQuote`. Modified ingredient lists + locked-add/remove pricing (D-06/D-07/D-08/D-09) wire in here.
- `zoho-middleware/lib/recipe-scaling.js` — unit classification + linear/ceil scaling + locked/dynamic repricing + scaled stock check (Phase 35). Modified-list pricing reuses this on the modified base list.
- `zoho-middleware/lib/pricing.js` — `computeLineItem`, `computeCartTotals`, `formatCurrency` — server-authoritative primitives for added-line pricing.
- `zoho-middleware/lib/brewpad-integration.js` — where `recipe_snapshot` is frozen and the batch is created; SEL-02 carry-through of `target_volume_l` onto the batch record lives here.
- `zoho-middleware/routes/recipes.js` — recipe CRUD incl. `POST /api/recipes` (create) + activation guardrail used by MOD-03 save-as-new; `GET /api/recipes/:id` (base `batch_size_l`, ingredient list, availability source for the stock check).

### Frontend — the three surfaces
- `js/admin.js` — admin recipe-sale (Phase 35 control already wired); ingredient-row autocomplete + `loadIngredientCatalogForRecipes` to reuse for modification. `admin.html` `#kiosk-recipe-prompt` markup.
- `js/kiosk.js` (+ `kiosk.html`) — kiosk recipe-sale (`_kioskRecipeContext`, `#kiosk-recipe-grid`/`#kiosk-recipe-prompt`, `kioskRecipePriceForContext`). Port the target-volume control + add the modification UI here.
- `js/brewpad.js` (+ `brewpad.html`) — recipe-attach flow (`bp-recipe-attach-input`/`-dropdown`, the `updateBatch` snapshot write ~L3801); recipe-builder ingredient rows (`attachIngredientRowListeners`) to reuse for modification. Add target-volume + modification + soft stock warning here.
- `js/lib/recipe-grouping.js` — `groupRecipeIngredients` (Phase 34) for consistent grouped ingredient display while editing.
- `js/lib/utils.js` (`escapeHTML`, `formatCurrency`), `js/lib/constants.js` — shared helpers; ES5/`var` throughout; never hand-edit `*.min.js` (run `npm run build`).

No external specs/ADRs — requirements fully captured in ROADMAP/REQUIREMENTS + the prior-phase CONTEXT files + the decisions above.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **Phase 35 target-volume control** (admin `#kiosk-recipe-prompt`, `js/admin.js` kiosk IIFE): the exact input + factor-readout + no-base-disable + 409-override UI to port verbatim to kiosk + BrewPad (D-01).
- **`computeRecipeQuote` + `GET /api/kiosk/recipe-quote`** (35-06): the dry-run pricing path; extend its inputs to accept a modified ingredient list so kiosk/admin show the modified price before charging (D-06).
- **`lib/recipe-scaling.js`**: scaling + locked/dynamic repricing + scaled stock check — reuse on the *modified base list* (D-04).
- **Recipe-builder ingredient rows** (admin `js/admin.js`; BrewPad `attachIngredientRowListeners` + `loadIngredientCatalogForRecipes`): editable rows with catalog autocomplete — the modification UX (D-05).
- **`POST /api/recipes`** + activation guardrail (`routes/recipes.js`): MOD-03 save-as-new reuses the existing create path (D-12/D-13/D-14).
- **BrewPad attach `updateBatch` write** (`js/brewpad.js` ~L3801): currently writes a minimal snapshot; extend to a scaled+modified snapshot, no charge (D-10).

### Established Patterns
- **Server-authoritative pricing is a hard project rule** — client may preview via the quote endpoint; the charged price + stock verdict come from the server. Modified lists must obey this.
- **Snapshot carries scaling data** (`target_volume_l`, `scale_factor`, `scaledIngredients`) since SCALE-04 — modification adds the edited ingredient set into the same frozen snapshot.
- Middleware tests mandatory (`cd zoho-middleware && npm test`); frontend Jest for pure helpers. MOD-02 / locked-add/remove pricing needs middleware unit tests (worked examples below).
- ES5/`var`, modules concatenated by `npm run build` (kiosk.js/brewpad.js are standalone bundles); `escapeHTML` wraps all dynamic HTML; never edit `*.min.js`.

### Integration Points
- `target_volume_l` + modified ingredient list flow: surface UI → `recipe-quote` (preview) → `recipe-sale` → `recipe-sale/confirm` → Zoho invoice (scaled+modified lines) → frozen `recipe_snapshot` → batch record (`brewpad-integration.js`).
- BrewPad attach: surface UI → `updateBatch` snapshot write only (no quote/charge); soft stock warning sourced from the same availability data as the sale-path stock check.
- Save-as-new: surface UI → `POST /api/recipes` with the modified base list at base volume, dynamic mode, draft status.

</code_context>

<specifics>
## Specific Ideas

- **Locked-add worked example** (test fixture): recipe `locked_price 45, service 45, materials 5`, add 1 extra hop at catalog `$4/ea`, scaled qty 1 at 1.0× → charge = `45 + 50 + 4 = $99`. At 1.5× → `67.50 + 50 + (4 × 1) = $121.50` (locked portion scales, fees flat, added line = scaled qty × rate).
- **Locked-remove**: removing an ingredient from the same recipe at any factor leaves the charge at `locked_price×factor + fees` — no credit (D-08).
- **Save-as-new at base**: a modification made at 1.5× is saved at the recipe's base volume with the *base* (pre-scale) quantities, dynamic mode, draft — re-scales cleanly next time.
- **Consistent control copy** across surfaces: same `"1.5× base 20 L"` factor readout string everywhere (Phase 35 styling).

</specifics>

<deferred>
## Deferred Ideas

- **Recipe versioning / edit history** — explicitly deferred in REQUIREMENTS.md "Future Requirements." Save-as-new creates a *new* recipe, not a version of the original.
- **Per-ingredient scaling overrides / unit conversion / customer-facing recipe config** — future-milestone items per REQUIREMENTS.md.
- **Crediting removed ingredients on locked recipes** — intentionally not done (D-08); revisit only if owner wants itemized locked pricing.

None pulled into Phase 36 from scope creep — discussion stayed within SEL/MOD scope.

</deferred>

---

*Phase: 36-cross-surface-selection-recipe-modification*
*Context gathered: 2026-06-20*
