# Phase 89 — Beer category field for recipes: pre-planning notes

Recorded 2026-10-14 from the owner session that created this phase. Input for
`/gsd:discuss-phase 89` / `/gsd:plan-phase 89`. Line numbers were verified on
2026-10-14 and will drift.

## Why

Beer kit cards are coloured by `getTintClass` (`js/modules/04-label-cards.js:3`)
from a kit's `tint` or single-word `subcategory`. Beer **recipe** cards
(`buildRecipeCard`, `js/modules/07-catalog-kits.js:205`) were never wired to
it, so all 11 render default gold. Recipes only have a free-text `style`
("Dry, piney American IPA"). Keyword inference was rejected by the owner as a
maintenance trap → an explicit, settable field instead.

## Owner decisions so far

- Run as a GSD phase (not ad hoc).
- Field is explicit and settable by staff; no keyword inference.
- Not yet decided — confirm in discuss-phase:
  - Field name (working: `beer_category`) and whether it is also shown/filterable on beer.html.
  - Allowed values: working list = the 12 existing beer tint keys
    `pilsner lager pale ipa amber wheat session saison stout porter redale brown`
    (CSS `.tint-*`, `css/styles.css` ~4417–4428). A new value needs a new CSS class.
  - Initial values for the 11 active recipes. Suggested mapping (owner to confirm):
    IPA: West Coast IPA, NZ East Coast IPA · pale: Hazy Pale Ale · pilsner: German Pilsner ·
    lager: Czech Lager, American Lager, Munich Helles, Oktoberfest, Bavarian Style Lager ·
    brown: English Mild, Czech Dark Lager. (Five lagers share one colour — owner may prefer to split.)
  - Owner approval is REQUIRED before editing the ~13 existing tests that pin the recipe
    field set (CLAUDE.md rule 10). Not yet given.

## Touchpoint map (9 layers)

Two layers silently drop the field if missed: the Apps Script writers and the public allowlist.

1. **Apps Script** `apps-script/adminApi.gs`
   - Add `ensureRecipesBeerCategoryColumn` like `ensureRecipesPricingModeColumn` / `ensureRecipesScheduleIdColumn` (:4161–4194), plus a normaliser like `normalizePricingMode` (:4172).
   - `createRecipe` (:4196–4250) appends 16 positional columns; write the field by header lookup like `pricing_mode` / `schedule_id` (:4242–4250).
   - `updateRecipe` (:4297–4400): call the ensure helper before reading the row (:4338–4340, see comment :4329–4337); add to `stringFields` (:4362) or special-case like `pricing_mode` (:4388).
   - `getRecipes` / `getRecipeDetail` pass all headers through (`sheetToObjects`); 300s `gr:*` cache.
   - `mirrorRecipeState` (:4692–4760, PG→sheet mirror + replay) builds rows ONLY from existing sheet headers (:4720–4725) → value silently dropped unless the column exists; add the ensure call near :4717.
   - Optional: `setupRecipeTabs` hard-coded headers (:5181–5197).
   - **Needs an owner Apps Script redeploy.** One deployment serves staging AND production, so it goes live in prod immediately (additive column; old prod code ignores it). Record the rollback version.
2. **Postgres** `zoho-middleware/lib/recipe-pg.js`
   - `RECIPE_COLUMNS` (:24–28, 18 names in sheet order — append last); drives selects + `rowToRecipe`.
   - `INSERT_RECIPE_SQL` (:64–67, `$1..$16`, `$13` reused) → add `$17`; `createRecipe` (:181–251) params.
   - `UPDATE_STRING_FIELDS` (:90) or special-case like `pricing_mode` (:323).
   - Normaliser candidate: `lib/recipe-rules.js` (home of `normalizePricingMode`).
3. **Migration** new `migrations/0006_<name>.sql` (`-- Up Migration` / `-- Down Migration`).
   `alter table recipes add column beer_category text check (...)`. `migration-allowlist.js:119–127`
   allows only AddColumn / AddConstraint / ValidateConstraint / SetNotNull / ColumnDefault(set);
   no backslashes, DO, functions, UPDATE/DELETE, bare SELECT in Up → no data backfill in the migration.
4. **Backfill / verify** `zoho-middleware/scripts/backfill/`
   - `specs/recipes.js:35–54` add `txt('beer_category', false)`.
   - TRAP: `recipes-backfill.js:126–131` `headerRejects` treats ANY spec header missing from the
     sheet as a reject (even optional) → whole Recipes sheet fails. The sheet column must exist
     before the spec ships — matters for the Phase 85 production cutover (85-13).
   - `recipes-verify.js:34–38` `RECIPE_FIELDS` compare list — add it.
   - `recipes-replay-to-sheet.js` needs no change (relies on the Apps Script ensure).
5. **Public API** `zoho-middleware/routes/recipes.js`
   - `PUBLIC_RECIPE_FIELDS` (:54) + `toPublicRecipe` (:63–80) build-by-allowlist → must add it or
     beer.html never sees it. Comments :49–62 record the deliberate public-boundary decision.
   - POST/PUT (:729–812) pass the body through; enum validation belongs in recipe-pg + Apps Script.
6. **Mirror / dual compare** `lib/recipe-mirror.js:104–127` sends full PG state (rides along once
   `RECIPE_COLUMNS` has it). Live D-05 dual compare is price-only; field compare is only `recipes-verify.js`.
7. **Editors**
   - BrewPad: `brewpad.html:184–207` add a `<select>`; `js/brewpad.js` `buildRecipePayload` (:776–795),
     `populateRecipeForm` (:2740–2755), `readRecipeFormData` (:3368–3384), `bpCloneRecipePayload` (:3055–3070).
   - Admin: `admin.html:571–597`; `js/admin.js` `populateRecipeForm` (:8678–8695), `saveRecipe` (:9050–9066).
   - Kiosk reads only name/style/abv — no change.
8. **Beer page** `buildRecipeCard` (`07-catalog-kits.js:205`): add the tint class via
   `getTintClass({ tint: recipe.beer_category })`. Rebuild `main.js` / `main.min.js` (never hand-edit).
   Readable subtitle shades already exist per tint (`--tint-text`, commit `ab8a0347`).
9. **Tests pinning the field set (need owner OK to edit):**
   `__tests__/backfill/recipes-spec-headers.test.js:13–28`, `backfill/recipes-backfill-plan.test.js:80`
   (18 keys), `db/recipe-pg-read.test.js:29–34, :83–97`, `fixtures/recipes-sheet-shape.json`,
   `recipe-d09-runtime-parity.test.js:26–28`, `tests/frontend/adminapi-recipe-mirror.test.js:16–21, :241–248`,
   `tests/frontend/adminapi-recipe-schedule-column.test.js:104–108`,
   `recipes-public-guard.test.js:148, :226, :292` (ALLOWED_PUBLIC_FIELDS),
   `tests/frontend/catalog-recipe-block.test.js:68–71` (asserts className exactly `label-beer`).
   Likely touched: `backfill/recipes-verify.test.js`, `db/recipes-backfill.test.js`,
   `db/recipes-migration.test.js`, `db/recipe-pg-create|update` tests,
   `tests/frontend/brewpad-recipe-list-clone.test.js`, `brewpad-recipes.test.js`.

## Suggested order

1. Apps Script ensure-column + writers → owner redeploy (column appears on the shared sheet).
2. Migration 0006 (staging first).
3. recipe-pg + backfill spec/verify.
4. Public allowlist.
5. Editors + beer card; rebuild bundles.
6. Staging: re-backfill recipes (staging dual never mirrors from the sheet — see the
   2026-10-14 refresh procedure in docs/RUNBOOK.md Phase 85 + memory `phase-85-recipes-status`),
   set categories, UAT the colours.
7. Production rides the Phase 85 cutover or the next promotion.

## Related state (same session, 2026-10-14) — not part of this phase

- Staging recipe store was re-backfilled 2026-10-14 (13 recipes / 145 ingredients, verify 0 mismatches).
- Custom-recipe closing card on the beer grid: `7713dcd3` (staging).
- Readable beer card subtitles (`--tint-text`): `ab8a0347` (staging).
- Beer launch is staged on LOCAL branch `beer-launch` (not merged/pushed); needs a stamp-conflict refresh.
