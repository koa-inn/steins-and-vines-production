# Phase 73: Recipe dynamic pricing unit-conversion correctness - Context

**Gathered:** 2026-08-25
**Status:** Ready for planning

<domain>
## Phase Boundary

Make recipe ingredient-cost math **unit-aware** across every place ingredient cost is summed, so the dynamic recipe price can no longer multiply `item.rate` (per Zoho stock unit) by `recipe_line.quantity` (recipe unit) without conversion. One shared helper computes each line's cost with unit conversion (mass g↔kg, volume ml↔L, count pass-through) and is called from all sum-sites so **quote = displayed `computed_price` = actual sale invoice = stock draw-down** can never diverge. Also resolve multi-unit pack-item granularity and add save-time unit validation.

**In scope:** unit-aware cost helper + wiring it into all sum-sites; pack-granularity resolution; fail-closed on non-convertible pairs; apps-script save-time unit validation; **recipe-editor save resilience so failed saves never orphan in-progress work (D-05, folded in per owner request 2026-08-25);** regression tests (helper units, `SV-R-000004` ≈ $88–95, quote==sale, converted stock draw-down, editor draft-preserve/restore).

**Out of scope (owner data actions, not code):** confirming the SafLager sale price in Zoho ($10/sachet — computes correctly, not an engine bug); catalog-wide Zoho unit normalization; the Kits-sheet negative retail_instore row (separate pricing-data todo).
</domain>

<decisions>
## Implementation Decisions

### Pack-granularity model (root cause B)
- **D-01:** Resolve multi-unit pack items by **redefining the sellable/recipe item per-unit in Zoho** (Whirlfloc → unit `pcs` = 1 tablet, rate ≈ $0.32; purchases received in packs of 25 via a purchase-side conversion). Once per-unit, the item prices correctly as `pcs × pcs` with no engine special-case. The **invalid `L` unit on the Whirlfloc recipe line must be fixed regardless** (a tablet is a count, not a volume). Note: the Zoho item redefinition + purchase-receiving conversion is an **owner data action**; the code side must (a) not assume pack semantics and (b) let the save-time validator (D-03) reject the `L`-on-a-count mismatch.

### Non-convertible unit/rate pairs (root cause A safety)
- **D-02:** **Fail closed.** When a recipe line's unit cannot be converted to the item's stock unit (e.g. recipe `g` vs item `pcs`), the engine must **refuse to produce a price** for that line — flag/error, never a silent best-effort product. A recipe with any un-priceable line cannot be quoted or sold until fixed. Follow the **Phase 67 tax fail-closed precedent**: the error must **name the offending ingredient line** (item + units) so staff/owner can fix it, mirroring how unresolvable tax fails closed naming the item. This applies identically on the kiosk quote, the displayed `computed_price`, and the pos-recipe sale path.

### apps-script save-time validation (scope)
- **D-03:** **In scope for this phase.** Add unit validation/normalization to `apps-script` `createRecipe`/`updateRecipe` so an un-convertible unit/rate mismatch (a per-kg item saved with a raw-gram quantity, or a tablet counted as `L`) is **caught or auto-normalized to the item's unit at write time**, closing the loop end-to-end rather than only fixing the read/compute path.

### Interim mitigation
- **D-04:** **Leave `SV-R-000004` as `draft`** (its current state) — no interim data edits. Draft recipes can't be sold, so the exposure is contained; the fix will recompute it to ~$88–95. Do NOT set `locked_price` or hand-edit BrewPad line units as a workaround.

### Recipe-editor save resilience (folded in — owner request 2026-08-25)
- **D-05:** **In scope for this phase.** The recipe editor (BrewPad `saveRecipe()`, `js/brewpad.js:2644-2702`) must never orphan in-progress work when a save fails. This is tightly coupled to D-03: the new save-time unit validation *adds* a reason for saves to fail (422), so hardening the failure path ships together. Sub-decisions:
  - **D-05a (draft preservation):** Register the `bp-recipe-*` editor form in the existing `_formSavers` session-draft system (`js/brewpad.js:772`; siblings registered at `8705/8767/8787/8820/8864`, key e.g. `sv-brewpad-recipe-draft`, guarded on `#bp-recipes-detail-view` visibility, restored via `populateRecipeForm` + `renderIngredientRows`). Today the recipe editor is the ONLY major BrewPad form NOT registered, so a session-expiry/reload after editing loses the recipe edits while every other form is protected. Also snapshot on **save-failure**, not only on 401/session-expiry.
  - **D-05b (correct failure detection):** `saveRecipe()` currently ignores HTTP status — it calls `r.json()` without checking `r.ok` and only errors on `!data.ok && data.error`. It must treat non-2xx as failure so a 422/502 can't be misread as success.
  - **D-05c (non-destructive save contract):** The middleware save path must fail **before** any Apps Script write when D-03 validation rejects (no partial write), and surface a clear named error. Recipe error bodies today are `{ error: <string> }` with no machine-readable code (`recipes.js` 376-427) — add a machine-readable `code`/`cause` alongside the human string so the frontend can react precisely (preserve-draft + highlight offending line) instead of only toasting.
  - **D-05d (retry):** Offer a retry affordance on transient/network (502) failures without forcing the user to re-enter the form.
- Regression coverage for D-05: a failed save preserves + restores the editor draft (sessionStorage round-trip); non-2xx is surfaced as an error; a validation reject (D-03) does not partial-write.

### Imperial unit handling (owner decision 2026-08-25 — planner audits live data first)
- **D-06:** The conversion families in scope are mass `g↔kg`, volume `ml↔L`, count `pcs/ea/pack`. Imperial units (oz/lb/tsp/tbsp…) are recognized elsewhere in `recipe-scaling.js` but are **out of the stated conversion scope**. **The plan MUST include a task to audit actual recipe-line units in the live sheet/cache first.** If no live recipe uses an imperial unit on a cost line → **fail closed on imperial** (D-02 shape, name the line). If real recipes do use imperial → add imperial→metric conversion (oz→g 28.35, lb→kg 0.4536, tsp/tbsp→ml) so those lines price instead of becoming un-sellable. Do not silently guess — decide from the data.

### Claude's Discretion
- Exact home/signature of the shared helper (`ingredientLineCost(item, line)` in `lib/recipe-scaling.js` is the strong candidate — it already sums recipe cost) and the conversion table structure — planner/executor decide, provided all sum-sites call the one helper.
- Whether save-time validation (D-03) **rejects** vs **auto-normalizes** per case — executor's judgment, but it must never let an un-priceable recipe be saved as sellable.
- Exact draft-restore UX for D-05 (auto-restore on re-open vs a "restore unsaved changes?" prompt) — executor's judgment, reusing the existing `_formSavers`/`restoreAllFormDrafts` machinery rather than inventing new persistence.
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase 73 bug diagnosis (authoritative)
- `.planning/phases/73-recipe-dynamic-pricing-unit-conversion-correctness-unit-awar/73-PRICING-BUG-HANDOFF.md` — full symptom, root causes A + B, per-line evidence table for `SV-R-000004`, suggested fix, tests, and acceptance criteria. **The spec for this phase.**

### Money-path fail-closed precedent to mirror
- `.planning/phases/67-kiosk-tax-quote-charge-correctness-pre-charge-total-assertio/` — Phase 67 established the fail-closed-and-name-the-item pattern (quote==charge, no silent fallback). D-02 mirrors it. See its SUMMARY/VERIFICATION for the pattern.

### Project rules
- `CLAUDE.md` — money-path rules: write regression test FIRST (rule #3), one logical change per commit (#4), after changing shared utilities run FULL frontend + middleware suites (#7), `cd zoho-middleware` for middleware commands (#13).

*(No external ADRs; requirements fully captured in the handoff + decisions above.)*
</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `zoho-middleware/lib/recipe-scaling.js` — already sums recipe ingredient cost + fees (`total += service_fee + materials_fee`, ~L148). **Strong candidate home** for the shared unit-aware `ingredientLineCost(item, line)` helper.

### Sum-sites that must all call the shared helper (code-confirmed 2026-08-25)
- `zoho-middleware/routes/recipes.js` — `computed_price` for list + detail (accumulates `total` then adds fees, ~L122–124 and ~L199–201).
- `zoho-middleware/routes/pos-recipe.js` — the pos-recipe **sale** path building Zoho invoice lines + stock draw-down (`line_total: scaledQty * rate`, ~L478; fees ~L671–672/L728).
- `GET /api/kiosk/recipe-quote` — the kiosk quote path (per handoff; confirm exact location in `routes/pos-recipe.js` / `routes/recipes.js` during planning).
- Stock draw-down must use the **same converted quantity** (12 g hop → 0.012 kg decrement, not 12 kg).

### Established Patterns
- Fail-closed money-path validation naming the offending item (Phase 67 tax pre-charge assertion) — reuse the shape for D-02.
- Recipes live in the Google Sheet via `apps-script/`; `/api/recipes` reports `source: apps-script/cache`; per-ingredient `rate`/`computed_price` enrichment is joined in the middleware.

### Integration Points
- Zoho item `unit`/`rate` join is where the conversion must happen (before `rate × quantity`).
- `apps-script` `createRecipe`/`updateRecipe` — new save-time unit validation (D-03). **NOTE (research finding):** Apps Script has NO access to the Zoho item catalog, so D-03 cost/unit-mismatch validation cannot be pure GAS — the practical, testable, sole-confirmed-live entry is the middleware `POST /api/recipes` / `PUT /api/recipes/:id` in `routes/recipes.js` (BrewPad calls only the middleware, never Apps Script directly). Add the unit-vs-catalog check there (async `cache.get(INGREDIENTS_ALL)` before the existing synchronous D-02 activation guardrail at `recipes.js:400-414`), returning the same 422 + named-cause shape.

### Recipe-editor save path (D-05 targets — Explore scout 2026-08-25)
- **Editor app:** `brewpad.html` (standalone SPA) → `js/brewpad.js` (~9k lines) compiled to `js/brewpad.min.js`. **BrewPad is NOT part of the numbered `js/modules/*` → `js/main.js` bundle** — it has its own build output (`brewpad.min.js`); confirm its build step and re-minify after edits.
- **Save function:** `saveRecipe()` `js/brewpad.js:2644-2702` — payload via `buildRecipePayload()` (`:685`) / `readRecipeFormData()` (`:2733`); PUT `/api/recipes/:id` when `currentRecipeId` set else POST `/api/recipes` (`:2668-2672`); fetch at `:2677-2682`. **Parses `r.json()` WITHOUT checking `r.ok`** (`:2683`), errors only on `!data.ok && data.error` (`:2685`) → the D-05b defect.
- **Failure UX today:** toast-only (`showToast('Could not save recipe…','error')` `:2697`); form NOT cleared/navigated → edits survive in memory but are **lost on reload/close/session-expiry** (no `beforeunload`, no draft for this form).
- **Draft system to reuse (D-05a):** `_formSavers` array `js/brewpad.js:772`; `saveAllFormDrafts()` `:1229` (→ `sessionStorage`), `restoreAllFormDrafts()` `:1240`; fires on 401 via `handleUnauthorized()` `:1255`. Existing sibling registrations: `:8705/8767/8787/8820/8864` (batch-create, measurement grid, batch detail, gravity reading, schedule). The recipe editor form is the missing one.
- **Save endpoint contract (D-05c):** `routes/recipes.js` POST create `:376-390` (422 `{error}` on `!data.ok`, 201 `{ok,recipe_id}`, 502 on throw), PUT update `:396-427` (D-02 guardrail `:400-414`; 422/200/502). Thin proxy to Apps Script `create_recipe`/`update_recipe` — **no route-level transaction/rollback; atomicity depends on Apps Script.** Error bodies are `{ error: <string> }` (no machine-readable code — D-05c adds one).
- **Minor flag:** dead `data.recipe.recipe_id` fallback at `js/brewpad.js:4804` (route never returns that shape) — note when hardening.
</code_context>

<specifics>
## Specific Ideas

- Regression targets are pinned in the handoff: helper unit cases ($54/kg × 12 g → 0.648; $25/L × 20 ml → 0.50; $10/pcs × 2 pcs → 20; incompatible pair → error, not a silent product); `SV-R-000004` `computed_price` ≈ $88–95; kiosk `recipe-quote` total == the Zoho invoice lines the pos-recipe sale produces for the same recipe/scale; stock draw-down uses converted quantities.
- Unit families: mass `g↔kg` (÷/×1000), volume `ml↔L` (÷/×1000), count `pcs/ea/pack` (no conversion). Anything cross-family = non-convertible → fail closed (D-02).
</specifics>

<deferred>
## Deferred Ideas

- **Catalog-wide Zoho unit normalization** — hop/additive units are inconsistent across the catalog (some 100 g packs are `pcs`, some `g`, bulk is `kg`, one tablet pack is `pcs`). Normalizing reduces this whole bug class but is a broader data-hygiene effort; owner data action, not this code phase.
- **SafLager sale-price confirmation** — owner to confirm intended retail per sachet in Zoho; the "too cheap yeast" is catalog pricing, not the engine.

### Reviewed Todos (not folded)
- "Correct the bad (negative) price row in the Kits sheet — retail_instore" — pricing-*data* bug in the Kits sheet, not the recipe unit-conversion *engine*; adjacent but separate. Left in backlog.
- The other 11 todo.match-phase hits (kiosk cash/MOTO, BrewPad bottled-refresh, GTM/analytics, gated-deploy, beer-waitlist cleanup, etc.) scored a flat generic 0.6 and are unrelated to recipe pricing — not folded.
</deferred>

---

*Phase: 73-recipe-dynamic-pricing-unit-conversion-correctness-unit-awar*
*Context gathered: 2026-08-25*
