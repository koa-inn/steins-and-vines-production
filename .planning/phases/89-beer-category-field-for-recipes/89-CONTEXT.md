# Phase 89: Beer category field for recipes - Context

**Gathered:** 2026-10-14
**Status:** Ready for planning

<domain>
## Phase Boundary

Staff set an explicit, optional `beer_category` on each recipe in BrewPad and admin. Every recipe card
(`buildRecipeCard`) is coloured from it via `getTintClass`, replacing the current all-gold rendering.
The field round-trips through every recipe layer: Apps Script (sheet column, create/update, PG→sheet
mirror), Postgres (additive migration 0006 + `recipe-pg`), backfill spec + verify, the public recipe
API allowlist, both editors, and the card builder. No keyword inference from the free-text `style`
(owner rejected it as a maintenance trap). The layer-by-layer touchpoint map is in `89-NOTES.md`.

</domain>

<decisions>
## Implementation Decisions

### Carried forward (do not re-open)
- Explicit staff-set field; no inference from `style` (owner, 2026-10-14).
- Phase 85 store rules apply: in `dual`, Postgres is authoritative and the sheet is a state-copy mirror
  (85 D-01/D-02); migrations are additive only (83 D-04); one Apps Script deployment serves staging
  AND production. A redeploy goes live in prod immediately, so record the rollback version.

### Field and allowed values
- **D-01:** The field name is `beer_category`. It is beer-specific on purpose and must not be named
  `category` (it would collide with the Zoho `category`/`_zoho_category` already read in
  `07-catalog-kits.js:42`) or `tint`.
- **D-02:** The allowed values are exactly the 12 existing beer tint keys: `pilsner lager pale ipa amber wheat
  session saison stout porter redale brown`. There are no new CSS classes and no new lager colours.
  Several lagers share the `lager` colour, which is accepted.
- **D-03:** Enforcement is **app-level only**. One shared normaliser in the middleware
  (`zoho-middleware/lib/recipe-rules.js`, next to `normalizePricingMode`) plus a matching Apps Script
  normaliser. The Postgres column is plain nullable `text` with **no CHECK constraint**. Reason: the
  deploy migration allowlist forbids `DROP CONSTRAINT`, so a CHECK would make extending the list
  later a manual migration.
- **D-04:** Off-list values are **normalised, then rejected**. Normalise by trimming, lowercasing and
  stripping non-letters (`'IPA'`→`ipa`, `'Red Ale'`→`redale`). If the result is still not on the list,
  reject the save with a clear 400 (middleware) or error (Apps Script). Empty or blank stores as
  blank/null and is valid.
- **D-05:** The field is optional everywhere. It is never required, including for `status: active`.

### Initial values (the 11 active recipes)
- **D-06:** The confirmed mapping:
  - `ipa`: West Coast IPA (SV-R-000011), NZ East Coast IPA (SV-R-000013)
  - `pale`: Hazy Pale Ale (SV-R-000003)
  - `pilsner`: German Pilsner (SV-R-000010), Czech Lager (SV-R-000002)
  - `lager`: Munich Helles (SV-R-000006), Bavarian Style Lager (SV-R-000016),
    Oktoberfest (Festbier) (SV-R-000008), American Lager (SV-R-000004)
  - `brown`: English Mild (SV-R-000001), Czech Dark Lager (SV-R-000007)
  - The 2 non-active recipes stay blank.
- **D-07:** Values are set **by staff in BrewPad**. There is no seeding script and no data step in the
  migration. Setting them on staging is part of the UAT (it also exercises the editor end to end).
  The same picks are made on production after the release.

### What customers see
- **D-08:** The category shows as **colour only**. The card gets the tint class
  (`label-beer tint-<key>`) and no visible category tag or label. Existing per-tint `--tint-text`
  subtitle shades (`ab8a0347`) apply.
- **D-09:** A blank category means **default gold**: no tint class, so the card is identical to today's.
- **D-10:** The colour applies wherever `buildRecipeCard` renders. That covers beer.html and the wine.html
  `#recipe-catalog` mount, and is accepted as intended.

### Editors
- **D-11:** BrewPad (`brewpad.html` + `js/brewpad.js`) and admin (`admin.html` + `js/admin.js`) both get
  a **"Beer category" `<select>` placed immediately after the Style input**. It uses readable option
  names (e.g. "— None (gold) —", "IPA", "Pale ale", "Pilsner", "Lager", "Red ale", "Brown", …) and
  stores the key. There is no colour swatch. Populate, read, save, and BrewPad clone must all carry it.

### Pinned tests (CLAUDE.md rule 10 approval)
- **D-12:** The owner **approves editing existing tests, limited to the field set**. Allowed edits are:
  adding `beer_category` to pinned field lists and fixtures (spec headers, the 18-key backfill plan,
  `RECIPE_COLUMNS` reads, the sheet-shape fixture, D-09 parity, the adminapi mirror and schedule-column
  tests, `ALLOWED_PUBLIC_FIELDS`), and widening the `catalog-recipe-block` className assertion to allow
  the tint class. No other assertion may be weakened or removed. Each edited test must be named in
  the plan. The list is in `89-NOTES.md` §9.

### Production timing
- **D-13:** Phase 89 reaches production **after the 85-13 cutover, as its own promotion**. It is NOT
  bundled into 85-13. The owner first chose to bundle, then changed to this after these facts were
  raised:
  (a) the 85-13 push is pinned to `d2c66be9:main`, and current `main` carries Phase 86/87 and the gated
  kiosk money-path work; (b) migration 0006 would run in prod before 0004/0005 exist, and node-pg-migrate's
  order check would then fail the later deploy. Build and UAT happen fully on staging now.
- **D-14:** **The 85-13 backfill trap must not fire.** Once 89 changes `specs/recipes.js`, the
  `headerRejects` check (`recipes-backfill.js:126–131`) rejects the whole Recipes sheet if the prod sheet
  lacks the `beer_category` column. The plan and runbook must ensure the 85-13 production backfill
  either runs from the pinned `d2c66be9` checkout or happens after the column exists on the
  production sheet. The planner chooses the mechanism and records it explicitly in the Phase 85
  runbook notes. The planner must not change the 85-13 pin.

### Claude's Discretion
- Exact readable option labels and their order in the dropdown.
- Migration filename (`0006_<name>.sql`) and the comment wording.
- Whether `beer_category` goes in `UPDATE_STRING_FIELDS` with normalisation or is special-cased like
  `pricing_mode`, in both recipe-pg and Apps Script.
- Whether to also add the header to `setupRecipeTabs` (optional, per notes).
- Where the shared key list lives on the frontend (editors and card) to avoid three copies drifting.
- Plan and wave breakdown, following the suggested order in `89-NOTES.md`.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase scope and touchpoints
- `.planning/phases/89-beer-category-field-for-recipes/89-NOTES.md` — the 9-layer touchpoint map with
  line numbers, ordering traps, the pinned-test list and the suggested order. **Primary input.**
- `.planning/ROADMAP.md` (Phase 89 entry, ~line 1611) — the goal and the dependency on Phase 85.

### Store rules this phase must respect
- `.planning/phases/85-recipes-recipeingredients-postgres/85-CONTEXT.md` — dual-mode rules (D-01/D-02
  state-copy mirror, D-03 stale-editor rejection) that the new field rides along with.
- `zoho-middleware/scripts/migration-allowlist.js` (~:119) — the allowed ALTER operations (no DROP
  CONSTRAINT), which is the reason for D-03.
- `docs/RUNBOOK.md` (Phase 85 section, 2026-10-14 staging refresh procedure) — re-backfill staging recipes
  before UAT. Staging dual never mirrors from the sheet.

### Tint system
- `js/modules/04-label-cards.js:3` — `getTintClass` (the `tint` input path).
- `css/styles.css` ~4416–4430 — the beer `.tint-*` classes; ~4813–4825 — the `.label-beer[class*="tint-"]` rules.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `getTintClass({ tint: recipe.beer_category })` already produces `tint-<key>` for all 12 keys. No map
  change is needed.
- `normalizePricingMode` (`lib/recipe-rules.js`) and `ensureRecipesPricingModeColumn` /
  `ensureRecipesScheduleIdColumn` (`apps-script/adminApi.gs` ~:4161–4194) are the exact patterns for
  the normaliser and the ensure-column helper.
- `.label-beer[class*="tint-"]` CSS already styles border, rule, name, subtitle, price and footer per tint.

### Established Patterns
- Apps Script optional columns are written by header lookup (not by position) and ensured before reads and writes.
- The public API builds responses by allowlist (`PUBLIC_RECIPE_FIELDS`, `routes/recipes.js:54`). A field
  missing from the allowlist never reaches beer.html.
- `mirrorRecipeState` builds rows only from existing sheet headers, so the field is silently dropped
  unless the ensure call runs first.
- Build artifacts: edit `js/modules/07-catalog-kits.js`, then run `npm run build`. Never hand-edit `main.js`.

### Integration Points
- Apps Script redeploy (owner action), then migration 0006, then `recipe-pg` + backfill spec/verify, then the
  public allowlist, then the editors + card, then the staging re-backfill + UAT, then a production promotion after 85-13.

</code_context>

<specifics>
## Specific Ideas

- The pilsner (#c8a84e) and lager (#b89040) golds are near-identical. This was accepted and needs no change.
- The dropdown's blank option should say what blank means: "— None (gold) —".

</specifics>

<deferred>
## Deferred Ideas

- Filtering or grouping recipes by `beer_category` on beer.html. The recipe grid has no filters today, and
  this would be a new capability.
- A visible category tag on cards (rejected for now in favour of colour only).
- Extra lager colours (`darklager`, `festbier`), if the shared lager colour later feels flat.
- A colour swatch in the editor dropdown.

### Reviewed Todos (not folded)
- `admin-write-attribution-kiosk-middleware.md`, `beer-cider-launch-pages.md`,
  `brewpad-bottled-status-stale-ui.md`, `brewpad-ready-to-bottle-filter.md`. These were keyword-only
  matches and are unrelated to the category field.

</deferred>

---

*Phase: 89-beer-category-field-for-recipes*
*Context gathered: 2026-10-14*
