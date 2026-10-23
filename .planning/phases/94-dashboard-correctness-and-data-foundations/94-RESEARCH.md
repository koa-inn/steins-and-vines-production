# Phase 94: Dashboard correctness and data foundations - Research

**Researched:** 2026-10-23
**Domain:** BrewPad dashboard data layer (vanilla ES5 frontend) + Postgres batch store (Express/node-pg, Phase 87) + two gated production data backfills
**Confidence:** HIGH on code anchors and root causes (read directly from the repo); MEDIUM on the live-data arithmetic (no prod access this session); MEDIUM-LOW on the recipe `style` mapping (free text, no data seen)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Scope and timing**
- **D-01:** Plan now; **build after the Phase 87 batches→Postgres production cutover**. B3 (`batch_type` column) and S1 (aggregate endpoint) target the Postgres batch store only. They do not need to work under `BATCHES_STORE=sheets`, which resolves the 87 collision noted in ROADMAP. If 87 is delayed, Phase 94 waits rather than building dual-mode.
- **D-02:** Approved items are B1, B2, B3, D1 and S1. Every other §7 item stays out of scope until its own phase's discuss step.
- **D-03:** The corrected numbers (B1, D1) go **live on the current dashboard** as soon as Phase 94 ships. They are not behind `?dash=v2`. The `?dash=v2` flag is for the Phase 95+ redesign.

**Batch type (B3)**
- **D-04:** Types are `wine | beer | cider | seltzer | other`. Seltzer stays because BrewPad's schedules and month chart already use it (`KNOWN_BATCH_TYPES`, js/brewpad.js:299).
- **D-05:** Automatic derivation order, first match wins:
  1. recipe `style`, for a recipe-linked batch;
  2. Zoho product `cf_type` by SKU/item_id, **never by product name**;
  3. fermentation schedule category, the signal today's `resolveBatchType` uses;
  4. product-name fallback;
  5. `other`.
- **D-06:** Staff can **edit the type on the batch** in the detail pane. A hand-set type is recorded as such, e.g. `batch_type_source = 'manual'`. Automatic rules and backfills **never overwrite** a manual type.
- **D-07:** When no rule matches, save as `other` and list the batch on a **"needs a type"** list so staff can correct it. Unknown type **never blocks** batch creation (kiosk, online, zoho_scan or manual).
- **D-08:** Set the type on create for every path: kiosk, kiosk_recipe, online, zoho_scan and manual. Record which rule decided it (`batch_type_source`: recipe | zoho | schedule | name | other | manual).
- **D-09:** The existing-rows backfill is a production write. It ships as a `--dry-run` script that lists **every** batch with its proposed type and deciding rule. The owner reviews the full list in-session, then OKs the real run.

**Cycle time (B1)**
- **D-10:** Cycle time = `completed_at − start_date`, counted only for batches that have `completed_at`. Start is the batch's `start_date`, not `created_at`.
- **D-11:** Tile layout:
  - The big number is the **median** days.
  - Beside it: the **mean**, and "based on N batches, M excluded" (completed but no `completed_at`).
  - Below it: a small row per type (e.g. Wine 63d · Beer 24d · Cider 30d). Types with no completed batches are hidden.
- **D-12:** Staff/family and `source: research` batches **count** toward cycle time (production metric).
- **D-13:** Acceptance: the median and mean are within ±1 day of an independent recompute from the batch data. The handoff's baseline is mean 63 and median 64 over 125 batches; the current tile wrongly shows 173.

**Completed-date backfill (B2)**
- **D-14:** Source is the **latest task `completed_at`** on the batch. If a batch has no completed task, **leave `completed_at` blank** and it stays excluded. **No `last_updated` fallback**, because it often reflects unrelated edits.
- **D-15:** Backfilled dates are marked as estimated with a source field, e.g. `completed_at_source = 'backfill-task'`, so they can be told apart from real completions and excluded later.
- **D-16:** Ships as a `--dry-run` script listing every batch with its proposed date and source. The owner reviews the full list in-session, then OKs the real run. Writes go through the batch store's update path with nested `updates:{}`.

**Totals and the data layer (D1)**
- **D-17:** Totals count **started batches only**: primary, secondary and complete. Pending, disabled and deleted are excluded. Pending keeps its own count where the dashboard already shows one.
- **D-18:** Month and year bucketing uses **`start_date`** for "started" counts and **`completed_at`** for "completed" counts.
- **D-19:** "This year" is the **calendar year**, Jan 1 to today, in America/Vancouver time.
- **D-20:** One `getDashboardData(filters)` layer, one classifier using the stored `batch_type`, and one date-window helper feed every widget. Type totals must agree across widgets by construction; this fixes F4 (120 vs 122 vs 204).

**Server aggregate (S1)**
- **D-21:** The dashboard loads from one lean aggregate call through the admin-proxy seam, cached about 60 s. It replaces the per-batch `get_batch` N+1. It returns lean rows: id, type, status, dates, vessel, source, product, subcategory, volume, task due/complete dates, latest reading. Postgres-backed per D-01.

### Claude's Discretion
- Field names for the source markers (`batch_type_source`, `completed_at_source`) and the migration shape. These follow the existing migration conventions (`zoho-middleware/migrations/000N_*.sql`) and the Apps Script mirror column rules.
- Whether S1 extends the existing `get_batch_dashboard_summary` / `getDashboardSummary` path or adds a new action.
- Exactly how the "needs a type" list surfaces in Phase 94. A minimal list or filter is enough; the full data-health card is G10 in Phase 96.
- Recipe `style` → type mapping details. Use recipe `beer_category` from Phase 89 where present.

### Deferred Ideas (OUT OF SCOPE)
- Every other §7 item is decided at its own phase: D2–D5 (Phase 95), G1–G10 (96), beer/cider sections (97), A1–A5 (98), responsive/perf (99).
- A richer "data health" card is G10 in Phase 96. Phase 94 only needs a minimal "needs a type" list.
- Reviewed todos (not folded): `todo.match-phase 94` returned 19 keyword matches, none about dashboard correctness, batch typing or the aggregate.
</user_constraints>

<phase_requirements>
## Phase Requirements

No formal REQ-IDs exist for Phase 94. The requirement set is handoff items B1, B2, B3, D1, S1 plus decisions D-01..D-21.

| ID | Description | Research Support |
|----|-------------|------------------|
| B1 | Cycle-time KPI fix (D-10..D-13) | Root cause located at `js/brewpad.js:4015-4034`; day-diff recipe on Vancouver date strings (see Code Examples); median/mean/excluded contract |
| B2 | `completed_at` backfill (D-14..D-16) | Existing `batches-replay-to-sheet.js` / RUNBOOK §16 pattern; `completed_at` IS a mirrored sheet column so a mirror replay is required; `FIELD_KINDS` already allows `completed_at` |
| B3 | Explicit `batch_type` (D-04..D-09) | Single create choke point `batch-pg-create.createBatch`; migration `0007`; PG-only columns avoid Apps Script change and golden-test breakage; Zoho `cf_type` available via `zoho:kiosk-products` cache |
| D1 | One data layer (D-17..D-20) | Exact reasons the three widgets disagree; pure `getDashboardData` / `dashboardWindow` helpers with invariants to test |
| S1 | Lean aggregate (D-21) | New read action `get_dashboard_stats` on `/api/batch/admin-proxy` only; in-process 60 s memo invalidated in `batch-store.finish()`; pinned-test constraints |
</phase_requirements>

## Summary

The dashboard does not actually do a per-batch `get_batch` N+1 today. It loads `get_batches?status=all` (206 rows, `_allBatchesData`) plus `get_batch_dashboard_summary` and `get_tasks_upcoming` (`eagerLoad`, js/brewpad.js:3866). The N+1 is what Phases 96/98 would need for task and reading data. The S1 aggregate therefore does two jobs in Phase 94: it is the single data source for the corrected numbers, and it is the foundation the later phases extend. The wrong numbers are all client-side arithmetic bugs in `renderDashboard` and its helpers, and are fixable without touching the server. The server work is only needed for the stored `batch_type`, the lean aggregate, and the two backfills.

Every Postgres batch create goes through ONE function, `createBatch` in `zoho-middleware/lib/batch-pg-create.js`, reached from `batch-store.create`. The kiosk, online, zoho_scan and kiosk_recipe paths all call `brewpadIntegration.callAppsScriptCreateBatch`, which calls `store.create` in postgres mode. BrewPad manual create arrives through `/api/batch/admin-proxy` to `batch-proxy` to `store.create`. Computing the type in that one place (a pure function in `batch-rules.js` fed with pre-resolved hints) covers D-08 for all five sources. Pending batches have no schedule at create time, so schedule rule 3 only becomes available later; the type must be re-derived when a schedule or recipe is attached, unless it was set manually.

The most important design finding: **keep `batch_type`, `batch_type_source` and `completed_at_source` Postgres-only.** The sheet mirror (`mirror_batch_state` → `_mirrorKeyToHeaders`) silently drops keys that have no sheet header, so no Apps Script change, no new Apps Script version and no sheet column is needed, and the Phase 89 `missing_header` reject trap cannot fire. Adding the keys to `BATCH_COLUMNS` instead would break golden tests (`Object.keys(bundle.batch)` must equal `BATCH_COLUMNS`), the pinned 33-header spec, and the daily drift check's `headersMatch`. `unit_seq` is the existing precedent for a PG-only column.

**Primary recommendation:** Add migration `0007` with three nullable PG-only columns; compute type once in `createBatch` via a pure `classifyBatchType()` in `batch-rules.js`; add a new read action `get_dashboard_stats` (separate map, not `ACTION_TO_OP`, to avoid editing pinned tests); build the client on pure `dashboardWindow()` + `getDashboardData()` helpers fed by that action; ship both backfills as `--apply`-gated PG scripts that default to dry-run, followed by a `batches-replay-to-sheet` run for `completed_at`.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Type derivation on create | API / Backend (`createBatch`) | Redis catalog cache (Zoho `cf_type` hint) | Single choke point; must not depend on the caller, and no per-create Zoho call |
| Type storage + source marker | Database (`batches` cols) | — | Explicit, queryable, survives re-derivation rules |
| Manual type edit | Browser (detail pane control) | API (`update_batch` `updates:{}`) | D-06; server validates the enum and stamps `manual` |
| Lean aggregate + 60 s memo | API / Backend | Database | Removes N+1; cache must be invalidated by writes |
| Date windows, "today", "this year" | API (returns `asOf`) | Browser (pure helper on date strings) | Server owns the Vancouver clock; client does string compares only |
| Cycle-time / totals math | Browser (pure `getDashboardData`) | — | Needs to re-run per filter in Phase 95 without a round trip |
| completed_at / batch_type backfills | CLI in the Railway container | Database, then sheet mirror replay | Production writes behind a dry-run and owner OK |
| "Needs a type" list | Browser (from aggregate rows) | — | Minimal surface per Claude's discretion |

## Standard Stack

No new libraries are needed. Everything below is already in the repo. [VERIFIED: grep of `zoho-middleware/package.json` and `package.json`]

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| node-postgres via `lib/db.js` (`withTransaction`) | existing | all DB access | Phase 83 convention; modules take a `client`, never create a pool |
| `node-pg-migrate` + `libpg-query` allowlist | existing (`libpg-query@16.7.3`) | migration `0007` | `npm run migrate` runs guard + allowlist before apply |
| Jest 29 (+ jsdom for `tests/frontend`) | ^29.7.0 | all tests | project standard |
| Testcontainers PG (`@testcontainers/postgresql@11.14.0`) | existing | real-PG tests via `npm run test:db` | existing harness at `__tests__/db/helpers/pg-harness.js` |
| `Intl.DateTimeFormat` (Node 24 tzdata) | built-in | Vancouver "today" and tz conversion | already used in `batch-rules.js` `zoneParts` / `formatDay` |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| In-process 60 s memo | Redis (`lib/cache.js`) | Redis survives restarts and spans instances but adds a round trip to every read; the aggregate is cheap to recompute (206 rows). Use in-process; 60 s TTL bounds cross-instance staleness |
| PG-only columns | Add to `BATCH_COLUMNS` + sheet headers + Apps Script ensure helper | Mirrors the type to the sheet, but breaks golden/spec/drift tests and needs an Apps Script version (shared by staging+prod). Not worth it: D-01 drops sheets mode |
| New action `get_dashboard_stats` | Extend `get_batch_dashboard_summary` | The summary shape is pinned to Apps Script golden output (`golden.json`); extending it breaks parity tests |

**Installation:** none.

## Package Legitimacy Audit

No external packages are installed by this phase. slopcheck is not applicable. **Packages removed:** none. **Packages flagged:** none.

## Architecture Patterns

### System Architecture Diagram

```
 CREATE PATHS (all converge)                                    READ PATH
 kiosk sale ─┐                                                  BrewPad dashboard
 online ─────┤ brewpad-integration.createBatchesFromSale        │  eagerLoad()/loadDashboard()
 zoho_scan ──┤   └ callAppsScriptCreateBatch ─┐                 ▼
 kiosk_recipe┤   (detectRecipeSale)           │          POST /api/batch/admin-proxy
 manual UI ──┴─ /api/batch/admin-proxy ─ batch-proxy ┐          action=get_dashboard_stats
                                                      ▼          │ requireTiers(legacy|session)
                                          batch-store.create     ▼
              resolve hints BEFORE tx:                   batch-proxy (separate STATS map)
              zoho cf_type from Redis                           │
              'zoho:kiosk-products' by sku/item_id              ▼
                                                      batch-store.dashStats()
                                    │                   ├ memo hit (<60s) → return
                                    ▼                   └ miss → one tx, read-only:
                       batch-pg-create.createBatch            lean batches SQL + active tasks
                         classifyBatchType(hints) ──► INSERT     + latest reading + summary
                           (batch_type, batch_type_source)       (to_char dates, no snapshots)
                                    │                                │
              WRITES (update/updateSchedule/updateTask/...) ─► finish() ─► memo.clear()
              + re-derive type when schedule/recipe attached
                         (skip if source = 'manual')

 CLIENT (pure, ES5):  rows + asOf ─► dashboardWindow(key, asOf.today)
                                  ─► getDashboardData(rows, asOf, filters)
                                        ├ started[]  (status ∈ primary/secondary/complete, start_date in window)
                                        ├ completed[] (completed_day in window)
                                        ├ totals.byType, monthBuckets, cycle{median,mean,n,excluded,byType}
                                        └ needsType[]
                                  ─► renderDashboard widgets (tiles, month chart, wine breakdown)

 BACKFILLS (container): batch-type-backfill / completed-at-backfill (dry-run default, --apply)
        └ pgUpdate.updateBatch(opts.trusted) per batch ─► batches-replay-to-sheet --since --apply (completed_at only)
```

### Recommended Project Structure
```
zoho-middleware/
├── migrations/0007_batch_type.sql            # 3 nullable cols (PG-only)
├── lib/batch-rules.js                        # + classifyBatchType, BATCH_TYPES, buildDashboardStats (pure)
├── lib/batch-pg-read.js                      # + getDashboardStats(client, opts)
├── lib/batch-pg-create.js                    # + batch_type/_source on INSERT
├── lib/batch-pg-update.js                    # + batch_type in FIELD_KINDS, re-derive hooks
├── lib/batch-store.js                        # + dashStats() memo, invalidate in finish()
├── lib/batch-proxy.js                        # + STATS_ACTION_TO_OP (separate map)
├── routes/pos.js                             # + get_dashboard_stats in ADMIN_PROXY_ACTIONS/READS ONLY
├── scripts/backfill/batch-type-backfill.js   # dry-run default
├── scripts/backfill/completed-at-backfill.js # dry-run default
└── __tests__/ (+ __tests__/db/ for real-PG)
js/brewpad.js                                 # + pure helpers at top level, exported at bottom
tests/frontend/brewpad-dashboard-data.test.js # new file
```

### Pattern 1: PG-only column, not in `BATCH_COLUMNS`
**What:** `unit_seq` already lives only in Postgres (comment in `lib/batch-compare.js:19`; absent from `BATCH_COLUMNS`). Do the same for the three new columns.
**Why it works:** `ops-mirror.buildMirrorRequest` sends `serializeBatch(row)` (BATCH_COLUMNS only); Apps Script `_mirrorKeyToHeaders` re-keys onto existing sheet headers and silently ignores anything else. `batch-compare.compareTable` iterates `spec.columns` only, so extra PG columns never register as drift. `headersMatch` compares the sheet header row to the pinned 33 headers, so the sheet must NOT gain a column. [VERIFIED: apps-script/adminApi.gs:5152 `mirrorBatchState`, `_mirrorKeyToHeaders`; lib/batch-compare.js]
**Consequence:** get_batches/get_batch output stays byte-identical, so the golden `toEqual` tests (`__tests__/batch-rules.test.js`, `__tests__/db/batch-pg-read.test.js`) are untouched. The type is exposed only through the new aggregate. The cost is that a rollback to sheets mode loses types; acceptable per D-01.

### Pattern 2: Pure classifier with pre-resolved hints
```js
// lib/batch-rules.js  (pure, ES5-style like the rest of the module)
var BATCH_TYPES = ['wine', 'beer', 'cider', 'seltzer', 'other'];
function normType(v) { var s = String(v || '').trim().toLowerCase(); return BATCH_TYPES.indexOf(s) !== -1 ? s : ''; }
// hints = { recipeType, zohoCfType, scheduleCategory } resolved by the caller, never fetched here.
function classifyBatchType(batch, hints) {
  var h = hints || {};
  var t;
  if ((t = normType(h.recipeType)) && t !== 'other') return { type: t, source: 'recipe' };
  if ((t = normType(h.zohoCfType)) && t !== 'other') return { type: t, source: 'zoho' };
  if ((t = normType(h.scheduleCategory)) && t !== 'other') return { type: t, source: 'schedule' };
  if ((t = nameType(batch && batch.product_name))) return { type: t, source: 'name' };
  return { type: 'other', source: 'other' };
}
```
`nameType` is a conservative keyword map (`cider`, `seltzer`, `lager|ale|ipa|stout|pilsner|porter|saison`, `wine|merlot|chardonnay|...`). Keep it tiny; anything it cannot place lands on the "needs a type" list rather than guessing.

### Pattern 3: Aggregate reads dates as strings in SQL
`node-pg` returns `date` as local-midnight `Date` and `batch-rules` reads it with local getters. For the new lean SQL avoid that entirely: `to_char(start_date, 'YYYY-MM-DD') as start_date` and `to_char(completed_at at time zone 'America/Vancouver', 'YYYY-MM-DD') as completed_day`, plus the raw ISO `completed_at`. The client then works on date strings only (no Date, no DST, no local getters).

### Pattern 4: Memo + write invalidation
`batch-store.finish(raw)` is the one place every successful write passes through (including public task/reading writes). Clear the memo there (also on `remove`). Without this, an edit followed by a dashboard refresh serves ≤60 s stale numbers, the same class of bug as the Apps Script `gb:<batchId>` cache incident (memory: "writes must send batch_id"). In postgres mode there is no `gb:` cache at all (batch-pg-read.js header: "Nothing here is cached"), so the memo is new state you own.

### Anti-Patterns to Avoid
- **Adding the new keys to `serializeBatch` / `BATCH_COLUMNS`:** breaks pinned golden, spec-header and drift tests (see Pitfall 1).
- **Adding the action to `ACTION_TO_OP` or `ADMIN_PANEL_PROXY_ACTIONS`:** both are pinned by existing tests (`batch-proxy-routes.test.js` "exactly the 17 batch-data actions"; `admin-proxy.test.js` "total 39"). CLAUDE.md rule 10 forbids editing them unasked.
- **Calling Zoho or Redis inside the create transaction:** `__tests__/db/batch-create-latency.test.js` guards create latency. Resolve hints before `runPg`.
- **Letting a client-sent `batch_type_source` through:** the source marker is server-stamped only.
- **Using `new Date()` / `getFullYear()` in the client windows:** use the server `asOf.today` string.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Vancouver "today"/year | Client `new Date()` math | `batch-rules.zoneParts`/`formatDay` server-side, returned as `asOf` | Already proven, injectable clock, Node 24 tzdata |
| Row updates in backfills | Ad-hoc `UPDATE` SQL | `batch-pg-update.updateBatch` (lock row, validate, bump `last_updated`) | D-16; keeps the version token and validation |
| Sheet re-sync after `completed_at` backfill | New mirror code | `scripts/backfill/batches-replay-to-sheet.js --since --apply` | Existing, idempotent, ids-only output |
| CLI arg safety | New parser | copy `parseArgs` from `batches-replay-to-sheet.js` (refuses Postgres URLs on argv, DB only via `BACKFILL_DATABASE_URL`) | Phase 83 convention |
| Enum validation | Postgres CHECK | App-level check in `batch-rules.js` | Phase 89 D-03: allowlist forbids `DROP CONSTRAINT`, so down-migrations can't remove a CHECK |
| Median/mean | Library | ~15 lines of pure ES5 | Needs to be exported and unit-tested anyway |

**Key insight:** every hard part of this phase (locking, optimistic version, mirror, dry-run CLI, Vancouver clock) already exists. The work is wiring and keeping pinned tests green.

## Root causes (reproduced from code)

### F1: "Avg days to complete 173"
`js/brewpad.js:4015-4034`. For each batch: `yr = parseInt(start_date.slice(0,4))`; `ytdComplete++` when `yr === thisYear && status === 'complete'` (this is a start-year test, not a completion test), then `daysDone = Math.floor((Date.now() - new Date(b.start_date)) / 86400000)`. That is **now minus start**, not completion minus start. Batches finished months ago keep ageing every day, so the figure drifts up without bound (all batches started Feb to Oct 2026, hence ~173). It also ignores `completed_at` entirely, divides by the wrong population (includes the 40 with no `completed_at`), uses browser-local `new Date().getFullYear()`, and parses `'YYYY-MM-DD'` as UTC midnight. "Completed this year" (165) shares the same wrong predicate and only matches the all-time `completeCount` because every batch in the system started in 2026. [VERIFIED: code read]

### F4: 120 vs 122 vs 204 [MEDIUM: numbers from the handoff, mechanism from code]
- **Month chart (120):** `bucketBatchesByMonthType(..., 6)` counts all types and all statuses whose `start_date || created_at` month key is one of the last 6 calendar months (May 1 onward at the time).
- **Wine breakdown (122):** `bucketWineDimension(..., 180)` counts wine only over a **rolling 180 days** (cutoff about Apr 20, UTC math), same `start_date || created_at` fallback, and wine membership by `resolveBatchType` (schedule category). Different window and different type filter.
- **Started this year (204):** calendar year of `start_date`, all statuses and all types. 204 equals 206 minus the 2 pending batches (no `start_date`), so it is already the right answer under D-17.
- Fix is structural (D-20): one started-set, one window helper, one stored type. The month-chart legend (Wine 110, Cider 4, Other 6) and the wine breakdown cannot disagree if both read the same filtered list.

### Why 40 batches lack `completed_at`, and why it will recur
`completed_at` is written only by packaging-task completion (`batch-pg-tasks.js` `onPackagingCompleted`, `patchBatch({status:'complete', completed_at: now})`). The BrewPad status badge (js/brewpad.js:~6610-6640) cycles primary→secondary→complete with `update_batch {updates:{status:next}}` and `batch-pg-update.updateBatch` does NOT stamp `completed_at` when status becomes `complete`. So any batch completed via the badge, or imported while legacy, has none. See Open Question 2.

## Common Pitfalls

### Pitfall 1: Breaking pinned/golden tests by touching shared shapes
**What goes wrong:** Adding keys to `BATCH_COLUMNS`/`serializeBatch`/`buildBatchList` fails `Object.keys(bundle.batch)).toEqual(BATCH_COLUMNS)`, the golden `toEqual`s, the 33-header spec test (`batches-spec-headers.test.js`) and the drift check's `headersMatch`.
**Avoid:** PG-only columns; expose them only in the new aggregate. If the owner prefers the type in `get_batch`, that needs explicit owner approval to edit tests (Phase 89 D-12 precedent) and must be named in the plan.
**Warning sign:** a red golden test after a "small" serializer change.

### Pitfall 2: Pinned proxy allowlists
**What goes wrong:** `batch-proxy-routes.test.js` asserts `ACTION_TO_OP` has exactly 17 keys and iterates it per proxy; `admin-proxy.test.js` pins `/api/admin/proxy` to 15 reads + 24 writes (39).
**Avoid:** keep `ACTION_TO_OP` untouched; add a second map (`STATS_ACTION_TO_OP = { get_dashboard_stats: 'dashStats' }`) that `intercept` also consults; add the action only to `ADMIN_PROXY_ACTIONS` and `ADMIN_PROXY_READS` (the BrewPad proxy, routes/pos.js ~4290-4340), not to the admin-panel lists. The single-issuer test (`batch-single-issuer.test.js`) only scans the six named write/list actions, so the new name is safe.
**Sheets-mode behaviour:** with `BATCHES_STORE` unset the intercept returns false and the request forwards to Apps Script, which answers `invalid_action`. The client must degrade to the existing `get_batches` path (cheap, keeps staging-on-sheets working).

### Pitfall 3: Phase 89 `missing_header` trap (and why it does not apply here)
`checkHeaders` counts ANY missing spec header as a reject and 89's D-14 forced pinned-checkout rules for the 85-13 backfill. This only bites if a column is added to a **sheet spec** (`specs/batches.js`). With PG-only columns the spec, verify, replay and drift scripts are unchanged, so no pinned-worktree procedure and no Apps Script redeploy are required. If the plan deviates (columns on the sheet), copy the 89 mitigation wholesale and treat Apps Script as a versioned deploy shared by staging and prod (rollback version must be recorded).

### Pitfall 4: Pending batches have no schedule at create
Kiosk/online/zoho_scan batches are created `pending` with no `schedule_id`, so rule 3 (schedule category) can never fire at create, and rule 1 needs a recipe. The create-time type for a kit therefore depends on rule 2 (Zoho `cf_type`) or the name fallback. **Re-derive** (source not `manual`, and prior source in `name|other|`null) when `updateBatchSchedule` or the activation `update_batch` attaches a schedule, and when `recipe_id`/`recipe_snapshot` is attached. Hook points: `batch-pg-update.updateBatch` (after values prepared) and `updateBatchSchedule`. Never overwrite `manual`.

### Pitfall 5: Zoho `cf_type` availability and shape
`routes/catalog.js` kiosk cache entries carry `item_id`, `sku`, `cf_type`, `cf_subcategory`, `brand`, `manufacturer` (catalog.js ~860-875), Redis key `C.CACHE_KEYS.KIOSK_PRODUCTS = 'zoho:kiosk-products'`. Kit `cf_type` values compared lowercase against `KIT_CATEGORIES = ['wine','beer','cider','seltzer']` (constants.js:123, discount-match.js). Batch `product_sku` is `item.sku || item.item_id`, so index the cache by BOTH. The cache can be cold/expired and excludes some items; treat a miss as "no hint" and fall through. `createBatchesFromSale`'s `catalogMap` argument is `item_id → rate` on the online path (`routes/checkout.js:341-362`) and null on two callers, so it is NOT a usable cf_type source; read the Redis cache instead (async, before the transaction). [VERIFIED: code read]

### Pitfall 6: Recipe `style` is free text; Phase 89 rejected style inference
D-05 puts "recipe style" first, but Phase 89 recorded "No keyword inference from the free-text `style` (owner rejected it as a maintenance trap)" (89-CONTEXT). Reconcile conservatively: rule 1 = `recipe_snapshot.beer_category` present (and in `BEER_CATEGORY_KEYS`) → `beer` (explicit, staff-set); otherwise a short exact-token match on `style` for `cider`/`seltzer`/`wine`/`mead`-style words; otherwise fall through to later rules. Do not infer beer from style words. Surface the choice to the owner (Open Question 1). Recipe batches use `product_sku = recipe_id` (`detectRecipeSale`), so rule 2 cannot match them. `recipe_snapshot` is stored as a JSON string and its contents depend on what the caller serialised; verify `beer_category` is in it before relying on it (the snapshot comes from `pos-recipe.js`; check at plan time).

### Pitfall 7: Dead schedule-snapshot rule
`resolveBatchType` step 3 reads `schedule_snapshot.category`, but `schedule_snapshot` is a JSON **array of steps** (`updateBatchSchedule` rejects non-arrays), so `.category` is always undefined. Rule 3 must use `ferm_schedules.category` via `batches.schedule_id` (SQL join in the aggregate/backfill, `schedulePg.getSchedule` at create). [VERIFIED: batch-pg-update.js; ferm-schedule-pg.js]

### Pitfall 8: Timezone and Node version
Local shell is Node v20.20.2 but the repo is Node 24 (`.nvmrc` 24; middleware `engines 24.x`). Node 20's tzdata treats America/Vancouver as UTC-8 permanently from 2026-11-01 (backfill README). Run all tests with `nvm use` (Node 24) or date-window tests will flip after that date. Prod is on Node 24 (memory: tzdata fix live 2026-10-16). Use fixed `asOf`/`now` in tests, never the wall clock.

### Pitfall 9: Stale per-batch detail snapshot
BrewPad caches `sv-bp-batch-<id>` in sessionStorage for 2 min. A type edit must go through `afterBatchWrite(batchId, {refreshOpenDetail:true, listAffecting:true})` (it clears the snapshot and sets `_dashLoadTime = 0`), and the `update_batch` call must send `batch_id`, nested `updates:{batch_type:'…'}` (top-level fields return `{ok:true}` and change nothing).

### Pitfall 10: Migration ordering on prod
Latest migration is `0006_recipes_beer_category.sql` (Phase 89, staging only; memory says prod promotion needs 0006 after 0004/0005). `0007` must apply after 0006 on production (node-pg-migrate order check). The Phase 94 prod deploy therefore also promotes 0006; confirm 0006's prod status at plan time. Allowlist: `ADD COLUMN` is allowed; no CHECK, no backslashes, no NUL, no `DO`/functions. Never edit an applied migration.

### Pitfall 11: Backfill output hygiene
Convention: ids, counts and field names only. For D-09 the owner must judge every proposed type, so print `batch_id`, proposed type, deciding rule and `product_sku` (not customer names/emails). If the owner wants product names to review, that is a deliberate exception to flag in the plan. Never put `BACKFILL_DATABASE_URL` on argv; run in-container (`railway ssh`, `BACKFILL_DATABASE_URL=$DATABASE_URL`) because `railway connect` from `zoho-middleware/` fails (memory: phase-84).

## Code Examples

### Cycle-time day difference on date strings (no Date, no DST)
```js
// js/brewpad.js top-level pure helpers (ES5)
function dayNumber(ymd) {                 // 'YYYY-MM-DD' -> integer days since epoch
  var p = String(ymd).split('-');
  return Math.floor(Date.UTC(+p[0], +p[1] - 1, +p[2]) / 86400000);
}
function cycleDays(startYmd, completedYmd) {
  if (!startYmd || !completedYmd) return null;
  var d = dayNumber(completedYmd) - dayNumber(startYmd);
  return d >= 0 ? d : null;               // negative = bad data, counted as excluded
}
function median(sorted) {
  var n = sorted.length; if (!n) return null;
  var m = Math.floor(n / 2);
  return n % 2 ? sorted[m] : (sorted[m - 1] + sorted[m]) / 2;
}
```
`completed_day` and `start_date` come from the aggregate as Vancouver `'YYYY-MM-DD'` strings (SQL `to_char`). Result object: `{ n, excluded, median, mean, byType: {wine:{n,median,mean}, ...} }` where `excluded` = status `complete` and (no `completed_day` or negative span). Hide `byType` entries with `n === 0`.

### Date-window helper
```js
// asOfToday = server-provided 'YYYY-MM-DD' (Vancouver). Returns inclusive string bounds.
function dashboardWindow(key, asOfToday) {
  var y = asOfToday.slice(0, 4);
  if (key === 'ytd') return { start: y + '-01-01', end: asOfToday };
  if (key === 'all') return { start: '0000-01-01', end: asOfToday };
  var days = { '30d': 30, '90d': 90, '6mo': 180, '12mo': 365 }[key];
  return { start: addDays(asOfToday, -(days - 1)), end: asOfToday };  // addDays via dayNumber/UTC
}
function inWindow(ymd, w) { return !!ymd && ymd >= w.start && ymd <= w.end; }   // string compare is safe for ISO dates
```
"Started" = `STARTED_STATUSES[status]` (primary/secondary/complete) and `inWindow(start_date, w)`. "Completed" = `inWindow(completed_day, w)`. A future-dated `start_date` is outside `[Jan 1, today]` and is not "started yet" (D-19).

### Invariant to assert in tests
```js
// for every window and every type filter:
expect(sum(TYPES, t => data.totals.byType[t])).toBe(data.totals.all);
expect(monthBuckets.reduce((a, m) => a + m.total, 0)).toBe(startedInMonthRange.length);
expect(wineBreakdownTotal).toBe(data.totals.byType.wine);   // when no SKU-lookup drops
```

### Migration 0007 (shape)
```sql
-- 0007_batch_type.sql — Phase 94: explicit batch type and completion-date source markers.
-- Additive only (83 D-04). Postgres-only columns (like unit_seq): NOT mirrored to the sheet and
-- NOT in BATCH_COLUMNS, so no Apps Script change and no sheet header (94 research). No CHECK
-- constraint (89 precedent: the allowlist forbids DROP CONSTRAINT); the enum is enforced in
-- lib/batch-rules.js. NULL batch_type = not yet classified.
-- Up Migration
alter table batches add column batch_type text;
alter table batches add column batch_type_source text;
alter table batches add column completed_at_source text;
-- Down Migration
alter table batches drop column completed_at_source;
alter table batches drop column batch_type_source;
alter table batches drop column batch_type;
```
(Check `migration-allowlist.js` accepts `drop column` in the Down section the same way `0006` does; it does for 0006.)

### Aggregate response shape (recommended)
```
{ ok:true, data: {
    asOf: { today:'2026-10-23', year:2026, tz:'America/Vancouver' },
    batches: [ { batch_id, status, batch_type, batch_type_source, start_date, completed_day, completed_at,
                 completed_at_source, vessel_id, source, product_sku, product_name, recipe_id, schedule_id,
                 schedule_category, target_volume_l, tasks_total, tasks_done } ... ],
    tasks:   [ { batch_id, due_date, completed, completed_at, is_packaging, is_transfer } ... ],  // active batches only
    latestReadings: [ { batch_id, reading_at, degrees_plato, temperature, ph } ... ],            // active, distinct on (batch_id)
    summary: { ...buildDashboardSummary output... }                                              // one round trip for attention lists
} }
```
Excluded on purpose: `schedule_snapshot`, `recipe_snapshot`, `access_token`, `customer_*`, `notes` (heavy or PII). `subcategory`: not stored on a batch. Either (a) the client keeps joining `product_sku` against `/content/zoho-snapshot.json` as the wine breakdown does today (snapshot generated 2026-07-08, 250 products, so newer SKUs fall to "Unknown"), or (b) the server joins from the `zoho:kiosk-products` cache and returns `product_subcategory`/`brand` with `''` on a miss. Recommend (b) with (a) as fallback; see Open Question 5.

## Batch create paths (where the type is set)

| Path | `source` | Entry | Reaches |
|------|----------|-------|---------|
| Kiosk POS sale / SO pay | `kiosk` | `routes/pos.js` ~1908, ~2766 → `createBatchesFromSale` | `callAppsScriptCreateBatch` → `store.create` |
| Online checkout | `online` | `routes/checkout.js:682` | same |
| Zoho invoice scan bulk-create | `zoho_scan` | `routes/pos.js` ~3700 | same |
| Kiosk recipe sale | `kiosk_recipe` | `detectRecipeSale` (brewpad-integration.js ~850) | same; `recipe_id`, `recipe_snapshot` present |
| BrewPad manual / internal | `manual` / `internal` | `/api/batch/admin-proxy` `create_batch`, `hardenProxyPayload` coerces source | `batch-proxy` → `store.create` |
| Retry sweep | (original) | `retryPendingBatches` re-calls `callAppsScriptCreateBatch` | same: type computed at retry time |

In `batch-store.create(payload, opts)`: before `dispatch`, await a `resolveTypeHints(payload)` (Redis cache lookup by `product_sku`, plus recipe type from `payload.recipe_snapshot`), then pass `hints` into `pgCreate().createBatch`. Inside `createBatch` the schedule category is already available (`schedule` is read in-transaction), so only rule 3 is computed there. A client-supplied `batch_type` is honoured only for staff creates (source `manual`/`internal`), stored with source `manual`; automated sources ignore it. Add the two columns to `INSERT_BATCH_SQL` as `$29, $30`. Replay (`replayResult`) and dedup paths do not re-classify.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Apps Script `get_batches` + `gds/gb:` caches | Postgres store, no read cache | Phase 87 | S1 must add its own memo and invalidation |
| Type inferred at render (`resolveBatchType`) | Stored `batch_type` + source | Phase 94 | `resolveBatchType` stays only as the client fallback for NULL rows (staging on sheets, pre-backfill) |
| `BEER_CATEGORY` explicit field | Phase 89 `recipes.beer_category` | 2026-10-15 | Strongest recipe signal for beer |

**Deprecated/outdated:** `resolveBatchType` step 3 (`schedule_snapshot.category`) is dead code (Pitfall 7). `bucketBatchesByMonthType`'s `start_date || created_at` fallback conflicts with D-18/D-17 and must go in the new path (pending batches have no `start_date` and are excluded).

## Backfill design

**B3 `batch-type-backfill.js`** (dry-run default, `--apply` required to write; accepts `--dry-run` explicitly for CONTEXT parity)
1. Read-only transaction: all batches (`batch_id, product_sku, product_name, schedule_id, recipe_id, recipe_snapshot, batch_type_source`) joined to `ferm_schedules.category`.
2. Hints per batch: recipe type from `recipe_snapshot`; Zoho `cf_type` from a live all-items fetch (the list endpoint carries `cf_type`, no enrichment needed; see catalog.js:527 comment) indexed by `sku` and `item_id`; schedule category from the join.
3. `classifyBatchType` → proposed `(type, source)`. Skip rows with `batch_type_source = 'manual'`.
4. Print every row `batch_id type rule product_sku` plus a type×rule count table and the "needs a type" count. Exit without writing.
5. `--apply`: per batch inside `withTransaction`, `pgUpdate.updateBatch(client, {batch_id, updates:{batch_type}}, {trusted:true, actor:'backfill', now})` where `trusted` lets `batch_type_source` be stamped by the server. Re-assert `batch_type_source IS DISTINCT FROM 'manual'` under the row lock. Row-count check against the dry-run count (RUNBOOK §16 pattern). No mirror replay needed (PG-only).

**B2 `completed-at-backfill.js`**: candidates = `status='complete' AND completed_at IS NULL`. Proposed value = `max(batch_tasks.completed_at)` where `completed = true`; none → leave blank (D-14, no `last_updated` fallback). Print `batch_id proposed_iso source` plus counts (candidates, will fill, stay blank). Also print how many proposed dates fall before `start_date` (those yield negative spans and would be excluded; the owner should see them). `--apply` writes `completed_at` through `updateBatch` (nested `updates`, `completed_at` is already in `FIELD_KINDS`) and stamps `completed_at_source='backfill-task'` via the trusted channel. **Then run `batches-replay-to-sheet.js --since=<apply start> --apply`** because `completed_at` is a mirrored sheet column. Log in `87-CUTOVER-LOG.md` "SQL fixes" per RUNBOOK §16.
- Caveat to tell the owner (F8): task `completed_at` is often ticked after the fact, so backfilled dates can be later than the real finish and inflate cycle time. The source marker allows excluding them later; consider showing "(estimated)" in the batch timeline (`buildLifecycleTimeline`, js/brewpad.js:661) as a follow-up, not in scope.

Both scripts take `BACKFILL_DATABASE_URL` from the environment only and are run in the prod container via `railway ssh`. Required gate: owner reviews the full dry-run output in-session and says OK before `--apply`.

## Runtime State Inventory

Not a rename phase, but two data writes touch live state:

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | `batches` rows (206 on prod at handoff): all need `batch_type`; 40 completed rows lack `completed_at` | Data migration via the two gated scripts; new rows classified by code |
| Live service config | None. Apps Script is untouched by the PG-only design | None (this is the reason to avoid sheet columns) |
| OS-registered state | None | None |
| Secrets/env vars | None new. Backfills use existing `BACKFILL_DATABASE_URL`, and the Zoho creds already in the container | None |
| Build artifacts | `js/brewpad.min.js`, `brewpad.html` cache-bust stamp regenerate on `npm run build` | Run `npm run build` after editing `js/brewpad.js` |
| Sheet mirror | `completed_at` backfill must be replayed to the sheet; type columns are not mirrored | `batches-replay-to-sheet.js` after B2 apply |

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node 24 | all tests, tz correctness | ✗ in this shell (v20.20.2); `.nvmrc` says 24 | 20.20.2 | `nvm use` before testing; prod is Node 24 |
| Docker daemon | `npm run test:db` real-PG tests | ✓ | 28.0.2 | tests skip locally without Docker; CI fails closed |
| Railway CLI | in-container backfill runs | ✓ | 5.62.1 | — |
| psql | ad-hoc checks | ✗ | — | `railway ssh` + node scripts; not required |
| zoho-middleware/node_modules | middleware tests | ✓ | — | — |
| Prod Postgres 18 vs test image postgres:16 | real-PG tests | known mismatch (memory: railway-postgres-is-v18) | — | new SQL here is plain; avoid PG17/18-only syntax |

**Missing with no fallback:** none. Gate: Phase 87 prod cutover (D-01) and migration 0006 prod promotion (Pitfall 10).

## Validation Architecture

> `workflow.nyquist_validation` is `false` in `.planning/config.json`, but the orchestrator explicitly requested this section, so it is included.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Jest 29 (frontend uses jsdom; middleware node env; real-PG via Testcontainers) |
| Config file | `/jest.config.js` (frontend), `zoho-middleware/jest.config.js`, `zoho-middleware/jest.db.config.js` |
| Quick run command | `npx jest --config jest.config.js tests/frontend/brewpad-dashboard-data.test.js` and `cd zoho-middleware && npx jest __tests__/batch-rules-batch-type.test.js` |
| Full suite command | `npm test && cd zoho-middleware && npm test` (+ `npm run test:db` with Docker) ; `npm run lint` |

### Phase Requirements → Test Map
| Req | Behavior | Test Type | Automated Command | File Exists? |
|-----|----------|-----------|-------------------|-------------|
| B1 | cycle days = completed_day − start_date; median/mean/excluded; negative span excluded; per-type hidden when empty; within ±1 of independent recompute on a fixture | unit (pure) | `npx jest tests/frontend/brewpad-dashboard-data.test.js` | ❌ Wave 0 |
| B1 | regression: tile no longer grows with the clock (same input, two `now` values, same output) | unit | same | ❌ Wave 0 (write FIRST, per CLAUDE.md rule 3) |
| D1 | type totals equal across tiles/month buckets/breakdown for every window and type filter (property over fixture) | unit | same | ❌ Wave 0 |
| D1 | `dashboardWindow` ytd/30d/… bounds; future `start_date` excluded; Jan 1 and Dec 31 edges; Vancouver `asOf` | unit | same | ❌ Wave 0 |
| B3 | `classifyBatchType` precedence 1→5, manual never overwritten, unknown → `other` | unit | `cd zoho-middleware && npx jest __tests__/batch-rules-batch-type.test.js` | ❌ Wave 0 |
| B3 | create sets type + source for kiosk, kiosk_recipe, online, zoho_scan, manual; unknown never blocks; client `batch_type` ignored on automated sources | real-PG | `cd zoho-middleware && npx jest --config jest.db.config.js __tests__/db/batch-pg-create-type.test.js` | ❌ Wave 0 |
| B3 | `update_batch {updates:{batch_type}}` validates enum, stamps `manual`, rejects bad value, re-derive hooks skip manual | real-PG | `... __tests__/db/batch-pg-update-type.test.js` | ❌ Wave 0 |
| B3 | migration 0007 applies/rolls back; allowlist passes | real-PG + unit | `... __tests__/db/batches-type-migration.test.js`; `npm run migrate:guard` | ❌ Wave 0 |
| B3/B2 | backfill planners: dry-run lists every row, no writes; `--apply` row-count gate; skips manual; ids-only output; refuses URL on argv | unit + real-PG | `... __tests__/backfill/batch-type-backfill-plan.test.js`, `__tests__/db/batch-type-backfill.test.js` | ❌ Wave 0 |
| B2 | proposes latest task `completed_at`, blank when none, never uses `last_updated`, marks `backfill-task` | unit + real-PG | `... __tests__/backfill/completed-at-backfill-plan.test.js` | ❌ Wave 0 |
| S1 | `get_dashboard_stats` lean shape, no PII/snapshots, dates as strings, Vancouver `asOf` | real-PG | `... __tests__/db/batch-pg-dashboard-stats.test.js` | ❌ Wave 0 |
| S1 | memo: second call within 60 s is a hit; any write via `finish()` clears it; clock injectable | unit | `... __tests__/batch-store-dash-stats.test.js` | ❌ Wave 0 |
| S1 | route: allowlisted on `/api/batch/admin-proxy` only; session/legacy tier; device rejected; sheets mode forwards | route | `... __tests__/batch-dash-stats-route.test.js` | ❌ Wave 0 |
| Guard | existing pinned tests stay green: `batch-proxy-routes`, `admin-proxy`, `batch-rules` golden, `batches-spec-headers`, `batch-single-issuer`, `batch-create-latency` | regression | `cd zoho-middleware && npm test` | ✅ existing, must not be edited |
| UI | detail-pane type control posts `update_batch` with `batch_id` + nested `updates`, then `afterBatchWrite`; "needs a type" list renders only unclassified/`other` non-manual | frontend | `npx jest tests/frontend/brewpad-batch-type-ui.test.js` | ❌ Wave 0 (use `_setStateForTest`/`getStateForTest`; add `_dashData` to both seams) |

### Sampling Rate
- **Per task commit:** the quick command for the touched area, plus `npm run lint`.
- **Per wave merge:** `npm test` and `cd zoho-middleware && npm test`; `npm run test:db` for waves touching SQL.
- **Phase gate:** both full suites green, `npm run lint` clean, `npm run build` run, then staging verification: the live tile equals an independent recompute from `get_batches` within ±1 day (D-13), and all type totals agree.

### Wave 0 Gaps
- [ ] The test files listed above (all new files; no existing test is edited).
- [ ] A shared lean-row fixture builder for the pure dashboard tests (include: completed with/without `completed_day`, negative span, pending, disabled, future start, a staff/`research` batch, a Dec 31 / Jan 1 pair).
- [ ] Extend the brewpad test seams (`getStateForTest` / `_setStateForTest`) with the new dashboard state (additive; existing tests unaffected).
- Run under Node 24.

## Security Domain

`security_enforcement` is enabled (ASVS level 1).

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes (inherited) | `authTiers.requireTiers(['legacy','session'])` on the proxy; device tier rejected; identity only from the session |
| V3 Session Management | inherited | existing `sv_session` handling; no change |
| V4 Access Control | yes | new action reachable only through the BrewPad proxy allowlist; `batch_type_source`/`completed_at_source` writable only via server/`trusted` opt |
| V5 Input Validation | yes | enum check in `batch-rules`; `sanitizeInput`; parameterised SQL only (`$n`, constant SQL strings) |
| V6 Cryptography | no | none introduced |
| V8 Data Protection | yes | aggregate omits `customer_*`, `access_token`, `notes`, snapshots; backfills print ids/counts only |

### Known Threat Patterns
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Client forges `batch_type_source` or `completed_at_source` | Tampering | not in `FIELD_KINDS`; server stamps; `trusted` never set by `batch-proxy` |
| Automated-source create smuggles a type | Tampering | ignore client `batch_type` unless source is `manual`/`internal` (already coerced by `hardenProxyPayload`) |
| SQL injection via filters | Tampering | no filters in the SQL; constant strings, `$n` placeholders |
| PII leak through the aggregate or memo | Information disclosure | whitelist lean columns; memo holds the same lean payload; test asserts absence of `customer_*`/`access_token` |
| Backfill run against prod without review | Tampering | dry-run default, `--apply` gate, owner OK in-session, DB URL via env only, row-count assertion |
| Stale memo shows wrong numbers after a write | (integrity) | invalidate in `finish()`, 60 s ceiling |
| Memo exposed across auth tiers | Info disclosure | memo sits behind the same tier check; contains no PII |

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | F4's 120 vs 122 gap is the calendar-6-month vs rolling-180-day window difference, and 204 = 206 minus 2 pending batches | Root causes | Low; the structural fix (one window helper) holds either way, but acceptance numbers should be re-checked on staging |
| A2 | `recipe_snapshot` JSON includes `beer_category` and `style` as serialised by `pos-recipe.js` | Pitfall 6 | Rule 1 would never fire for recipe batches; verify the snapshot builder at plan time |
| A3 | A short exact-token `style` map (cider/seltzer/wine words) is acceptable despite Phase 89's "no style inference" ruling | Pitfall 6 | Owner may want recipe batches to rely on `beer_category` + manual only |
| A4 | In-process memo is sufficient (single Railway instance, or 60 s staleness across instances is tolerable) | Pattern 4 | Multi-instance would show up to 60 s stale data between instances |
| A5 | Cycle-time default window is YTD, same as the sibling tiles | Open Q 3 | If the owner wants all-time, numbers are identical today (all 2026) but differ in Jan 2027 |
| A6 | The Zoho all-items list endpoint returns `cf_type` for items that are no longer in the kiosk catalog | Backfill design | Some historical SKUs could stay unclassified and land on the "needs a type" list |
| A7 | Migration 0006 is not yet on production | Pitfall 10 | If already applied, 0007 simply follows it |
| A8 | `kiosk-products` Redis entries exist for kit SKUs sold at the kiosk and online | Pitfall 5 | Create-time rule 2 would miss and the name fallback / needs-type list absorbs it |

## Open Questions

1. **Recipe `style` vs Phase 89 "no style inference".**
   - Known: D-05 rule 1 says recipe style; 89-CONTEXT says the owner rejected keyword inference from `style`; Claude's discretion says use `beer_category` where present.
   - Unclear: whether a small style map for cider/seltzer/wine recipes is wanted.
   - Recommendation: `beer_category` → beer; otherwise exact tokens only; else fall through. Confirm in plan review.
2. **Stamp `completed_at` when a status change to `complete` arrives via `update_batch`?** The badge path never sets it, so the gap keeps growing after B2. A small fix in `updateBatch` (stamp `now` when status becomes `complete` and `completed_at` is empty and none supplied; source marker e.g. `status`) closes it, but it changes a Phase 87 parity-ported module. Recommendation: include it as a separate, small task with its own regression test, owner to confirm.
3. **Cycle-time window**: all-time (handoff baseline, 125 batches) or YTD? Recommend YTD default via the shared helper; identical today.
4. **Existing-test edits**: if the owner wants `batch_type` inside `get_batch`/`get_batches`, golden tests must be edited (needs explicit approval, name each in the plan). Default plan avoids this; the detail pane reads the type from the aggregate rows.
5. **Subcategory source for the aggregate**: server join from the kiosk cache (recommended) vs keep the stale July snapshot join on the client. Decide at plan time; the wine breakdown test (`brewpad-wine-breakdown.test.js`) must stay green either way.
6. **Rollout order**: migration → code deploy → B3 dry-run + owner OK + apply → B2 dry-run + owner OK + apply + replay → frontend flip. Because the corrected numbers are live (D-03) and rows are NULL until the B3 apply, the client must treat NULL `batch_type` with the old `resolveBatchType` fallback so nothing regresses between deploy and backfill. Confirm this sequencing against the Phase 87 cutover runsheet.

## Sources

### Primary (HIGH confidence, repo read this session)
- `js/brewpad.js` 290-420, 434-510, 3866-4330, 6610-6880, 11820-11938 (dashboard, classifier, seams)
- `zoho-middleware/lib/batch-pg-read.js`, `batch-store.js`, `batch-proxy.js`, `batch-pg-create.js`, `batch-pg-update.js`, `batch-pg-tasks.js`, `batch-rules.js` (1-330, 700-931), `batch-compare.js`, `batch-drift.js`, `ops-mirror.js`, `brewpad-integration.js`
- `zoho-middleware/routes/pos.js` 4225-4470 (proxy allowlists), `routes/catalog.js` 520-545, 820-880
- `zoho-middleware/migrations/0005_batches.sql`, `0006_recipes_beer_category.sql`, `scripts/migration-allowlist.js`
- `apps-script/adminApi.gs` 5040-5260 (`mirrorBatchState`, `_mirrorKeyToHeaders`, `exportBatchTabs`)
- `zoho-middleware/scripts/backfill/batches-replay-to-sheet.js`, `batches-verify.js`, `specs/batches.js`, `README.md`; `docs/RUNBOOK.md` §16
- Pinned tests: `__tests__/batch-proxy-routes.test.js`, `admin-proxy.test.js`, `batch-single-issuer.test.js`, `__tests__/db/batch-pg-read.test.js`, `__tests__/batch-rules.test.js`
- `.planning/phases/89-*/89-CONTEXT.md`, `89-RESEARCH.md` (header trap, style-inference ruling)
- `.planning/research/brewpad-dashboard-v2.md`, `94-CONTEXT.md`, `ROADMAP.md`, `STATE.md`, memory index (Phase 84 in-container gotcha, Node tzdata, admin-proxy cache note)
- `content/zoho-snapshot.json` (250 products; `type` values Wine 238 / Cider 11 / Beer 1; generated 2026-07-08)

### Secondary / Tertiary
- None. No web sources were needed; this phase is entirely internal code.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH, nothing new is introduced.
- Architecture: HIGH, create choke point, mirror drop behaviour and pinned-test constraints were read directly.
- Pitfalls: HIGH for code-derived ones (1, 2, 4, 5, 7, 9, 10); MEDIUM for 6 (snapshot contents unverified) and the F4 arithmetic.
- Live-data figures (63/64/125, 206 batches, 40 missing): taken from the owner's handoff, not re-verified.

**Research date:** 2026-10-23
**Valid until:** until the Phase 87 prod cutover lands (re-check `batch-store.js`, `batch-proxy.js`, and the 0006/0007 migration state then); otherwise ~30 days.
