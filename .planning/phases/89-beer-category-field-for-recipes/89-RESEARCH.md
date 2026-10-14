# Phase 89: Beer category field for recipes - Research

**Researched:** 2026-10-14
**Domain:** Additive field round-trip across a dual-store (Sheets + Postgres) recipe stack, plus a public-page card tint
**Confidence:** HIGH (every claim below was checked against the current code, and the core change was prototyped in a scratch copy of HEAD and run against both test suites and the Docker DB suite)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Carried forward (do not re-open)**
- Explicit staff-set field; no inference from `style` (owner, 2026-10-14).
- Phase 85 store rules apply: in `dual`, Postgres is authoritative and the sheet is a state-copy mirror (85 D-01/D-02); migrations are additive only (83 D-04); one Apps Script deployment serves staging AND production. A redeploy goes live in prod immediately, so record the rollback version.

**Field and allowed values**
- **D-01:** The field name is `beer_category`. It is beer-specific on purpose and must not be named `category` (it would collide with the Zoho `category`/`_zoho_category` already read in `07-catalog-kits.js:42`) or `tint`.
- **D-02:** The allowed values are exactly the 12 existing beer tint keys: `pilsner lager pale ipa amber wheat session saison stout porter redale brown`. There are no new CSS classes and no new lager colours. Several lagers share the `lager` colour, which is accepted.
- **D-03:** Enforcement is **app-level only**. One shared normaliser in the middleware (`zoho-middleware/lib/recipe-rules.js`, next to `normalizePricingMode`) plus a matching Apps Script normaliser. The Postgres column is plain nullable `text` with **no CHECK constraint**. Reason: the deploy migration allowlist forbids `DROP CONSTRAINT`, so a CHECK would make extending the list later a manual migration.
- **D-04:** Off-list values are **normalised, then rejected**. Normalise by trimming, lowercasing and stripping non-letters (`'IPA'`->`ipa`, `'Red Ale'`->`redale`). If the result is still not on the list, reject the save with a clear 400 (middleware) or error (Apps Script). Empty or blank stores as blank/null and is valid.
- **D-05:** The field is optional everywhere. It is never required, including for `status: active`.

**Initial values (the 11 active recipes)**
- **D-06:** The confirmed mapping:
  - `ipa`: West Coast IPA (SV-R-000011), NZ East Coast IPA (SV-R-000013)
  - `pale`: Hazy Pale Ale (SV-R-000003)
  - `pilsner`: German Pilsner (SV-R-000010), Czech Lager (SV-R-000002)
  - `lager`: Munich Helles (SV-R-000006), Bavarian Style Lager (SV-R-000016), Oktoberfest (Festbier) (SV-R-000008), American Lager (SV-R-000004)
  - `brown`: English Mild (SV-R-000001), Czech Dark Lager (SV-R-000007)
  - The 2 non-active recipes stay blank.
- **D-07:** Values are set **by staff in BrewPad**. There is no seeding script and no data step in the migration. Setting them on staging is part of the UAT (it also exercises the editor end to end). The same picks are made on production after the release.

**What customers see**
- **D-08:** The category shows as **colour only**. The card gets the tint class (`label-beer tint-<key>`) and no visible category tag or label. Existing per-tint `--tint-text` subtitle shades (`ab8a0347`) apply.
- **D-09:** A blank category means **default gold**: no tint class, so the card is identical to today's.
- **D-10:** The colour applies wherever `buildRecipeCard` renders. That covers beer.html and the wine.html `#recipe-catalog` mount, and is accepted as intended.

**Editors**
- **D-11:** BrewPad (`brewpad.html` + `js/brewpad.js`) and admin (`admin.html` + `js/admin.js`) both get a **"Beer category" `<select>` placed immediately after the Style input**. It uses readable option names (e.g. "— None (gold) —", "IPA", "Pale ale", "Pilsner", "Lager", "Red ale", "Brown", …) and stores the key. There is no colour swatch. Populate, read, save, and BrewPad clone must all carry it.

**Pinned tests (CLAUDE.md rule 10 approval)**
- **D-12:** The owner **approves editing existing tests, limited to the field set**. Allowed edits are: adding `beer_category` to pinned field lists and fixtures (spec headers, the 18-key backfill plan, `RECIPE_COLUMNS` reads, the sheet-shape fixture, D-09 parity, the adminapi mirror and schedule-column tests, `ALLOWED_PUBLIC_FIELDS`), and widening the `catalog-recipe-block` className assertion to allow the tint class. No other assertion may be weakened or removed. Each edited test must be named in the plan. The list is in `89-NOTES.md` §9.

**Production timing**
- **D-13:** Phase 89 reaches production **after the 85-13 cutover, as its own promotion**. It is NOT bundled into 85-13. The owner first chose to bundle, then changed to this after these facts were raised: (a) the 85-13 push is pinned to `d2c66be9:main`, and current `main` carries Phase 86/87 and the gated kiosk money-path work; (b) migration 0006 would run in prod before 0004/0005 exist, and node-pg-migrate's order check would then fail the later deploy. Build and UAT happen fully on staging now.
- **D-14:** **The 85-13 backfill trap must not fire.** Once 89 changes `specs/recipes.js`, the `headerRejects` check (`recipes-backfill.js:126–131`) rejects the whole Recipes sheet if the prod sheet lacks the `beer_category` column. The plan and runbook must ensure the 85-13 production backfill either runs from the pinned `d2c66be9` checkout or happens after the column exists on the production sheet. The planner chooses the mechanism and records it explicitly in the Phase 85 runbook notes. The planner must not change the 85-13 pin.

### Claude's Discretion
- Exact readable option labels and their order in the dropdown.
- Migration filename (`0006_<name>.sql`) and the comment wording.
- Whether `beer_category` goes in `UPDATE_STRING_FIELDS` with normalisation or is special-cased like `pricing_mode`, in both recipe-pg and Apps Script.
- Whether to also add the header to `setupRecipeTabs` (optional, per notes).
- Where the shared key list lives on the frontend (editors and card) to avoid three copies drifting.
- Plan and wave breakdown, following the suggested order in `89-NOTES.md`.

### Deferred Ideas (OUT OF SCOPE)
- Filtering or grouping recipes by `beer_category` on beer.html. The recipe grid has no filters today, and this would be a new capability.
- A visible category tag on cards (rejected for now in favour of colour only).
- Extra lager colours (`darklager`, `festbier`), if the shared lager colour later feels flat.
- A colour swatch in the editor dropdown.
</user_constraints>

<phase_requirements>
## Phase Requirements

No requirement IDs are mapped (ROADMAP: "Requirements: TBD"). CONTEXT decisions D-01..D-14 are the contract. Research support per decision:

| ID | Description | Research Support |
|----|-------------|------------------|
| D-01/D-02 | Field name + 12 keys | Key list verified against `getTintClass` map and `css/styles.css:4416-4430`; all 12 `.tint-*` classes exist |
| D-03/D-04 | App-level enum, normalise then reject | §Normaliser design; the guard + allowlist accept a plain `add column` (verified by running them) |
| D-05/D-09 | Optional / blank = gold | Card helper short-circuits when blank (existing card tests stay green unedited) |
| D-06/D-07 | Staff set values in BrewPad | §Staging UAT path |
| D-08/D-10 | Colour only; applies wherever `buildRecipeCard` renders | Note: `fetchActiveRecipes` returns no recipes unless `categoryFilter === 'beer'`, so wine.html in practice renders none (D-10 is moot but harmless) |
| D-11 | Two `<select>` editors | §Editors; `js/lib/constants.js` is the one file loaded on every surface |
| D-12 | Pinned-test edits | §Test impact: only 7 existing tests actually fail; two listed in D-12 do not need editing |
| D-13/D-14 | Prod timing + 85-13 trap | §D-14 recommendation (pinned worktree) |
</phase_requirements>

## Summary

This phase adds one nullable text column that rides the exact path `pricing_mode`/`schedule_id` took in Phase 79/81/85. I verified every line reference in `89-NOTES.md` against current code: all are accurate (no meaningful drift). I then applied a minimal prototype of the whole backend change (Apps Script ensure/create/update/mirror, `recipe-pg`, spec, verify, public allowlist, migration 0006) to a scratch copy of HEAD and ran the suites. Result: the plain `alter table recipes add column beer_category text;` passes both the migration guard and the allowlist, applies cleanly on postgres:18-alpine, and only **7 existing tests** fail (3 middleware unit, 3 frontend Apps Script mirror, 2 DB read-shape; counts below). Several tests that 89-NOTES §9 / D-12 list for editing do **not** fail and should be left alone.

Three findings change the plan versus the notes. (1) **D-14 is wider than `headerRejects`.** Once the spec/verify/`recipe-pg` change lands in `main`, running `recipes-backfill`, `recipes-verify` or `recipes-replay-to-sheet` from `main` against the prod DB fails even if the sheet column exists, because prod Postgres has no `beer_category` column until the later promotion. The only complete mechanism is to run all three scripts from a pinned `d2c66be9` worktree for the whole of 85-13/85-14. (2) **Staging cannot exercise the Apps Script writers.** Staging runs `RECIPES_STORE=dual` with no sheet leg, so Apps Script `createRecipe`/`updateRecipe`/`mirrorRecipeState` are proven only by Jest fake-runtime tests until production, yet the redeploy puts that code on prod's live sheets-mode save path immediately. (3) **Nothing creates the sheet column on its own** until some write calls the ensure helper; the staging backfill (new spec) needs the column present, so an editor-run helper (or a hand-typed header) is needed after the redeploy.

**Primary recommendation:** Build it as a thin vertical slice in this order: shared normaliser (middleware + Apps Script + parity test) -> migration 0006 + `recipe-pg` + backfill spec/verify -> route 400 validation + public allowlist -> card + editors (key list in `js/lib/constants.js`) -> one `npm run build` -> owner Apps Script redeploy -> staging push + UAT. Land the RUNBOOK D-14 note (pinned worktree) in the FIRST plan, before the spec change is committed.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Enum validation (normalise then reject) | API / Backend (middleware route + recipe-pg) | Apps Script (sheets-mode defence) | Server must be authoritative; editors use a `<select>` so the browser cannot be trusted anyway |
| Storage of `beer_category` | Database / Storage (PG `recipes.beer_category text`) | Google Sheet column (state-copy mirror) | 85 D-01/D-02: PG authoritative in dual/postgres; sheet is mirror (and the store in sheets mode) |
| PG -> sheet mirror | API / Backend (`recipe-mirror` reads full PG state) | Apps Script `mirror_recipe_state` | Rides along once `RECIPE_COLUMNS` has the field; Apps Script must ensure the column or the value is dropped |
| Public exposure | API / Backend (`PUBLIC_RECIPE_FIELDS` allowlist) | — | Build-by-allowlist; a field not listed never reaches beer.html |
| Staff edit | Browser / Client (BrewPad, admin `<select>`) | API (400 on bad value) | Editors are the only writers |
| Card colour | Browser / Client (`buildRecipeCard` in the `main.js` bundle) | CDN / Static (`.tint-*` CSS, already present) | Pure presentation; className only |

## Standard Stack

### Core
No new libraries. Everything uses what is already in the repo.

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| node-pg-migrate | ^9.0.0 (already installed) | Apply `0006_*.sql` | Existing `npm run migrate` pipeline; guard + allowlist run first |
| libpg-query | 16.7.3 (already installed) | Powers `migration-allowlist.js` AST check | Existing |
| Jest | ^29.7.0 | Unit tests (root jsdom, middleware node) | Existing |
| @testcontainers/postgresql | 11.14.0 | DB tests (`npm run test:db`) | Existing; harness uses `postgres:18-alpine` |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| App-level enum | PG CHECK constraint | Locked out by D-03: allowlist has no `DROP CONSTRAINT`, so extending the list later would need a manual migration |
| `typeof getTintClass` guard / helper in 07 | Calling `getTintClass` from 07 directly | Direct call is fine because blank short-circuits; but see §Card for the whitelist guard |

**Installation:** none. **Version verification:** not applicable, no packages are added.

## Package Legitimacy Audit

No external packages are installed by this phase. slopcheck is not applicable.

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|-----------|-------------|
| (none) | — | — | — | — | — | n/a |

**Packages removed due to slopcheck [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

## Architecture Patterns

### System Architecture Diagram

```
 Staff (BrewPad / admin)                          Public visitor (beer.html)
   <select beer_category>                                  |
        | JSON body {beer_category:'ipa'|''}               | GET /api/recipes?status=active
        v                                                  v
 +--------------------------- middleware routes/recipes.js ----------------------------+
 | POST/PUT: checkBeerCategory(payload)  -- normalise; off-list -> 400 invalid_beer_category
 |           payload.beer_category = canonical key (so every store sees one form)       |
 | GET (anon): toPublicRecipe() copies PUBLIC_RECIPE_FIELDS (+ 'beer_category')         |
 +-------------------------------------+-----------------------------------------------+
                                       v  lib/recipe-store.js (RECIPES_STORE)
        sheets ---------------------------+---------------------------- dual / postgres
          |                                                                  |
  Apps Script create_recipe/update_recipe                       lib/recipe-pg.js createRecipe/updateRecipe
  ensureRecipesBeerCategoryColumn(sheet)                        (normalise again, $17 / addSet, NULL for blank)
  normalizeBeerCategory -> setValue by header                               |
          |                                                                 v
   Google Sheet "Recipes"  <---- mirror_recipe_state (prod only) ---- recipe-mirror reads full PG row
   (+ beer_category header)       ensure column, write by header            (RECIPE_COLUMNS now has the key)
                                                                            |
                                                              Postgres recipes.beer_category text NULL
                                                                            ^
        backfill spec (txt('beer_category', false)) / verify RECIPE_FIELDS --+  (offline tooling)

 beer.html -> fetchActiveRecipes -> buildRecipeCard(recipe)
     recipe.beer_category in BEER_CATEGORIES ? 'label-beer tint-<key>' : 'label-beer'   -> .label-beer[class*="tint-"] CSS
```

### Recommended Project Structure
```
apps-script/adminApi.gs                      # + BEER_CATEGORY_KEYS, normalizeBeerCategory, ensureRecipesBeerCategoryColumn
zoho-middleware/
├── lib/recipe-rules.js                      # + BEER_CATEGORY_KEYS, normalizeBeerCategory (exported)
├── lib/recipe-pg.js                         # RECIPE_COLUMNS, INSERT ($17), update special-case
├── routes/recipes.js                        # checkBeerCategory (400) + PUBLIC_RECIPE_FIELDS
├── migrations/0006_recipes_beer_category.sql
└── scripts/backfill/{specs/recipes.js,recipes-verify.js,recipes-backfill.js}
js/lib/constants.js                          # + BEER_CATEGORIES [{key,label}] (loaded by main bundle, brewpad.html, admin.html)
js/modules/07-catalog-kits.js                # recipe tint helper + buildRecipeCard
brewpad.html / admin.html / js/brewpad.js / js/admin.js
```

### Pattern 1: Header-lookup ensure + special-case write (precedent: `pricing_mode`)
**What:** Apps Script appends the header at `lastCol+1` the first time any write needs it, returns the zero-based index, and writes by header, never by position.
**When to use:** createRecipe (after the positional `appendRow`), updateRecipe (BEFORE the row is read; run unconditionally and before the single `invalidateSheetCache`), mirrorRecipeState (inside the lock, before headers are read).
**Example:**
```javascript
// Source: apps-script/adminApi.gs:4161-4194 (existing pricing_mode / schedule_id helpers), extended
var BEER_CATEGORY_KEYS = ['pilsner','lager','pale','ipa','amber','wheat','session','saison','stout','porter','redale','brown'];

function ensureRecipesBeerCategoryColumn(sheet) {
  var lastCol = sheet.getLastColumn();
  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var idx = headers.indexOf('beer_category');
  if (idx === -1) {
    sheet.getRange(1, lastCol + 1).setValue('beer_category').setFontWeight('bold');
    return lastCol; // zero-based index of the new column
  }
  return idx;
}
```

### Pattern 2: Cross-runtime function parity test (precedent: `recipe-rules-parity.test.js`)
**What:** Evaluate the real `adminApi.gs` with `new Function(src + 'return {...}')` and run shared vectors through both implementations.
**When to use:** `normalizeBeerCategory` exists twice (middleware CommonJS + Apps Script). Add it to the existing parity file's `return {}` list or a sibling file. Do not duplicate vectors by hand in two files without comparing the outputs.

### Pattern 3: Build-by-allowlist public projection
**What:** `toPublicRecipe` copies only `PUBLIC_RECIPE_FIELDS` that the source has (`hasOwnProperty`).
**Example:** append `'beer_category'` to the array at `routes/recipes.js:54` and update its comment. A blank value arrives as `''` from PG (`rowToRecipe` maps NULL to `''`); the card must treat `''` as blank.

### Anti-Patterns to Avoid
- **Positional write for the new column:** `createRecipe` appends 16 positional cells; the new column must be written by header lookup after `appendRow` (a legacy sheet may have the columns in any order).
- **Running the ensure after the row is read in `updateRecipe`:** the header widens and the batched `setValues` writes a stale-width row (see the D-08 comment at `adminApi.gs:4329-4337`).
- **Validating inside the lock / after a write:** reject off-list values before `appendRow` (create) or before any `setValue` (update), and before the PG row lock.
- **Hand-editing `js/main.js`, `js/main.min.js`, `js/brewpad.min.js`, `js/admin.min.js`:** edit sources and run `npm run build` once at the end of the frontend work.
- **A CHECK constraint:** forbidden by D-03.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Colour per category | New CSS / map | Existing `.tint-<key>` + `.label-beer[class*="tint-"]` rules (`css/styles.css:4416-4430, 4813-4825`) | All 12 keys already styled, with `--tint-text` shades |
| Enum drift detection | Manual checking | A Jest parity test comparing: middleware list, Apps Script list (eval), `constants.js` list, and `.tint-<key>` selectors parsed from `css/styles.css` | The repo already uses this idiom; keeps four copies honest |
| Sheet header migration | Custom script | `ensureRecipes*Column` idiom | Proven, idempotent, tested with a fake Sheets runtime |
| Migration safety | Own checks | `npm run migrate:guard` (guard + allowlist) | Already run in tests and pre-deploy |

**Key insight:** this phase has no novel mechanics. Every layer has a `pricing_mode`/`schedule_id` precedent; the risk is in ordering and deployment, not code.

## Touchpoint Verification (89-NOTES.md vs current code)

All line references verified 2026-10-14. **No drift of consequence.**

| Notes reference | Current | Status |
|-----------------|---------|--------|
| adminApi.gs `ensureRecipesPricingModeColumn` :4161, `normalizePricingMode` :4172, schedule ensure :4185, `createRecipe` :4196, pricing/schedule writes :4242-4250 | identical | OK |
| `updateRecipe` :4297, ensure calls :4338-4339, comment :4329-4337, `stringFields` :4362, pricing_mode special-case :4387-4392 | identical | OK |
| `mirrorRecipeState` :4692, ensure calls :4717-4718, headers read :4720-4725 | identical | OK |
| `setupRecipeTabs` :5181-5197 | **Lists only 17 columns; `schedule_id` was never added there** | Precedent says SKIP adding `beer_category` too |
| recipe-pg `RECIPE_COLUMNS` :24-28, `INSERT_RECIPE_SQL` :64-67, `UPDATE_STRING_FIELDS` :90, `createRecipe` :181, pricing_mode update :323 | identical | OK |
| `specs/recipes.js` :35-54, `recipes-backfill.js headerRejects` :126-131, `recipes-verify.js RECIPE_FIELDS` :34-38 | identical | OK |
| `routes/recipes.js` `PUBLIC_RECIPE_FIELDS` :54, `toPublicRecipe` :63-80, POST :729, PUT :754 | identical | OK |
| `recipe-mirror.js` :104-127 (`mirrorLatest`) | identical | OK |
| `migration-allowlist.js` `ALTER_CMDS` :119-127 | identical | OK |
| Editors: brewpad.html :184-207, admin.html :571-597, brewpad.js :776/:2740/:3056/:3368, admin.js :8678/:9045 | identical | OK |
| `buildRecipeCard` 07-catalog-kits.js:205, `getTintClass` 04-label-cards.js:3, CSS 4416-4430 / 4813-4825 | identical | OK |

### Touchpoints the notes MISSED or got wrong

1. **Frontend: kiosk "Save as new" recipe copies** build a draft recipe from a source recipe and copy `style` but would silently omit `beer_category`: `js/admin.js` ~11728-11745 (POST `/api/recipes`), `js/brewpad.js` ~2008-2020 and ~5428-5440 (and `js/brewpad.js:~3140` create-from-`bp-rcs` at ~5430). These are optional (blank = gold is valid), but copying the source's `beer_category` is a one-line change each and matches how `style` is carried. Decide explicitly; if included, they are pinned only by `kiosk-recipe-modify`/`brewpad-recipe-attach-modify`/`admin-recipe-modify` tests that I did not find asserting full payload equality (verify when editing).
2. **`js/modules/07-catalog-kits.js:350-357` doc comment on `fetchActiveRecipes`** states "Recipes carry no category field of any kind... if a wine recipe is ever created it will need an explicit category field". It becomes stale/misleading; reword it (it refers to wine/beer routing, a different concept from `beer_category`). Also `fetchActiveRecipes` returns an empty list for any `categoryFilter !== 'beer'`, so the wine.html mount (D-10) renders no recipe cards today.
3. **`js/lib/constants.js` is the one shared frontend file**: it is concatenated into `main.js` (public pages, see `concat:js`) AND loaded by `<script>` on `brewpad.html` (line 17) and `admin.html` (line 1140, `defer`, before `admin.min.js`). The notes did not locate a shared home for the key list. This is it.
4. **Existing admin save error UX**: admin `saveRecipe` shows a generic "Could not save recipe. Please try again." for every non-stale failure (`js/admin.js` ~9110). BrewPad shows the server message (`'Could not save recipe. ' + msg`). Since editors use a `<select>`, a 400 is unreachable from the UI; no admin change is needed unless the owner wants the message surfaced.
5. **Existing route validation precedent is 422, not 400**: `routes/recipes.js` has no `status(400)` today (activation and unit mismatch return 422 with a `code`; stale returns 409). D-04 says 400, which is locked; use `res.status(400).json({ error: <message>, code: 'invalid_beer_category' })`. BrewPad surfaces any non-2xx `error` string, so the message will display.
6. **RUNBOOK has no "2026-10-14 staging refresh procedure"**. CONTEXT cites it, but `docs/RUNBOOK.md` Phase 85 section has no such text; it only exists in memory `phase-85-recipes-status`. Add a short subsection (see §Staging UAT) or the planner has nothing in-repo to point to.
7. **`docs/DATA-MODEL.md` does not document the Recipes columns**, so no DATA-MODEL edit is required. Docs to touch: `docs/RUNBOOK.md` only (Phase 85 section note + Apps Script deploy-record row).
8. **Tests listed in NOTES §9/D-12 that do NOT fail and need no edit** (verified by prototype): `catalog-recipe-block.test.js` className assertion (blank category keeps `label-beer`), `recipes-public-guard.test.js` (its fixtures lack the field), `recipe-d09-runtime-parity.test.js`, `adminapi-recipe-schedule-column.test.js`, `recipes-verify.test.js`, `db/recipes-backfill.test.js`, `brewpad-recipe-list-clone.test.js`, `brewpad-recipes.test.js` (assert individual properties). Leave them untouched (rule 10) and ADD new tests instead.

Other recipe serializers checked and needing no change: kiosk (`js/kiosk-core.js:1262` reads style/abv only), `routes/pos-recipe.js` (price only; `recipe_snapshot` at :1410 is an explicit object, not the recipe), `lib/dual-write-compare.js` (price compare only), `openapi.yaml` (no recipe field list), Redis `sv:recipes:*` caches (store the raw staff shape; the public projection runs at read time, so the new allowlist applies immediately; 10-minute TTL in sheets mode, busted on POST/PUT/DELETE), tests/e2e (no recipe specs).

## Precedent: how `pricing_mode` / `schedule_id` went end to end

| Layer | Commit(s) | Notes |
|-------|-----------|-------|
| Apps Script ensure + writers | `762d6e5b feat(81-01): self-migrating schedule_id column persisted by createRecipe/updateRecipe`; earlier `pricing_mode` self-migration | Ensure helper + header-lookup write; updateRecipe runs ensure before reading the row |
| Fake-runtime tests | 81-01 `tests/frontend/adminapi-recipe-schedule-column.test.js` | Ensure appends bold header at lastCol+1, idempotent |
| PG schema | `f1db4ca5 feat(85-01): add additive 0003_recipes migration` | **Both columns were created inline in `create table`; there is NO `ALTER TABLE` precedent in `migrations/`** (0004/0005 are also pure creates). 0006 is the first `ALTER TABLE ... ADD COLUMN` |
| recipe-pg | `9d73ae1d`, `43c51cd8`, `9929b3ef` (85-02/03) | `RECIPE_COLUMNS` order = sheet order; special-case for `pricing_mode`, string list for `schedule_id` |
| Backfill spec/verify | `3b4b4382`, `6d0a84fe` (85-10/11) | `txt(..)` spec entries, `RECIPE_FIELDS` list |
| Mirror | 85-04/05 (`mirror_recipe_state`) | Ensure calls added inside the lock |
| Public allowlist | `6e56fd1e test(81-02)` | `ferment_days` was the only addition; comment block records the boundary decision |
| Phase 85 plans that touched the field set | 85-01..85-12 summaries | Pinned tests were created in 85-01/85-10/85-11 |

## Test Impact (verified by prototype)

Prototype = the backend change only (no editors/card). Ran `cd zoho-middleware && npx jest`, root `npx jest --config jest.config.js`, and `npx jest --config jest.db.config.js recipe` in a scratch copy of HEAD.

### Existing tests that FAIL and need a field-set edit (allowed by D-12)
| Test | Failing assertions | Required edit |
|------|--------------------|---------------|
| `zoho-middleware/__tests__/backfill/recipes-spec-headers.test.js` | "Recipes spec has the 18 real headers"; "a sheet with pricing_mode/schedule_id appended last ... still maps by name" (`check.missing` now `['beer_category']`) | Append `'beer_category'` to `REAL_RECIPES_HEADERS` (19 headers); update the test title wording |
| `zoho-middleware/__tests__/backfill/recipes-backfill-plan.test.js:80` | `Object.keys(result.recipes[0]).length` is 19 | Change 18 -> 19 (one test: "clean fixture") |
| `tests/frontend/adminapi-recipe-mirror.test.js` | 3 tests: "places all 18 values by header name" (row gains a 19th cell), "legacy header ... gains them in order" (`header.slice(-2)`, `header.length` 18), "overwrites every cell ... known recipe" | Add `'beer_category'` to `RECIPE_HEADERS_FULL`/`recipeObj`; adjust the legacy-header test to expect `['pricing_mode','schedule_id','beer_category']` and length 19 |
| `zoho-middleware/__tests__/db/recipe-pg-read.test.js` + `fixtures/recipes-sheet-shape.json` | 2 tests (byte-identical JSON): output gains `"beer_category":""` after `schedule_id` and before `ingredient_count` in list rows | Add `"beer_category": ""` after `"schedule_id"` in every list and detail recipe object in the fixture (and give one fixture recipe a non-blank value, with `insertRecipe` writing the column, to prove a real round trip) |

Pre-existing, unrelated failures on the default Node 20.20.2: `zoho-middleware/__tests__/vancouver-timezone.test.js` (2 tests, tzdata 2025c). Use Node 24 (`nvm use 24`, `.nvmrc` is 24, v24.21.0 installed) and these pass. `db/recipes-migration.test.js` timed out at the 120 s hook once when 7 DB suites ran concurrently; it passes alone (flake from container contention, see Validation Architecture).

### NEW tests required (RED first, CLAUDE.md rule 3 spirit)
| Test | Covers |
|------|--------|
| `__tests__/recipe-rules-parity.test.js` (extend) or new sibling | `normalizeBeerCategory` middleware vs real `adminApi.gs` over shared vectors: `'IPA'`, `' Red Ale '`->`redale`, `''`, `'   '`, `null`, `undefined`, `'purple'`, `'Pale Ale'` (-> `paleale`, rejected), `'123'`, `5`, `['ipa']`, `{}`; plus every one of the 12 keys |
| `tests/frontend/adminapi-recipe-beer-category.test.js` (new, modelled on `adminapi-recipe-schedule-column.test.js`) | ensure appends bold header / returns existing index / idempotent / does not disturb the other two ensures; createRecipe writes the canonical key by header and rejects off-list BEFORE `appendRow`; updateRecipe writes it, leaves it untouched when absent, clears with `''`, rejects off-list with no writes; mirror writes it and drops nothing when the column is missing |
| `__tests__/db/recipe-pg-create.test.js` / `recipe-pg-update.test.js` (add cases) | create with `'IPA'` stores `ipa`; blank stores NULL and reads `''`; off-list returns `{ok:false,error:'invalid_data'}` and writes nothing; update sets / clears / ignores-when-undefined; rejection happens before the lock (no stale error shadowing) |
| `__tests__/recipes-public-guard.test.js` (add a new test, keep existing) | anonymous list/detail carries `beer_category` when the source has it, still excludes `status`/`locked_price`/`notes`; add `'beer_category'` to `ALLOWED_PUBLIC_FIELDS` as D-12 permits |
| `__tests__/recipes-write-auth-guard.test.js` or `recipes.test.js` (add) | POST/PUT with `beer_category:'purple'` -> 400 `invalid_beer_category`, store untouched; `'IPA'` -> store receives `'ipa'`; undefined on PUT passes through untouched |
| `__tests__/backfill/recipes-backfill-plan.test.js` (add) | optional: off-list non-blank `beer_category` -> reject `{field:'beer_category', reason:'invalid_beer_category'}` (reason codes only, never the value, per D-13 redaction); blank/valid pass |
| `__tests__/backfill/recipes-verify.test.js` (add) | `beer_category` mismatch is reported; `'' == null` equal |
| `__tests__/db/recipes-migration.test.js` (add) | column exists, nullable text, no CHECK (inserting `'anything'` succeeds at DB level, documenting that enforcement is app-level) |
| `tests/frontend/catalog-recipe-tint.test.js` (new) | `buildRecipeCard` with `beer_category:'ipa'` -> className `label-beer tint-ipa`; `''`/undefined/`'purple'`/`'red'` (a wine key) -> exactly `label-beer`; supplies `global.BEER_CATEGORIES = require('../../js/lib/constants.js').BEER_CATEGORIES` and `global.getTintClass = require('../../js/modules/04-label-cards.js').getTintClass` |
| `tests/frontend/brewpad-recipes.test.js`-style new file | `buildRecipePayload`/`readRecipeFormData`/`populateRecipeForm`/`bpCloneRecipePayload` carry `beer_category`; blank -> `''` sent so a PUT clears it |
| Key-list drift test (new) | the 12 keys are identical in: `recipe-rules` export, `adminApi.gs` (eval), `constants.js` `BEER_CATEGORIES`, and each has a `.tint-<key>` rule in `css/styles.css` |

## Migration Mechanics

- **Naming:** `zoho-middleware/migrations/NNNN_name.sql`, 4-digit prefix, two markers `-- Up Migration` / `-- Down Migration`. Next is `0006_recipes_beer_category.sql` (no other planned phase claims 0006; Phase 88/90 plans do not).
- **Content (verified):**
  ```sql
  -- Up Migration
  alter table recipes add column beer_category text;
  -- Down Migration
  alter table recipes drop column beer_category;
  ```
  I ran `node scripts/migration-guard.js` and `node scripts/migration-allowlist.js` against a temp dir containing 0001-0005 plus this file: both exit 0 ("6 file(s) additive-only OK"). The allowlist permits `AlterTableStmt` on `OBJECT_TABLE` with `AT_AddColumn`; `ColumnDef`/`TypeName` are allowed nodes. A `comment on column recipes.beer_category is '...'` is also allowed (`CommentStmt: 1`) and is the right place to record "app-level enum; see recipe-rules.js". Do not add `check (...)`: `AT_AddConstraint` is allowed, but D-03 forbids it because it can never be altered later.
- **What the DB tests require:** `db/migrations.test.js` compares `pgmigrations` rows to the directory listing (auto-adapts to a new file; verified passing). `db/recipes-migration.test.js` never enumerates columns. `migration-allowlist-wiring` uses the real directory. There are no hard-coded migration counts.
- **0003 precedent caveat:** `pricing_mode` and `schedule_id` are inline in `create table recipes`. There is no prior `ALTER TABLE ADD COLUMN`, so 0006 is the first; it applied cleanly on `postgres:18-alpine` in the harness.
- **Order trap (D-13b):** node-pg-migrate rejects a run when an unapplied migration precedes an already-applied one. Prod will have 0001-0003 only after 85-13, so 0006 must not ship alone; it goes out in the same promotion as 0004/0005.
- **Railway Postgres is 18.x** and the harness is already `postgres:18-alpine` (the memory note about postgres:16 is stale for the harness; `postgres:16-alpine` is also cached locally).

## Normaliser Design (D-03 / D-04)

Three runtimes need a copy of the key list; they cannot share a file. Keep them honest with the drift test above.

| Runtime | Home | Notes |
|---------|------|-------|
| Middleware | `zoho-middleware/lib/recipe-rules.js`, export `BEER_CATEGORY_KEYS` + `normalizeBeerCategory` | Pure module, ES5 `var` style |
| Apps Script | `apps-script/adminApi.gs` next to `normalizePricingMode` | Must not reference Apps Script globals (see `adminapi-recipe-pure.test.js` purity gate for the recipe helpers) |
| Frontend | `js/lib/constants.js` `BEER_CATEGORIES = [{ key, label }, ...]` (+ `module.exports`) | Reaches public pages via `main.js` concat, and brewpad/admin via `<script>`. ES5 only (ESLint `ecmaVersion: 5`) |

Recommended semantics (refines D-04 for edge cases; flag A1 for owner OK):

```javascript
// returns the canonical key, '' for blank, or null for invalid
function normalizeBeerCategory(value) {
  if (value === null || value === undefined) return '';
  if (typeof value !== 'string') return null;            // arrays/objects/numbers never coerce
  if (value.trim() === '') return '';
  var key = value.toLowerCase().replace(/[^a-z]/g, '');
  return BEER_CATEGORY_KEYS.indexOf(key) === -1 ? null : key;
}
```
- Rejecting non-strings avoids `String(['ipa'])` -> `'ipa'` slipping through.
- A non-blank input that strips to nothing (`'123'`, `'--'`) is rejected rather than silently blanked.
- `'Pale Ale'` normalises to `paleale` and is rejected; that follows D-04 literally and is unreachable from the `<select>`. Labels should avoid inviting it, but the key stays `pale`.
- The normalised value is letters only, so it needs no `sanitizeInput`.

### 400 surfacing today
- `routes/recipes.js` POST/PUT: store results that are `ok:false` map to **422** `{error, code:'save_failed'}`; stale -> 409. A pre-store check is the only way to give a uniform 400 in `sheets` mode too. Add `checkBeerCategory(payload)` at the top of both handlers (before `validateIngredientUnits`): if `payload.beer_category !== undefined`, normalise; `null` -> `return res.status(400).json({ error: 'Beer category must be one of: ' + list, code: 'invalid_beer_category' })`; otherwise assign the canonical key back onto `payload.beer_category`. Leave `undefined` untouched so a PUT without the field does not clear it.
- recipe-pg and Apps Script re-validate as defence in depth (their rejection surfaces as 422 `save_failed` with the message).
- BrewPad (`submitRecipeSave`): any non-2xx throws `Error(data.error)` and toasts `'Could not save recipe. ' + msg` (not retried for 400). Admin shows its generic message.

## recipe-pg Specifics (item 5)

- `RECIPE_COLUMNS`: append `'beer_category'` last (after `schedule_id`). This alone drives `RECIPE_SELECT`, `LIST_SQL`, `GET_RECIPE_SQL`, `LOCK_RECIPE_SQL` and `rowToRecipe` (NULL -> `''`).
- `INSERT_RECIPE_SQL`: add `beer_category` to the column list and `$17` to values (`$13` stays reused for `updated_at`). In `createRecipe` validate before the insert: `var bc = recipeRules.normalizeBeerCategory(payload.beer_category); if (bc === null) return invalid(...)`, then pass `emptyToNull(bc)` as the 17th param.
- **Update: special-case, do not use `UPDATE_STRING_FIELDS`.** That loop runs `sanitizeInput` then `emptyToNull` and has no reject path. Add, next to the `pricing_mode` line (~323) and BEFORE `LOCK_RECIPE_SQL`: `if (payload.beer_category !== undefined) { var bc = ...; if (bc === null) return invalid('...'); addSet('beer_category', emptyToNull(bc)); }`. Validation therefore happens before the row lock and before `isStale`, so a bad value returns `invalid_data`, never `stale_recipe`.
- **D-03 stale-editor interplay:** nothing special. `updated_at` is bumped on every update (including category-only edits), and editors send `expected_updated_at` from the loaded recipe. `expected_updated_at` is stripped by the route in every mode.
- **`dual` writes and the mirror:** `recipe-store.update` -> `recipePg.updateRecipe` -> `finish(raw)` -> `scheduleMirror(raw._recipeId)` -> `recipeMirror.mirrorLatest` reads the full PG row (`getRecipe`) and posts `{recipe, ingredients}` to `mirror_recipe_state`. No mirror change needed: the key rides along. Staging sets no marker (`sheetMirror.mirrorFireAndForget` is production-only).

## D-14: the 85-13 backfill trap (item 6)

**Scope is wider than `headerRejects`.** After this phase lands in `main`:
1. `recipes-backfill.js` `headerRejects` (lines 126-131) rejects the entire Recipes sheet (`missing_header`) if the snapshot lacks the `beer_category` column, because `checkHeaders` counts ANY missing spec header (optional or not).
2. Even with the column present, `buildInsertSql` inserts every spec column (`RECIPE_INSERT_COLUMNS`), so `--promote` fails with "column beer_category does not exist" on prod Postgres, which has only 0001-0003 until the later promotion.
3. `recipes-verify.js` and `recipes-replay-to-sheet.js` read through `recipePg.getRecipe` (`RECIPE_COLUMNS`), so they fail the same way.
4. The reverse is safe: the old spec tolerates extra sheet columns (`unmapped` is only logged by the generic CLI and ignored by `headerRejects`). So the pinned scripts work whether or not v63 has already added the column to the prod sheet.

Option "run after the column exists on the prod sheet" therefore does NOT make the trap safe (reason 2/3). Option "make optional headers non-fatal" would weaken a pinned behaviour and still not fix 2/3.

**Recommendation (safest, concrete): run backfill, verify and replay for the whole 85-13/85-14 window from a pinned worktree of `d2c66be9`.**
- Verified: `git diff d2c66be9 HEAD` shows **no changes** to `scripts/backfill/specs/recipes.js`, `recipes-backfill.js`, `recipes-verify.js`, `backfill.js` or `normalize.js` since the pin, so the pinned scripts are byte-identical to today's. `d2c66be9` is an ancestor of HEAD (195 commits behind).
- Procedure for the RUNBOOK:
  ```bash
  # once, before 85-13 Task 2; reuse for 85-14 verifies and any replay
  git worktree add ../sv-85-pinned d2c66be9          # detached HEAD, outside the repo tree
  cd ../sv-85-pinned/zoho-middleware && nvm use 24 && npm ci
  git -C ../sv-85-pinned rev-parse --short HEAD       # must print d2c66be9; record it in 85-DUAL-LOG.md
  # run recipes-backfill.js / recipes-verify.js / recipes-replay-to-sheet.js from HERE only
  ```
  Use Node 24 (BC permanent time: Node 20.20's tz 2025c treats Vancouver as UTC-8 from 2026-11-01; the backfill normalises timestamps in `America/Vancouver`).
- **Doc to update:** `docs/RUNBOOK.md` Phase 85 section: add a boxed callout at the top of §5 (and a one-line pointer in §6, §8, §9, §10 wherever `recipes-verify.js`/`recipes-replay-to-sheet.js` appear) stating "Until Phase 89 is promoted to production, run these scripts from the pinned `d2c66be9` worktree, never from `main`", plus a line in §13 Release checklist. Also add a "Script source verified" row to the 85-DUAL-LOG "Production prerequisites". Do not edit `85-13-PLAN.md` or its pin.
- **Land this note in the first plan, before the commit that changes `specs/recipes.js`.**
- After the 89 promotion: scripts from `main` are correct again; remove the callout in the promotion's release step.

Related interaction to record in the same note: a mirror write by the pinned prod middleware (85-13 pre-open mirror write) carries no `beer_category` key, and the v63 Apps Script `mirrorRecipeState` will (a) add the header, (b) write `''` into it. State-copy mirrors overwrite hand-typed sheet values with the PG value, so nobody should type categories on the sheet.

## Apps Script Deployment (item 7)

- **How versions are recorded:** `docs/RUNBOOK.md` "Apps Script" section (lines 225-283): record the active version before pasting, hash-compare editor vs repo, `cat apps-script/adminApi.gs | pbcopy`, Deploy -> Manage deployments -> pencil -> **New version** (never "New deployment"), then add a row to the deploy-record table (Date, Version, Previous/rollback, Change). Rollback = Manage deployments -> pencil -> previous version -> Deploy.
- **Current state:** last table row is **v62 (2026-10-09, Phase 87), previous 61**. HEAD `adminApi.gs` SHA-256 is `a8b34634...121a98`, which equals the recorded post-paste hash of v62, so the editor-drift baseline is clean (last commit touching the file: `11f66e48`). The Phase 89 deploy is therefore expected to be **v63 with rollback v62**, but the owner must read the live active version at deploy time (the table also still shows Phase 86's "v61" row as `_pending_`; do not trust it blindly).
- **Risk to flag loudly:** prod is still `RECIPES_STORE` sheets until 85-13. The redeploy changes `createRecipe`/`updateRecipe`, which prod BrewPad/admin call on every recipe save today. Minimise the diff, test through the fake runtime, and have the rollback version written down first. Post-deploy probes: `get_recipes` / `get_recipe` return ok (non-mutating). The create/update write path cannot be exercised on staging (see below), so it is first exercised for real on prod; consider a throwaway draft recipe save on prod right after deploy, then delete it.
- **Column creation:** nothing calls the ensure helper until a write happens. Provide an idempotent editor-run function (precedent: `setupBatchMirrorNotices`) such as `setupRecipeBeerCategoryColumn()` that calls `ensureRecipesBeerCategoryColumn` and `Logger.log`s the result, or have the owner type the exact header `beer_category` in the next empty cell of Recipes row 1 (`headers.indexOf('beer_category')` finds a hand-typed header, so both are equivalent). One of these must happen before the first staging backfill with the new spec.
- **Test harness:** `tests/frontend/adminapi-*.test.js` read the `.gs` file with `fs.readFileSync` and evaluate it with `new Function('SpreadsheetApp','Logger','LockService', src + 'return {...}')`, passing fakes so Apps Script globals are shadowed. Reuse `makeFakeSheet` from `adminapi-recipe-mirror.test.js` / `adminapi-recipe-schedule-column.test.js`. `acquireScriptLock`, `generateNextId`, `findRowById`, `sheetToObjects`, `invalidateSheetCache` are in the same file and run for real.
- **Phase 88 note:** ROADMAP Phase 88 plans to reduce `adminApi.gs` to the mirror writer; the create/update Apps Script paths added here are therefore interim (needed while prod is in sheets mode); the mirror path is the long-term one.

## Staging UAT Path (item 8)

- **beer.html on staging:** reachable directly. `beer.html` carries only `<meta name="robots" content="noindex, nofollow">` (no runtime gate; there is no `BEER_PAGE_LIVE` token in the repo any more, only `tests/frontend/beer-page-holdback.test.js`). The staging frontend selects the staging middleware by hostname (`js/sheets-config.js:65-70`). Staging is behind Cloudflare Access, so the owner opens `https://staging.steinsandvines.ca/beer.html` after signing in. Production's beer page launch is separate (local branch `beer-launch`, not part of this phase).
- **Order on staging:** push to staging -> Railway pre-deploy runs guard + allowlist + node-pg-migrate (0006 applies; staging already has 0004/0005) -> owner redeploys Apps Script (only needed if the staging backfill below is run; staging dual never calls Apps Script create/update) -> make the sheet column exist -> optional re-backfill -> owner sets the 11 categories in staging BrewPad (D-07) -> check beer.html colours.
- **Re-backfill is optional now.** Staging was refreshed today (13 recipes / 145 ingredients) and a new nullable column needs no data. Re-run only if recipes drifted. If run, it needs the new spec, hence the sheet column and migration 0006 first. Procedure (not in RUNBOOK today, add it): snapshot .xlsx from the shared workbook -> tunnel `railway connect Postgres --tunnel-only --environment staging` -> `read -s BACKFILL_DATABASE_URL && export BACKFILL_DATABASE_URL` -> tables must be EMPTY (delete `recipe_ingredients` then `recipes`; `psql` is not installed locally, use a short `node` + `pg` one-liner or `docker run postgres:18-alpine psql`) -> `--dry-run` (0 rejects) -> `--promote` -> `recipes-verify.js`. Kill the leftover ssh child after.
- **Verify noise to expect:** staging writes never reach the sheet, so after UAT `recipes-verify.js` on staging reports `beer_category` mismatches for the 11 recipes. That is explained, not a bug. **Never** run `recipes-replay-to-sheet.js --apply` from staging: the sheet is the shared production workbook.
- **Apps Script writer gap:** staging UAT proves middleware, PG, API, editors and the card. It does not prove Apps Script create/update/mirror; those are covered by Jest and first run for real on prod (see risk above).

## Security (item 9)

### Applicable ASVS Categories (level 1, `security_enforcement: true`)
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no change | Recipe writes already require a staff credential (`recipes-write-auth-guard.test.js`); do not weaken |
| V3 Session Management | no | — |
| V4 Access Control | yes (public boundary) | Build-by-allowlist; `beer_category` becomes a deliberately public field, nothing else added |
| V5 Input Validation | yes | Server-side allowlist normaliser at route, recipe-pg and Apps Script; parameterised SQL (`$n`) only |
| V6 Cryptography | no | — |

### Known Threat Patterns
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Off-list / non-string value posted directly to the API | Tampering | `normalizeBeerCategory` rejects non-strings and off-list values with 400; recipe-pg and Apps Script re-check |
| Stored XSS via class injection on the card | Tampering/EoP | Card applies a class only when the value is in the fixed key list; value is letters only; `className` assignment, never `innerHTML`; `getTintClass` alone would accept any string (`'tint-' + lowercased, spaces removed`) and `.label-beer[class*="tint-"]` would mis-style an unknown `tint-foo`, so whitelist first |
| Hand-typed bad value in the sheet reaching the backfill | Tampering | Backfill rejects off-list non-blank values (reason code only, no cell echo, matching D-13 redaction) |
| Public leakage of non-public fields while adding one | Information disclosure | Keep `toPublicRecipe` allowlist semantics; add a test that `locked_price`, `status`, `notes`, `pricing_mode` stay absent |
| SQL injection | Tampering | Column name is a fixed constant in `RECIPE_COLUMNS`; value goes through `$17`/`addSet` placeholder; `UPDATE` SET list is built only from fixed names |
| Apps Script formula injection | Tampering | Value is canonical letters only; written via `setValue` |
| Wrong-order migration in prod | Availability | D-13: ship 0006 only with 0004/0005 |
| Early Apps Script redeploy breaks live prod saves | Availability | Record rollback version; minimal diff; probes (see Deployment) |

## Common Pitfalls

### Pitfall 1: Mirror silently drops the value
**What goes wrong:** `mirrorRecipeState` builds rows from existing sheet headers only. **Why:** no ensure call. **Avoid:** add `ensureRecipesBeerCategoryColumn(recipesSheet)` beside the other two ensures (line ~4717) and cover it with a test using a 16-column legacy header. **Warning sign:** value present in PG, blank on the sheet.

### Pitfall 2: Ensure after the row read in `updateRecipe`
Covered in Anti-Patterns; the unconditional call must sit with the other two ensures before `invalidateSheetCache`.

### Pitfall 3: A PUT that omits the field clears it, or a blank POST stores `''`
**Avoid:** `undefined` means untouched (PG: skip `addSet`; Apps Script: skip the cell). Editors always send a string (`''` to clear). PG stores `NULL`; reads return `''`.

### Pitfall 4: Backfill/verify run from `main` before 89 reaches prod (D-14)
See D-14. Warning sign: `missing_header` reject on `beer_category`, or `column "beer_category" does not exist`.

### Pitfall 5: `getTintClass` global missing in Jest
`catalog-recipe-block.test.js` does not define `getTintClass` or `BEER_CATEGORIES`; existing card tests stay green only because blank/absent `beer_category` short-circuits before either is touched. Keep the helper written as `recipe.beer_category && ...`. New tests must define both globals. If a test ever builds a card with a category and no globals, it throws `ReferenceError`.

### Pitfall 6: Unknown tint class mis-styles the card
`.label-beer[class*="tint-"]` matches any `tint-*`; an unknown key leaves `--tint-border`/`--tint` unresolved. Whitelist before calling `getTintClass`. Also `red/white/rose/fruit/specialty` are valid wine tints but not valid beer categories.

### Pitfall 7: `npm run build` conflicts
`npm run build` runs `stamp` (rewrites `BUILD_TIMESTAMP` in `js/admin.js`) and the stamp scripts (rewrite `?v=` in many HTML files), then minifies. Two parallel plans that each run it will conflict. Run it once, in the last frontend plan, and let `scripts/check-artifact-drift.sh` (CI job) be the check.

### Pitfall 8: Pure-lint/ES5
`eslint js/ --max-warnings 0` with `ecmaVersion: 5`: no `let/const/=>`/template literals in `js/`. Middleware lint: `eslint routes/ lib/ scripts/ server.js --max-warnings 0`.

### Pitfall 9: DB suite flake
Running all DB suites concurrently on a laptop can hit the 120 s `beforeAll` timeout (seen once on `recipes-migration`). Run DB files individually or with `--maxWorkers=1`.

## Code Examples

### Route check (new)
```javascript
// Source: pattern from zoho-middleware/routes/recipes.js activation guard (422 + code); D-04 requires 400 here
function checkBeerCategory(payload) {
  if (payload.beer_category === undefined) return null;
  var key = recipeRules.normalizeBeerCategory(payload.beer_category);
  if (key === null) {
    return { error: 'Beer category must be one of: ' + recipeRules.BEER_CATEGORY_KEYS.join(', '), code: 'invalid_beer_category' };
  }
  payload.beer_category = key;
  return null;
}
// in router.post / router.put, first statement after reading payload:
//   var bad = checkBeerCategory(payload); if (bad) return res.status(400).json(bad);
```

### Card helper (new, in 07-catalog-kits.js)
```javascript
// ES5. Blank/unknown/non-beer value -> '' (default gold, D-09). Never reached for blank, so Jest files
// that do not load constants.js / 04-label-cards.js are unaffected.
function recipeTintClass(recipe) {
  var key = recipe && typeof recipe.beer_category === 'string' ? recipe.beer_category : '';
  if (!key) return '';
  for (var i = 0; i < BEER_CATEGORIES.length; i++) {
    if (BEER_CATEGORIES[i].key === key) return getTintClass({ tint: key });
  }
  return '';
}
// buildRecipeCard:  var tint = recipeTintClass(recipe); card.className = 'label-beer' + (tint ? ' ' + tint : '');
```

### Editors
- HTML: `<label for="bp-recipe-beer-category">Beer category</label><select id="bp-recipe-beer-category" class="bp-select"><option value="">— None (gold) —</option></select>` placed right after the Style field (`brewpad.html` after line 187; admin: `recipe-beer-category`, `admin-select`, after line 573). Keep the blank option static so it exists even if `constants.js` fails to load; fill the rest from `BEER_CATEGORIES` in JS (single frontend source) or hard-code the 12 options in HTML and rely on the drift test. Either is acceptable.
- JS (each guarded like the neighbouring lines): `populateRecipeForm`: `if (get('bp-recipe-beer-category')) get(...).value = r.beer_category || '';` (admin: `document.getElementById(...)` with a null guard because admin does not guard today); `readRecipeFormData`: `beer_category: get(...) ? get(...).value : ''`; `buildRecipePayload`: `beer_category: formData.beer_category || ''`; `bpCloneRecipePayload`: `beer_category: r.beer_category || ''`; admin `saveRecipe`: `beer_category: (document.getElementById('recipe-beer-category') || {}).value || ''`.
- BrewPad drafts (`recipeDraftSnapshot` -> `readRecipeFormData`, restored via `populateRecipeForm(draft.formData)` at ~10899) pick the field up automatically once both functions carry it.
- Admin BeerXML import (`populateRecipeForm({... parsedRecipe})`, ~9824): leave the category blank.

## Wave / Dependency Suggestions (item 10)

Shared-file owners: `apps-script/adminApi.gs` (one plan), `lib/recipe-rules.js` (one plan, first), `lib/recipe-pg.js` (one plan), `routes/recipes.js` (one plan), `js/brewpad.js` + `brewpad.html`, `js/admin.js` + `admin.html`, and the built bundles (one plan, last).

| Wave | Plan | Files | Notes |
|------|------|-------|-------|
| 1 | 89-01 RUNBOOK D-14 note + pinned-worktree procedure | `docs/RUNBOOK.md` | Must land before any spec change; docs only |
| 1 | 89-02 Shared normaliser + Apps Script | `lib/recipe-rules.js`, `apps-script/adminApi.gs`, parity test, new `adminapi-recipe-beer-category.test.js`, edit `adminapi-recipe-mirror.test.js` | RED tests first; all later middleware plans import `recipe-rules` |
| 2 | 89-03 Migration 0006 + recipe-pg + backfill spec/verify/plan reject | `migrations/0006_*.sql`, `lib/recipe-pg.js`, `scripts/backfill/*`, fixture + 4 pinned-test edits + new DB cases | `npm run migrate:guard`; DB tests via Docker |
| 2 | 89-04 Route validation + public allowlist | `routes/recipes.js`, public-guard + route tests | Disjoint from 89-03 |
| 2 | 89-05 `constants.js` list + card + CSS-drift test | `js/lib/constants.js`, `js/modules/07-catalog-kits.js` (+ stale comment), new tint test | No build here |
| 3 | 89-06 Editors | `brewpad.html`, `admin.html`, `js/brewpad.js`, `js/admin.js`, new editor tests | Optionally include the kiosk "Save as new" carry-over |
| 3 (last) | 89-07 `npm run build` + full gates | bundles, HTML `?v=`, `admin.js` stamp | Single owner of the build; run both suites on Node 24, lint, drift script |
| 4 | 89-08 Staging release (autonomous: false) | RUNBOOK deploy-record row (v63/rollback v62 placeholder), 89 log | Checkpoints: owner Apps Script redeploy + column creation; `git push origin main` (staging only, CLAUDE.md); owner sets 11 categories; UAT of beer.html colours |
| later | production promotion | n/a | Own promotion after 85-13; remove the D-14 callout then |

Commit hygiene: one logical change per commit; regression tests before fix (RED); do not touch `js/main.js`/`*.min.js` except via the build.

## Runtime State Inventory

Not a rename/refactor phase. Stated explicitly for the data-bearing categories because the field adds stored state:

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | PG `recipes` (staging 13 rows, prod none yet); Google Sheet Recipes tab (shared); no data migration (D-07) | Code/schema edit only; values set by staff after release |
| Live service config | Apps Script deployment is shared by staging and prod | Owner redeploy; record v63/rollback v62 |
| OS-registered state | None, verified: no tasks/units reference recipe fields | none |
| Secrets/env vars | None, verified: no new env vars; `RECIPES_STORE` unchanged | none |
| Build artifacts | `js/main.js`, `main.min.js`, `brewpad.min.js`, `admin.min.js`, HTML `?v=` tokens | One `npm run build` |

## State of the Art

| Old Approach | Current Approach | Impact |
|--------------|------------------|--------|
| Recipes all render default gold | Explicit staff-set `beer_category` colours the card | Replaces keyword inference (rejected) |
| Inline columns in `create table` (0003) | First `ALTER TABLE ADD COLUMN` (0006) | Allowlist-compliant, verified |

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Refining D-04: non-string input is rejected and a non-blank input that strips to empty (`'123'`) is rejected, rather than silently blanked | Normaliser Design | Low; owner may prefer the literal algorithm. Unreachable from the `<select>` |
| A2 | Apps Script live version is 62 so the new deploy is 63 / rollback 62 | Apps Script Deployment | Wrong rollback target; owner must read the live version at deploy time |
| A3 | Prefer an editor-run `setupRecipeBeerCategoryColumn()` helper (or a hand-typed header) to create the sheet column, since no write path runs until a save happens | Apps Script Deployment | If neither is done, the new-spec staging backfill fails on `missing_header` |
| A4 | Carrying `beer_category` into the kiosk "Save as new" draft copies is desirable | Missed touchpoints #1 | Cosmetic only; omit if the owner prefers copies to start gold |
| A5 | The unprototyped frontend changes (card, editors) will not break existing tests beyond the ones named; existing card tests pass because blank short-circuits (this one I did verify for the card; editor tests were reasoned from their assertions, not run) | Test Impact | A surprise failure in `brewpad-*` tests; run the full suite after the editor plan |

## Open Questions (RESOLVED)

1. **Should the backfill reject off-list `beer_category` values?**
   - Known: the backfill rejects rather than coerces everything else (status, pricing_mode). Staff can hand-type the sheet.
   - Unclear: owner wants it? Not in CONTEXT.
   - Recommendation: yes, add a reason-code-only reject (small, symmetric with D-04). If declined, drop the corresponding test.
   - **RESOLVED:** yes. The backfill rejects any non-blank cell that is not exactly one of the 12 canonical keys. It matches the exact key only and does NOT normalise (`'IPA'` is rejected, not coerced; every writer stores canonical keys, so a non-canonical cell is a hand edit to fix on the sheet). The reject carries the reason code `invalid_beer_category` only and never echoes the cell value (Phase 85 redaction). Implemented in Plan 89-07.
2. **Does 85-DUAL-LOG / 85-14 verify run before the 89 promotion?**
   - Likely yes (89 promotes after 86/87 gates). Hence the pinned worktree must stay valid for the entire 7-day window, not just 85-13.
   - **RESOLVED:** yes. The pinned `d2c66be9` worktree rule stays in force for the whole 85-13 -> 85-14 window (backfill, verify and replay all run from it) and is removed only when Phase 89 reaches production with 0006 applied and the production sheet carries the `beer_category` header. Documented by Plan 89-01; the removal step is in the Plan 89-09 production promotion runsheet.
3. **Should admin surface the server 400 message?** Unreachable via the UI; leave as is unless the owner wants it.
   - **RESOLVED:** no change; admin keeps its generic save error (Plan 89-06).
4. **Assumption A1 (non-string / strips-to-empty input).**
   - **RESOLVED (accepted):** non-string input is rejected, and non-blank input that normalises to empty (for example `'123'`, `'--'`) is rejected rather than silently blanked. Null, undefined and whitespace-only input stay blank (''). Implemented identically in `recipe-rules.js` (Plan 89-01) and `adminApi.gs` (Plan 89-03, parity-tested).

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node | all | yes | default 20.20.2; 24.21.0 via nvm (`.nvmrc` = 24) | Use `nvm use 24` for all gates (tz tests, matches CI) |
| Docker daemon | `npm run test:db` | yes | 28.0.2, running | Locally skipped without Docker (D-14); CI has no skip |
| Postgres images | DB tests | yes | `postgres:18-alpine`, `postgres:16-alpine` cached | pull on demand |
| Railway CLI | staging tunnel/backfill | yes | 5.62.1 | — |
| gh | optional | yes | 2.74.0 | — |
| psql | staging table clear | **no** | — | `node` + `pg` one-liner or `docker run postgres:18-alpine psql` |
| Apps Script editor | v63 redeploy | owner action | — | Cannot be automated |

**Missing with no fallback:** none.

## Validation Architecture

> `workflow.nyquist_validation` is `false` in `.planning/config.json`; this section is included because the orchestrator explicitly requested it.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Jest ^29.7.0 (root: jsdom; middleware: node; DB: Testcontainers) |
| Config files | `jest.config.js` (root), `zoho-middleware/jest.config.js`, `zoho-middleware/jest.db.config.js` |
| Quick run (root) | `npx jest --config jest.config.js --coverage=false tests/frontend/<file>` |
| Quick run (middleware) | `cd zoho-middleware && npx jest __tests__/<file> --coverage=false` |
| Full suites | `npm test`; `cd zoho-middleware && npm test`; `cd zoho-middleware && npm run test:db` |
| Lint | `npm run lint`; `cd zoho-middleware && npm run lint` |
| Migration gates | `cd zoho-middleware && npm run migrate:guard` |
| Artifact drift | `bash scripts/check-artifact-drift.sh` (after `npm run build`) |

### Phase Requirements -> Test Map
| Decision | Behavior | Test Type | Automated Command | File Exists? |
|----------|----------|-----------|-------------------|-------------|
| D-03/D-04 | Normaliser parity middleware vs `.gs` | unit | `cd zoho-middleware && npx jest __tests__/recipe-rules-parity.test.js --coverage=false` | extend |
| D-03 | Apps Script ensure/create/update/mirror | unit (fake Sheets) | `npx jest --config jest.config.js --coverage=false tests/frontend/adminapi-recipe-beer-category.test.js tests/frontend/adminapi-recipe-mirror.test.js` | Wave 0 (new) + edit |
| D-03 | PG create/update/read, no CHECK | DB | `cd zoho-middleware && npx jest --config jest.db.config.js recipe-pg recipes-migration` | extend |
| 0006 | Guard + allowlist + apply | unit + DB | `cd zoho-middleware && npm run migrate:guard`; `npx jest --config jest.db.config.js migrations.test` | existing |
| D-04 | Route 400 / canonicalisation | unit | `cd zoho-middleware && npx jest __tests__/recipes-write-auth-guard.test.js __tests__/recipes.test.js --coverage=false` | extend |
| D-08/public | Allowlist carries field, nothing else | unit | `cd zoho-middleware && npx jest __tests__/recipes-public-guard.test.js --coverage=false` | extend |
| backfill | Spec headers, plan, verify | unit | `cd zoho-middleware && npx jest __tests__/backfill/recipes- --coverage=false` | edit |
| D-09/D-10 | Card tint / blank gold / unknown ignored | unit | `npx jest --config jest.config.js --coverage=false tests/frontend/catalog-recipe-tint.test.js tests/frontend/catalog-recipe-block.test.js` | Wave 0 (new) |
| D-11 | Editor carry (populate/read/save/clone) | unit | `npx jest --config jest.config.js --coverage=false tests/frontend/brewpad-recipes.test.js tests/frontend/brewpad-recipe-list-clone.test.js` plus new file | Wave 0 |
| drift | 12 keys identical across 4 copies + CSS | unit | new test (root jest, reads files) | Wave 0 |

### Sampling Rate
- **Per task commit:** the targeted quick-run commands above, plus `npm run lint` for touched trees.
- **Per wave merge:** `npm test` and `cd zoho-middleware && npm test` (Node 24).
- **Phase gate:** both full suites green, `npm run test:db` for the recipe DB files, lint both trees, `npm run migrate:guard`, `bash scripts/check-artifact-drift.sh`, before `/gsd:verify-work`.

### Wave 0 Gaps
- [ ] `tests/frontend/adminapi-recipe-beer-category.test.js` — D-03 Apps Script layer
- [ ] `tests/frontend/catalog-recipe-tint.test.js` — D-09 card
- [ ] editor carry tests, key-list drift test
- [ ] Framework install: none needed

### How DB tests run locally
`cd zoho-middleware && source ~/.nvm/nvm.sh && nvm use 24 && npm run test:db -- <name-filter>`. Needs a running Docker daemon (present). Testcontainers starts `postgres:18-alpine` (same major as Railway), applies `migrations/*.sql` via the node-pg-migrate binary, and wraps each test in a rolled-back transaction. Without Docker the suites skip locally (D-14); on CI (`CI=true`) a missing Docker fails the job. CI runs `npm run test:db` on every push and PR (`.github/workflows/tests.yml`). To avoid the 120 s hook flake, run a few files at a time or add `--maxWorkers=1`.

## Sources

### Primary (HIGH confidence, direct code inspection and execution this session)
- `apps-script/adminApi.gs` (4084-4410, 4692-4790, 5181-5200), `zoho-middleware/lib/{recipe-pg,recipe-rules,recipe-store,recipe-mirror}.js`, `routes/recipes.js`, `scripts/{migration-guard,migration-allowlist}.js`, `scripts/backfill/{recipes-backfill,recipes-verify,backfill}.js`, `specs/recipes.js`, `migrations/0003-0005`
- `js/modules/{04-label-cards,07-catalog-kits}.js`, `js/lib/constants.js`, `js/brewpad.js`, `js/admin.js`, `brewpad.html`, `admin.html`, `css/styles.css` 4405-4430 and 4813-4825, `package.json` build scripts, `scripts/check-artifact-drift.sh`
- `docs/RUNBOOK.md` (Apps Script 225-283, Phase 85 704-865), `.planning/phases/85-*/85-13-PLAN.md`, `.github/workflows/tests.yml`
- Executed: migration guard + allowlist on a temp dir with a draft 0006 (exit 0); prototype of the backend change in a scratch HEAD copy with full middleware jest, root jest, and Docker DB suites for recipe files and migrations
- `git diff d2c66be9 HEAD` on the backfill scripts (no changes), `git log -S` for the pricing_mode/schedule_id precedent

### Secondary (MEDIUM)
- Memory notes `phase-85-recipes-status`, `phase-89-beer-category-status`, `beer-launch-branch-ready`, `node-tzdata-bc-permanent-time` (project history; used for procedure context, not for code facts)

### Tertiary (LOW)
- none

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH, nothing new is introduced.
- Architecture / touchpoints: HIGH, every layer inspected and the backend slice prototyped and tested.
- Pitfalls: HIGH for backend/D-14/migration; MEDIUM for the unprototyped editor code (A5).

**Research date:** 2026-10-14
**Valid until:** until `adminApi.gs`, `recipe-pg.js` or the backfill specs change on `main` (re-verify line refs), otherwise ~30 days
