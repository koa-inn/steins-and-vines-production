# Phase 83: Postgres Infrastructure - Research

**Researched:** 2026-09-30
**Domain:** Railway Postgres provisioning, `pg`/`node-pg-migrate`/Testcontainers plumbing, per-store flag helper, backfill pipeline scaffolding (Node 20 CommonJS Express middleware, no ORM)
**Confidence:** HIGH for stack/version facts (verified via `npm view` against the live registry + official/community docs); MEDIUM for exact Railway pre-deploy failure semantics and SSL behaviour (Railway's own docs are thin — corroborated by community reports, not an official API reference); LOW/ASSUMED flagged individually below.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Phase boundary:** Stand up the Postgres plumbing every later v4.9 phase reuses, proven on an
**empty schema** — no real data is loaded into real tables in this phase (DB-02, ROADMAP Phase 83):
- Railway Postgres in the `sv-middleware` project for **staging and production**, distinct `DATABASE_URL`s
- `pg` + `node-pg-migrate` as production dependencies (`railway.toml` builds with `npm install --production`)
- `zoho-middleware/lib/db.js` — one `Pool`, `query()`, `withTransaction(fn)`
- `migrations/0001_init.sql`, applied on deploy
- `DATABASE_URL` in `validateEnv.js`; `/health` reports the database alongside redis
- Jest harness on a real Postgres (Testcontainers), run on CI
- The generic per-store flag helper (`<STORE>_STORE` = `sheets` | `dual` | `postgres`, default `sheets`, production Sheet mirror hard-off on staging)
- The reusable backfill pipeline (`.xlsx` snapshot → per-sheet export → normalise → rejects file → scratch schema → row-count/min/max checks → promote), run end-to-end into a scratch schema only

Moving any actual store (gift cards etc.) is Phases 84–88.

**Carried forward (already decided — do not re-open):**
- **Stack:** raw `pg` (no ORM/query builder), `node-pg-migrate`, `@testcontainers/postgresql`; reject `pg-mem` — research §5.2–5.4.
- **Hosting:** Railway Postgres in both environments (not Neon/Supabase) — research §5.1.
- **Mirror/staging (owner, 2026-09-23):** production keeps a fire-and-forget Google Sheet mirror for every migrated table indefinitely; staging writes only to its own Postgres and **never** mirrors to the shared workbook; Schedule + Homepage never go to Postgres (Phase 88 → repo content).
- All six stages committed up front (research §9 trigger gating dropped).

**Database-down behaviour:**
- **D-01:** `DATABASE_URL` is **required in production only** — add it to `validateEnv.js`'s `REQUIRED_IN_PROD` list (staging's Railway env counts as prod there, and gets its own database). Local dev and CI may run without it. Consequence: both Railway databases must exist and be linked **before** this phase's middleware deploys.
- **D-02:** A database **outage at runtime** is reported, not fatal: `/health` gains a `database` field (true/false) but `status` stays `ok` — no Railway restart, kiosk keeps selling (same treatment as Zoho `authenticated:false` today). Revisit when the first store reads from Postgres (Phase 84).
- **D-03:** Migrations run as a **Railway pre-deploy step**, not at app boot: a failing migration aborts the deploy and Railway keeps the current version running. Researcher confirms the exact Railway mechanism (`preDeployCommand` in `railway.toml` or equivalent) and that it works with the `npm install --production` build.
- **D-04:** Deploy-time migrations are **additive only**. Anything that drops, renames or rewrites data is a separate, manually triggered step with a backup first. Planner should make this enforceable (convention + review check at minimum).

**Store switch:**
- **D-05:** Each store's switch is a **Railway env var** (`<STORE>_STORE`, e.g. `GIFT_CARDS_STORE`). Flipping = edit the variable → Railway restarts (~1 min). No runtime/admin toggle.
- **D-06:** An **invalid value** (anything but `sheets` | `dual` | `postgres`) **refuses to start** with a clear message — never silently falls back. Unset = `sheets`.
- **D-07:** "No production-Sheet mirror on staging" is **hard-coded and not overridable** — the mirror helper no-ops unless running in production. NOTE: staging and production both run as `NODE_ENV=production`, so the production check must use a reliable environment signal (e.g. Railway's `RAILWAY_ENVIRONMENT_NAME`) — researcher to verify what Railway sets and that it cannot be mistaken.
- **D-08:** Build a **generic dual-write comparison helper now** (compare Sheets vs Postgres result, report discrepancies to Sentry), so Phase 84+ stores just call it. Reuse the existing Sentry capture wrapper pattern (`lib/sentry-capture.js` — never throws into the caller).

**Backfill pipeline & staging data:**
- **D-09:** Source is an **`.xlsx` the owner downloads** from the workbook (File → Download) — a frozen, repeatable snapshot. No Sheets-API credentials for the pipeline.
- **D-10:** The pipeline runs **on the owner's Mac** as an npm script against a chosen `DATABASE_URL` (staging or production, copied from Railway), showing each step and the rejects report. Researcher checks how Railway exposes the DB for external connections (public proxy URL vs private) and what that implies (TLS, credentials handling on the laptop).
- **D-11:** Staging's Postgres gets a **full real copy** of production data (fidelity over scrubbing; staging is behind Cloudflare Access and already reads the live workbook today).
- **D-12:** Unconvertible rows go to a **rejects file with reasons, and promotion is blocked** until rejects are zero or the owner explicitly accepts them.
- **D-13 (follow-on):** Snapshot `.xlsx` files and rejects reports contain customer PII — they must live outside the repo or be git-ignored; never committed.

**Local testing & setup:**
- **D-14:** Tests use **Testcontainers/Docker**. When Docker isn't running locally, the DB test files **skip with a clear message** and the rest of the suite runs; **CI always runs them** (no silent skip on CI — CI must fail if Docker is unavailable).
- **D-15:** The **owner provisions** both Railway Postgres databases in the dashboard (paid add-on) from a checklist step in the plan, and links `DATABASE_URL` into each environment's middleware service. Claude cannot log in to Railway from here.
- **D-16:** **Confirm Railway backups / PITR are enabled** on both databases in this phase (dashboard check, recorded) — 82-01 left the plan gating unverified and Phase 84 puts real balances in. The full **restore drill stays in Phase 88**.
- **D-17:** **Ship Phase 83 to production as soon as it's done** (empty DB, health field, migrations live early) — not held for Phase 84. Follow CLAUDE.md: staging first, then the gated deploy.

### Claude's Discretion
Exact file/module layout (`lib/db.js`, store-flag helper, comparison helper, backfill scripts), naming of the scratch schema and migration files, per-sheet normalisation order details (follow research conversion traps), and how the pipeline's CLI is shaped.

### Deferred Ideas (OUT OF SCOPE)
- Making `/health` fail (and gating deploys) on database outage — revisit in Phase 84 once gift cards read from Postgres (D-02).
- Restore drill for Railway backups — Phase 88 (DB-07).
- `admin-write-attribution-kiosk-middleware.md`, `brewpad-writes-retry-once.md`, `ga4-staging-pollutes-prod-property.md`, `gated-deploy-branch-unsafe.md`, `giftcard-ledger-empty-tab-crash.md` — reviewed, unrelated to Postgres infrastructure.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| DB-02 | Postgres provisioned in staging AND production with `lib/db.js` (pool/query/transaction), `node-pg-migrate` on deploy, `DATABASE_URL` validated, a Testcontainers Jest harness on CI, a per-store `sheets\|dual\|postgres` flag helper with the mirror hard-off on staging, and a reusable backfill pipeline (snapshot → normalise → rejects → scratch → promote). | §Standard Stack (verified versions + engine compatibility), §Architecture Patterns (db.js, store-flag helper, dual-write comparator, backfill pipeline), §Common Pitfalls (Railway pre-deploy semantics, SSL for public proxy, ESM-only CLI, Testcontainers/Node-20 engine conflict), §Code Examples, §Security Domain |
</phase_requirements>

## Summary

This phase is pure plumbing: two Railway Postgres instances, a thin `pg` wrapper, migrations-as-a-deploy-step, a Testcontainers-backed Jest harness, a store-flag helper, and a backfill CLI — proven against an empty/scratch schema only. Everything in `.planning/research/sheets-to-postgres-migration.md` §5.1–5.4 and the carried-forward decisions already fixed the *what* (raw `pg`, not an ORM; `node-pg-migrate`, not Umzug/Postgrator; Testcontainers, not `pg-mem`; Railway Postgres, not Neon/Supabase). This research fills in the *how*, verified against the live npm registry and Railway's own docs/community reports, and surfaces four facts the plan must account for or it will ship broken:

1. **`node-pg-migrate@9.0.0` (current) is ESM-only.** It must only ever be invoked as a CLI binary (via an npm script / Railway `preDeployCommand`), never `require()`'d into `server.js` or `lib/db.js` — which is exactly what D-03 already specifies (migrations run as a separate pre-deploy step, not at app boot), so this is a constraint to document loudly, not a blocker.
2. **The latest `testcontainers`/`@testcontainers/postgresql` (12.1.0+, including the `npm view` "latest" tag 12.2.0) require Node `>= 22.22`.** This repo pins Node `20.x` (`zoho-middleware/package.json` engines, `.nvmrc`). `npm install` of the latest tag on this machine produces `EBADENGINE` warnings (warnings, not failures — npm will still install and the package will likely *run*, but it's out of its supported range and a future minor could turn a warning into a hard `engine-strict` failure or a runtime incompatibility). **`@testcontainers/postgresql@12.0.4` and `testcontainers@12.0.4` (and earlier 12.0.x/11.x) carry no `engines` constraint** — pin to `12.0.4` exactly.
3. **Railway's public Postgres TCP proxy presents a self-signed certificate.** `pg`'s default TLS verification (and even `?sslmode=require` alone) will reject it. The backfill pipeline connecting from the owner's Mac via `DATABASE_PUBLIC_URL` needs `ssl: { rejectUnauthorized: false }` in the `pg` client config; the in-Railway `DATABASE_URL` (private network) needs no SSL config at all. `lib/db.js`'s SSL handling must branch on which URL it was given, or the backfill CLI needs its own connection helper.
4. **The existing `RAILWAY_ENVIRONMENT` var (already used in `validateEnv.js`'s D-02 boot assertion) only proves "this is Railway," not "this is production."** Railway's documented variable for distinguishing environments by name is `RAILWAY_ENVIRONMENT_NAME` (also `RAILWAY_ENVIRONMENT_ID` for a stable machine ID). Since staging and production both run `NODE_ENV=production`, D-07's mirror-hard-off check must read `RAILWAY_ENVIRONMENT_NAME` and compare against the literal string the owner's Railway environments are actually named (confirm on the dashboard at provisioning time — `docs/RUNBOOK.md` already refers to services named `svmiddleware-production` / `svmiddleware-staging`, strongly suggesting environments named `production` / `staging`, but this must be confirmed, not assumed, since the service name and environment name are different Railway concepts).

**Primary recommendation:** `pg@^8.23`, `node-pg-migrate@^9.0.0` (CLI-only, production deps); `@testcontainers/postgresql@12.0.4` + `testcontainers@12.0.4` pinned exactly (dev deps, Node-20-safe); `exceljs` for the backfill's `.xlsx` reader (the npm-registry `xlsx`/SheetJS package is abandoned with two unpatched high-severity CVEs — do not use it, even as a scratch-only devDependency). Migrations run via Railway `preDeployCommand` in `railway.toml`, CLI-invoked so the ESM-only package is never `require()`'d. `lib/db.js` branches SSL config by which connection string it receives. `RAILWAY_ENVIRONMENT_NAME` (confirmed against the actual Railway dashboard values) drives the mirror-hard-off check, not `RAILWAY_ENVIRONMENT`.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Postgres connection pooling (`Pool`/`query`/`withTransaction`) | API / Backend (`zoho-middleware`) | Database / Storage | Middleware is the only process that ever holds `DATABASE_URL`; no browser or Apps Script code touches Postgres directly |
| Schema migrations | API / Backend deploy pipeline (Railway `preDeployCommand`) | Database / Storage | Runs once per deploy, in the build/deploy pipeline, never inside the running app process (D-03) |
| `DATABASE_URL` validation / boot gate | API / Backend (`validateEnv.js`) | — | Existing `REQUIRED`/`REQUIRED_IN_PROD` pattern already owns this responsibility |
| `/health` database reporting | API / Backend (`server.js`) | — | Mirrors the existing Redis health-check pattern exactly |
| Per-store flag resolution (`sheets\|dual\|postgres`) | API / Backend (`lib/`) | — | Railway env-var driven (D-05); no runtime/admin UI toggle this phase |
| Dual-write comparison + Sentry reporting | API / Backend (`lib/`) | Observability (Sentry) | Reuses `lib/sentry-capture.js`'s never-throw wrapper pattern |
| Backfill pipeline (xlsx → normalise → scratch schema) | CLI script (local, owner's Mac) | Database / Storage (scratch schema only) | D-10: runs on the owner's machine against a Railway `DATABASE_PUBLIC_URL`, not inside the Railway app process |
| Jest DB harness (Testcontainers) | CI / Backend test tier | — | Docker-in-CI, isolated Jest config, never part of the default `npm test` local run |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `pg` | `^8.23.1` (verified `npm view pg version` → `8.23.1`, engines `>=16.0.0`) | Postgres client, connection pooling | Locked decision (research §5.2); the ecosystem default for a CommonJS/no-ORM Node codebase; test ergonomics (no mock/DSL layer) matches this repo's regression-test-first workflow |
| `node-pg-migrate` | `^9.0.0` (verified `npm view node-pg-migrate version` → `9.0.0`, engines `>=20.11.0`) | SQL-first schema migrations, applied as a deploy step | Locked decision (research §5.3); Postgres-only, plain-SQL migration files, CLI-driven — no TypeScript/build step needed |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `testcontainers` | `12.0.4` **exact pin** (NOT the `latest`/`^` tag — 12.1.0+ requires Node `>=22.22`, confirmed via `npm view testcontainers@12.1.0 engines`; this repo pins Node `20.x`) | Docker container lifecycle management for the Jest harness | dev dependency, used only by the isolated DB-test Jest config |
| `@testcontainers/postgresql` | `12.0.4` **exact pin** (same Node-20 constraint; peers with `testcontainers@12.0.4`) | Postgres-specific Testcontainers module (`PostgreSqlContainer`) | dev dependency, DB-test Jest config only |
| `exceljs` | `^4.4.0` (verified `npm view exceljs version` → `4.4.0`, engines `>=8.3.0`) | Reads the owner's downloaded `.xlsx` snapshot for the backfill pipeline | Backfill CLI only — not a runtime/production dependency; see Pitfall "xlsx/SheetJS is abandoned" below |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `pg` | Kysely / Drizzle / Prisma | Rejected in prior research — this codebase has zero TypeScript and no build step; an ORM's entire value proposition (compile-time type inference) evaluates to zero, and the test-ergonomics cost is real (research §5.2) |
| `node-pg-migrate` | Umzug, Postgrator | Rejected in prior research — Umzug is a generic runner needing its own DB-layer glue; Postgrator is too small a project to bet a money-adjacent migration path on (research §5.3) |
| Testcontainers | `pg-mem` | Explicitly rejected (locked decision) — an in-memory reimplementation cannot faithfully reproduce transactional semantics under concurrency, which is the exact thing GiftCards-era Postgres work needs to prove |
| `exceljs` (xlsx read) | `xlsx` (SheetJS) via npm | The npm-registry `xlsx@0.18.5` is abandoned (SheetJS stopped publishing to npm in 2023, moved to their own CDN) and carries 2 unpatched high-severity CVEs (ReDoS, prototype pollution) with no fix available. `exceljs` is actively maintained (~1.9M weekly downloads) and covers the same read use case. |

**Installation:**
```bash
cd zoho-middleware
npm install pg@^8.23.1 node-pg-migrate@^9.0.0
npm install --save-dev testcontainers@12.0.4 @testcontainers/postgresql@12.0.4 exceljs@^4.4.0
```
Note: `exceljs` is only needed by the backfill CLI, which never runs inside the deployed app — installing it as a `devDependency` (not a production dependency) is correct and keeps Railway's `npm install --production` build lean. The owner runs the backfill script locally with `npm install` (full, not `--production`) or `npx --no-install exceljs`-style local tooling; confirm this placement decision with the planner since it affects whether the backfill script can run via a bare `npm run backfill` on a machine that only ever ran `npm install --production`.

**Version verification:** All four version numbers above were confirmed live against the npm registry on 2026-09-30 via `npm view <pkg> version` and `npm view <pkg> engines` (not training-data recall). The `testcontainers`/`@testcontainers/postgresql` Node-22 engine bump was independently reproduced: `npm install testcontainers@latest` in `zoho-middleware/` on this machine (Node v20.17.0) emitted `npm warn EBADENGINE` for `testcontainers@12.2.0`, `yargs@18.0.0`, `undici@8.11.2`, `yargs-parser@22.0.0` — all transitive deps of the current major. This test-install was reverted (`git checkout -- package.json package-lock.json`) after confirming the finding; no dependency changes were left in the tree.

## Package Legitimacy Audit

Ran via `slopcheck install pg node-pg-migrate @testcontainers/postgresql testcontainers exceljs` (pip-installed `slopcheck`, available in this environment).

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|-----------|-------------|
| `pg` | npm | long-established (node-postgres core) | very high | github.com/brianc/node-postgres | [OK] | Approved |
| `node-pg-migrate` | npm | long-established | ~460k/wk (per prior research §5.3) | github.com/salsita/node-pg-migrate | [OK] (flagged: "name starts with 'node-' — classic LLM naming pattern... but package is established" — benign heuristic note, not a real risk signal) | Approved |
| `@testcontainers/postgresql` | npm | established (official Testcontainers org) | high | github.com/testcontainers/testcontainers-node | [OK] | Approved — **pin to `12.0.4`, not `latest`, for Node 20 compatibility (see Summary)** |
| `testcontainers` | npm | established | high | github.com/testcontainers/testcontainers-node | [OK] | Approved — **pin to `12.0.4`** |
| `exceljs` | npm | established | ~1.9M/wk | github.com/exceljs/exceljs | [OK] | Approved |

**Packages removed due to slopcheck [SLOP] verdict:** none.
**Packages flagged as suspicious [SUS]:** none.

**Package provenance note (per the claim-provenance rule):** `pg`, `node-pg-migrate`, and `@testcontainers/postgresql`/`testcontainers` are carried-forward decisions from `.planning/research/sheets-to-postgres-migration.md` (an existing, already-reviewed milestone research document) — their exact current versions and engine constraints were independently re-verified this session via `npm view` against the live registry, so version facts are `[VERIFIED: npm registry]`. `exceljs` is a **new** recommendation surfaced this session via WebSearch (not Context7/official docs) as the replacement for the abandoned `xlsx` package; per the package-name provenance rule it is tagged `[ASSUMED]` despite passing slopcheck and registry verification, and belongs in the Assumptions Log below for planner/owner confirmation before the backfill CLI ships.

## Architecture Patterns

### System Architecture Diagram

```
                         ┌─────────────────────────────┐
                         │   Railway "sv-middleware"    │
                         │        project               │
                         │                               │
   staging repo push ──▶ │  ┌─────────────────────────┐  │
   (origin/main)         │  │ svmiddleware-staging     │  │
                         │  │ env: staging              │  │
                         │  │ NODE_ENV=production        │  │──▶ Railway Postgres (staging)
                         │  │ DATABASE_URL = staging DB  │  │    private network only
                         │  └───────────┬──────────────┘  │    (no public proxy needed
                         │              │ preDeployCommand │     for the app itself)
                         │              │ (node-pg-migrate │
                         │              │  up, from        │
                         │              │  railway.toml)    │
                         │              ▼                  │
                         │        migrations/0001_init.sql  │
                         │                               │
  gated-deploy.yml ────▶ │  ┌─────────────────────────┐  │
  (force-push to          │  │ svmiddleware-production  │  │
   prod repo, then         │  │ env: production           │  │──▶ Railway Postgres (production)
   Railway watchPatterns)  │  │ NODE_ENV=production        │  │    private network +
                         │  │ DATABASE_URL = prod DB     │  │    optional public TCP proxy
                         │  └───────────┬──────────────┘  │    (DATABASE_PUBLIC_URL, for
                         │              │ preDeployCommand │     the laptop backfill CLI)
                         │              ▼                  │
                         │        migrations/0001_init.sql  │
                         └─────────────────────────────┘
                                        ▲
                                        │ DATABASE_PUBLIC_URL
                                        │ (TCP proxy, self-signed cert,
                                        │  ssl:{rejectUnauthorized:false})
                         ┌──────────────┴───────────────┐
                         │  Owner's Mac                  │
                         │  `.xlsx` snapshot (File→Download)
                         │       │
                         │       ▼
                         │  backfill CLI (exceljs read)
                         │       │ normalise (Traps 1-4c)
                         │       ▼
                         │  rejects.json (reasons) ──▶ NEVER committed (D-13, PII)
                         │       │
                         │       ▼
                         │  scratch schema in the chosen
                         │  DATABASE_PUBLIC_URL's database
                         │  (row-count / min / max checks,
                         │   zero rows promoted to real
                         │   tables this phase)
                         └───────────────────────────────┘

Runtime request path (Phase 83 scope — empty schema, store-flag always 'sheets' default):

  Browser / Kiosk / BrewPad ──▶ Express routes (unchanged this phase)
                                      │
                                      ▼
                          store-flag helper: resolveStoreMode('<STORE>')
                                      │
                         'sheets' (default) ──▶ existing Apps Script path (unchanged)
                         'dual'/'postgres' ──▶ not exercised by any real store yet (Phase 84+)
                                      │
                          GET /health ──▶ { status:'ok', authenticated, redis, database, uptime }
                                      │        (database:false does NOT flip status — D-02)
                                      ▼
                          lib/db.js Pool.query('select 1') — liveness probe only
```

### Recommended Project Structure
```
zoho-middleware/
├── lib/
│   ├── db.js                    # Pool + query() + withTransaction(fn) — the only module that touches pg
│   ├── store-flag.js            # resolveStoreMode(storeEnvName) -> 'sheets'|'dual'|'postgres', boot-time validation
│   ├── dual-write-compare.js    # compareAndReport(sheetsResult, pgResult, context) -> never throws (D-08)
│   └── sentry-capture.js        # existing — reused by dual-write-compare.js
├── migrations/
│   └── 0001_init.sql            # node-pg-migrate SQL migration, additive only (D-04)
├── scripts/
│   └── backfill/
│       ├── backfill.js          # CLI entrypoint — npm run backfill -- --file=snapshot.xlsx --target=$DATABASE_URL
│       ├── read-xlsx.js         # exceljs-based sheet reader
│       ├── normalize.js         # Traps 1 (money) / 2 (timestamps) / 3 (IDs) / 4 ('' → NULL) / 4b (bool) / 4c (jsonb)
│       └── rejects.js           # rejects-file writer, gitignored output location
├── __tests__/
│   ├── ...existing 100+ files...
│   └── db/                      # excluded from the default `npm test` run (D-14)
│       ├── db.test.js           # Pool/query/withTransaction round-trip
│       └── migrations.test.js   # 0001_init.sql applies cleanly to a fresh container
├── jest.config.js                # existing — add testPathIgnorePatterns: ['<rootDir>/__tests__/db/']
├── jest.db.config.js             # new — testMatch: ['<rootDir>/__tests__/db/**/*.test.js']
└── package.json                  # add "test:db": "jest --config jest.db.config.js"
```

### Pattern 1: `lib/db.js` — single Pool, `query()`, `withTransaction()`

**What:** One `pg.Pool` constructed once at module load, a thin `query(text, params)` wrapper, and a `withTransaction(fn)` helper that checks out a client, runs `BEGIN`/`COMMIT`/`ROLLBACK`, and always releases the client.
**When to use:** Every Postgres access in the middleware goes through this module — no route or lib file should `new Pool()` or `require('pg')` directly.
**SSL branching is the one non-obvious part** — see Pitfall "Railway's public TCP proxy needs `rejectUnauthorized:false`" below; the in-app `DATABASE_URL` (private network) and the backfill CLI's `DATABASE_PUBLIC_URL` need different SSL configs, so this cannot be a single hardcoded `ssl: false`.

```js
// Source: pg docs (node-postgres.com/features/connecting, node-postgres.com/features/transactions)
// + Railway community reports on the public TCP proxy's self-signed cert (see Sources)
'use strict';
var { Pool } = require('pg');
var log = require('./logger');

var connectionString = process.env.DATABASE_URL;

// Railway's PRIVATE DATABASE_URL (internal network, *.railway.internal) needs no TLS.
// Railway's PUBLIC DATABASE_PUBLIC_URL (external TCP proxy) presents a self-signed
// cert — verify-full fails; use encrypted-but-unverified, matching libpq sslmode=require
// semantics, NOT sslmode=disable (which would be plaintext over the public internet).
var isPublicProxy = connectionString && /\.proxy\.rlwy\.net/.test(connectionString);

var pool = connectionString
  ? new Pool({
      connectionString: connectionString,
      ssl: isPublicProxy ? { rejectUnauthorized: false } : false
    })
  : null;

function query(text, params) {
  if (!pool) return Promise.reject(new Error('DATABASE_URL not configured'));
  return pool.query(text, params);
}

function withTransaction(fn) {
  if (!pool) return Promise.reject(new Error('DATABASE_URL not configured'));
  return pool.connect().then(function (client) {
    return client.query('BEGIN')
      .then(function () { return fn(client); })
      .then(function (result) {
        return client.query('COMMIT').then(function () { return result; });
      })
      .catch(function (err) {
        return client.query('ROLLBACK').then(function () { throw err; }, function () { throw err; });
      })
      .finally(function () { client.release(); });
  });
}

function isConfigured() { return pool !== null; }

module.exports = { query: query, withTransaction: withTransaction, isConfigured: isConfigured, pool: pool };
```

### Pattern 2: Migrations as a Railway pre-deploy step (D-03)

**What:** `railway.toml`'s `[deploy]` section gains a `preDeployCommand`. Railway runs it in a **separate, ephemeral container** — after the build (so `npm install --production` has already run and `node-pg-migrate`'s CLI binary exists at `node_modules/.bin/node-pg-migrate`) but before the new version takes traffic. It has access to the service's private network and environment variables (so the environment's own `DATABASE_URL` resolves correctly). **If the command fails, the deployment does not proceed and Railway's zero-downtime rollout means the previous release keeps serving** — confirmed via Railway's docs ("the deployment will not proceed... it will not be retried") and corroborated by a community report describing exactly this behaviour (old release kept serving after a failed pre-deploy health check). This satisfies D-03 exactly as specified.
**When to use:** Once, in the committed `railway.toml` — since the same file is pushed to both the staging and production GitHub repos (per `gated-deploy.yml`'s force-push step), the same `preDeployCommand` runs in both environments, each against its own `DATABASE_URL`.

```toml
# Source: https://docs.railway.com/deployments/pre-deploy-command (WebFetch 2026-09-30)
[build]
buildCommand = "cd zoho-middleware && npm install --production"
watchPatterns = ["zoho-middleware/**"]

[deploy]
startCommand = "cd zoho-middleware && node server.js"
preDeployCommand = "cd zoho-middleware && npx --no-install node-pg-migrate up"
```

**Critical constraint:** `node-pg-migrate@9.0.0` is **ESM-only** (confirmed: salsita/node-pg-migrate GitHub discussion #1635 — v9 is a bridge release, ESM-only, with v10 planned to add `require(esm)` support). Node cannot `require()` an ESM-only package synchronously on Node 20 without the (unstable-on-20) `--experimental-require-module` flag. This is a non-issue **only because** the CLI binary is its own ESM entry point, resolved via its own `package.json` `"type":"module"` — running it via `npx`/the `node_modules/.bin/node-pg-migrate` shim is unaffected by the rest of the (CommonJS) project. **Do not** ever `require('node-pg-migrate')` inside `server.js` or `lib/db.js` to run migrations programmatically at boot — that would break on Node 20. D-03 already avoids this by design (migrations as a separate pre-deploy step, not at app boot); this note exists so the plan doesn't regress it.

### Pattern 3: Store-flag helper (D-05/D-06)

**What:** A small module that reads `process.env[storeEnvName]` (e.g. `GIFT_CARDS_STORE`), validates it against the three-value enum, and **refuses to start the process** on an invalid value (D-06) — following the exact `validateEnv.js` `REQUIRED_IN_PROD`-style fail-loud pattern already established in this codebase.

```js
// Source: pattern mirrors zoho-middleware/lib/validateEnv.js's existing fail-fast style
'use strict';
var log = require('./logger');
var VALID_MODES = ['sheets', 'dual', 'postgres'];

function resolveStoreMode(storeEnvName) {
  var raw = process.env[storeEnvName];
  if (!raw) return 'sheets'; // D-06: unset = sheets
  if (VALID_MODES.indexOf(raw) === -1) {
    log.error('[store-flag] Invalid ' + storeEnvName + '=' + raw +
      ' — must be one of: ' + VALID_MODES.join(', ') + '. Refusing to boot (D-06).');
    process.exit(1);
  }
  return raw;
}

module.exports = { resolveStoreMode: resolveStoreMode };
```

Call `resolveStoreMode('GIFT_CARDS_STORE')` etc. once per configured store at startup (alongside `validateEnv()` in `server.js`), not per-request — an invalid value must fail the boot, not the first request.

### Pattern 4: Production-only mirror gate (D-07)

**What:** The fire-and-forget Sheet-mirror helper (built in Phase 84+, but the gate belongs in this phase's shared lib) must distinguish "this is the production Railway environment" from "`NODE_ENV=production`," because staging also runs `NODE_ENV=production` (confirmed: `validateEnv.js`'s existing D-02 boot assertion already treats `RAILWAY_ENVIRONMENT` as merely "running on Railway," not "running in prod").

```js
// Source: Railway Variables Reference (docs.railway.com/variables/reference, WebFetch 2026-09-30)
// RAILWAY_ENVIRONMENT_NAME = "The environment name of the service instance."
'use strict';
function isProductionEnvironment() {
  // CONFIRM AT PROVISIONING TIME (D-15 checklist item): the exact string Railway's
  // dashboard shows for the production environment's name. docs/RUNBOOK.md's existing
  // service names (svmiddleware-production / svmiddleware-staging) strongly imply
  // environments literally named "production" / "staging", but environment name and
  // service name are DIFFERENT Railway concepts — verify on the dashboard, do not assume.
  return process.env.RAILWAY_ENVIRONMENT_NAME === 'production';
}
module.exports = { isProductionEnvironment: isProductionEnvironment };
```

**Do not** reuse the existing `RAILWAY_ENVIRONMENT` var for this check — it is already documented in this codebase (`validateEnv.js` D-02 comment) as merely proving "this process is running on Railway," and its value has never been asserted against a specific environment name anywhere in the repo (grep confirms zero comparisons against `'production'`/`'staging'` string literals for that var).

### Pattern 5: Jest DB harness isolation (D-14)

**What:** A second Jest config, not merged into the default one, so `npm test` (the command CLAUDE.md's pre-commit rule and every existing CI job run) never attempts to start a container. A new `npm run test:db` script (wired into `tests.yml`/`gated-deploy.yml` as an additional CI step) runs the isolated config. Inside the DB-test files, a `beforeAll` probes for Docker and calls `describe.skip`/logs a clear message when absent **locally**, but CI must not have this escape hatch — gate the skip on `!process.env.CI` (GitHub Actions sets `CI=true` by default) per D-14 ("CI always runs them... CI must fail if Docker is unavailable").

```js
// zoho-middleware/jest.db.config.js
// Source: pattern derived from existing jest.config.js structure
module.exports = {
  testEnvironment: 'node',
  testMatch: ['<rootDir>/__tests__/db/**/*.test.js'],
  setupFiles: ['<rootDir>/jest.setup.js'],
  collectCoverage: false, // DB tests exercise lib/db.js via the SAME coverage-collected
                           // paths as the main suite; do not double-count or the existing
                           // per-file floors in jest.config.js could be gamed
  testTimeout: 60000 // container startup + migration apply
};
```

```js
// zoho-middleware/__tests__/db/db.test.js (excerpt)
var { execSync } = require('child_process');
var dockerAvailable = (function () {
  try { execSync('docker info', { stdio: 'ignore' }); return true; }
  catch (e) { return false; }
})();

if (!dockerAvailable && !process.env.CI) {
  describe.skip('lib/db.js (Docker not running locally — skipped, see D-14)', function () {});
} else {
  // if !dockerAvailable && process.env.CI, let the container-start step below throw —
  // CI has no valid skip path (D-14: "CI must fail if Docker is unavailable")
  describe('lib/db.js', function () {
    var container, pool;
    beforeAll(async function () {
      var { PostgreSqlContainer } = require('@testcontainers/postgresql');
      container = await new PostgreSqlContainer('postgres:16-alpine').start();
      // apply migrations/0001_init.sql against container.getConnectionUri() here
      // (node-pg-migrate CLI invocation via execSync, or a raw pg client + fs.readFileSync)
    }, 60000);
    afterAll(async function () { if (container) await container.stop(); });
    // per-test isolation: BEGIN in beforeEach, ROLLBACK in afterEach on a single
    // checked-out client — avoids paying container-startup cost per test while still
    // giving every test a clean slate (research §5.2's Testcontainers recommendation)
  });
}
```

Add to `jest.config.js`: `testPathIgnorePatterns: [..., '<rootDir>/__tests__/db/']` so the two configs never double-run the same files.

### Pattern 6: Backfill pipeline shape (D-09..D-13)

**What:** A local CLI, run by the owner on their Mac, that never touches the Sheets API (the input is a manually-downloaded `.xlsx`) and never writes to a real table this phase (output is a scratch schema only).

```
npm run backfill -- --file=~/Downloads/snapshot.xlsx --sheet=PlatoReadings \
  --target="$STAGING_DATABASE_PUBLIC_URL" --schema=scratch_83

  1. read-xlsx.js   — exceljs reads the named sheet into row objects
  2. normalize.js   — per Trap (money→numeric, timestamps→normalized ISO+reject-unparseable,
                       IDs stay text, ''→NULL, 'TRUE'/'FALSE'→boolean, JSON.parse for jsonb cols)
                       — REJECT, do not coerce; unparseable rows go to rejects, not NULL
  3. rejects.js     — writes rejects.json (reasons per row) to a path OUTSIDE the repo or
                       .gitignore'd (D-13 — contains customer PII); pipeline exits non-zero
                       and blocks promotion (D-12) until the rejects count is zero or the
                       owner passes --accept-rejects
  4. load into `scratch_83.<table>` (schema-qualified, never the real table name)
  5. row-count / min / max / null-count checks vs. the source sheet's own values
     (checklist from .planning/notes/sheets-to-postgres-data-conversion.md §5)
```

See `.planning/notes/sheets-to-postgres-data-conversion.md` §2–3 for the exact DDL and conversion traps per sheet (GiftCards, PlatoReadings, VesselHistory, FermSchedules, ProductEvents are "trivially portable" — good targets for rehearsing this pipeline's mechanics in Phase 83, since nothing promotes to a real table yet).

### Anti-Patterns to Avoid
- **Requiring `node-pg-migrate` as a library:** it is ESM-only; only invoke it as a CLI subprocess (npm script / `preDeployCommand`).
- **Hardcoding `ssl: false` or `ssl: true` in `lib/db.js`:** the private `DATABASE_URL` and the public `DATABASE_PUBLIC_URL` need different SSL configs (see Pattern 1) — a single hardcoded value will break one of the two paths.
- **Checking `RAILWAY_ENVIRONMENT` (or its mere presence) to decide "is this production":** it only proves "running on Railway," not which environment — already documented as such in `validateEnv.js`'s own comments.
- **Letting the DB-test Jest config live inside the default `testMatch`:** would make every `npm test` (local, pre-commit) require Docker, violating D-14 and CLAUDE.md's "before every commit: run `npm test`" rule.
- **Installing `testcontainers`/`@testcontainers/postgresql` at `latest`/`^`:** silently jumps to a Node `>=22.22` requirement the project doesn't meet.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Schema migration tracking/ordering | A custom "has this .sql file run yet" table + runner | `node-pg-migrate` (already locked-in) | Handles ordering, the `pgmigrations` tracking table, transactional apply, and `up`/`down` semantics correctly; a hand-rolled version is exactly the kind of "green tests ≠ working system" risk this codebase has hit before (STATE.md) |
| Postgres connection pooling | Manual `pg.Client` lifecycle management | `pg.Pool` (Pattern 1) | `Pool` already handles connection reuse, queueing, and error recovery; reinventing it risks connection leaks under load |
| `.xlsx` parsing | A custom XML/zip reader for `.xlsx` internals | `exceljs` | `.xlsx` is a zipped XML format with real edge cases (shared strings, merged cells, date serials); this is squarely a "don't hand-roll" problem even before considering the abandoned `xlsx` package's CVEs |
| Docker container lifecycle for tests | Custom `docker run`/`docker stop` shell-outs in `beforeAll`/`afterAll` | `@testcontainers/postgresql` | Handles port mapping, readiness polling, and cleanup-on-crash (orphan container reaping) that a hand-rolled shell-out would get wrong on the first `SIGKILL`'d test run |

**Key insight:** every "don't hand-roll" item above is already a locked decision from prior research (§5.2–5.4) — this phase's actual net-new hand-roll risk is the **SSL branching logic** and the **store-flag boot-gate**, both small enough that a library would be overkill; Patterns 1 and 3 above are the right amount of custom code.

## Common Pitfalls

### Pitfall 1: `node-pg-migrate`'s ESM-only packaging breaks if `require()`'d
**What goes wrong:** Any future code that does `require('node-pg-migrate')` to run migrations programmatically (e.g., "let's just run migrations at boot for simplicity") throws `ERR_REQUIRE_ESM` on Node 20.
**Why it happens:** v9 (current) is ESM-only; Node 20 does not have stable synchronous `require()`-of-ESM support (that lands later, in the Node 22+ line).
**How to avoid:** Only invoke it as a CLI subprocess (`npx node-pg-migrate up`), which resolves as its own ESM entry point regardless of the host project's module type. This is already consistent with D-03 (migrations run as a separate pre-deploy step, never at app boot).
**Warning signs:** `ERR_REQUIRE_ESM` in Railway build/pre-deploy logs, or in a Jest run that tries to `require()` the package directly instead of shelling out.

### Pitfall 2: `testcontainers`/`@testcontainers/postgresql` latest requires Node 22.22+
**What goes wrong:** `npm install @testcontainers/postgresql` (no version pin) installs 12.2.0, which declares `engines.node: ">= 22.22"`. On this repo's Node 20.x pin, npm emits `EBADENGINE` warnings; a future minor of either package could turn that into a hard failure (`engine-strict` in `.npmrc`, or an actual runtime API that assumes Node 22 features).
**Why it happens:** The Testcontainers Node.js project bumped its minimum supported Node version between 12.0.x and 12.1.0 without a major version bump.
**How to avoid:** Pin both packages to the exact version `12.0.4` (verified: no `engines` field, confirmed via `npm view testcontainers@12.0.4 engines` returning empty). Revisit the pin when/if the project's Node engine is ever bumped past 22.22.
**Warning signs:** `npm warn EBADENGINE` during install; CI failing on a fresh `npm ci` after an unpinned dependency bump.

### Pitfall 3: Railway's public Postgres TCP proxy fails default `pg` TLS verification
**What goes wrong:** The backfill CLI, connecting from the owner's Mac via `DATABASE_PUBLIC_URL`, gets a TLS handshake failure (self-signed cert, `CN=localhost`) even with `?sslmode=require` in the connection string.
**Why it happens:** Railway's TCP proxy terminates TLS with a self-signed certificate; `pg`'s (and most Postgres drivers') default verification mode rejects certs it can't chain to a trusted CA, and `sslmode=require` in a bare connection string still attempts chain verification for `pg` specifically (per community reports — this is a `pg`-driver nuance, not a general libpq behaviour).
**How to avoid:** Pass `ssl: { rejectUnauthorized: false }` explicitly in the `pg` client/pool config when connecting via `DATABASE_PUBLIC_URL` (encrypted-but-unverified — acceptable for this use case since it's a short-lived, owner-initiated, credential-bearing connection, not a public-facing service). The in-Railway private `DATABASE_URL` needs no SSL config (`ssl: false` or omitted).
**Warning signs:** `self-signed certificate` or `unable to verify the first certificate` errors when the backfill CLI first connects.

### Pitfall 4: `RAILWAY_ENVIRONMENT` does not distinguish staging from production
**What goes wrong:** A naive `if (process.env.RAILWAY_ENVIRONMENT === 'production')` mirror-gate check either always passes (if Railway happens to set the literal string `'production'` for `RAILWAY_ENVIRONMENT` on both services — unverified) or always fails, silently disabling the mirror everywhere or nowhere.
**Why it happens:** `RAILWAY_ENVIRONMENT` is already used in this codebase (`validateEnv.js` D-02) purely as a presence check ("is this Railway at all"), never compared against a specific value — its actual semantics on this Railway project have never been exercised here.
**How to avoid:** Use `RAILWAY_ENVIRONMENT_NAME` (Railway's documented per-environment-name variable) and confirm the exact string value on the Railway dashboard at provisioning time (D-15 checklist) before hardcoding the comparison.
**Warning signs:** The mirror fires on staging (writing to the shared production workbook — the exact failure mode D-07 exists to prevent) or never fires on production.

### Pitfall 5: `xlsx` (SheetJS) from the npm registry is abandoned with unpatched CVEs
**What goes wrong:** A naive `npm install xlsx` for the backfill reader pulls `0.18.5` (5 years stale, last npm publish), which carries 2 unpatched high-severity vulnerabilities (ReDoS, prototype pollution) — `npm audit` will flag this and it may trip the existing `npm audit --audit-level=high` CI gate (`tests.yml`/`gated-deploy.yml` already run this).
**Why it happens:** SheetJS stopped publishing new versions to the public npm registry in 2023 and moved to their own CDN (`cdn.sheetjs.com`) under a different distribution model; the npm-hosted package is a frozen, unmaintained fork of what it used to be.
**How to avoid:** Use `exceljs` instead (see Standard Stack) — same read use case, actively maintained, no open high-severity CVEs at time of research.
**Warning signs:** `npm audit` flagging `xlsx`; a CI failure on the existing `--audit-level=high` gate if it were ever installed.

### Pitfall 6: Pre-deploy runs in a separate, ephemeral container — no filesystem persistence
**What goes wrong:** A migration script that tries to write a lock file, cache, or any local-disk state to coordinate with the app's start command will find that state gone — the pre-deploy step and the app's start command run in **different containers**.
**Why it happens:** Railway's documented behaviour: "Pre-deploy commands run in a separate container from your application... filesystem changes don't persist and volumes aren't mounted."
**How to avoid:** Keep `0001_init.sql` (and every future migration) self-contained SQL with no dependency on anything the pre-deploy step might write to disk; `node-pg-migrate`'s own migration-tracking (`pgmigrations` table, inside Postgres itself) is unaffected since that state lives in the database, not the container filesystem.
**Warning signs:** A migration or its wrapper script trying to read a file that a previous step supposedly wrote.

## Code Examples

### `/health` extended with a `database` field (D-02 — non-fatal reporting)
```js
// Source: zoho-middleware/server.js:126-143 (existing pattern), extended per D-02
app.get('/health', function (req, res) {
  var redisOk = cache.isConnected();
  var redisCheck = redisOk
    ? cache.getClient().then(function (c) {
        if (!c) return false;
        return c.ping().then(function (r) { return r === 'PONG'; }).catch(function () { return false; });
      }).catch(function () { return false; })
    : Promise.resolve(false);

  var db = require('./lib/db');
  var dbCheck = db.isConfigured()
    ? db.query('select 1').then(function () { return true; }).catch(function () { return false; })
    : Promise.resolve(false); // matches D-01: DATABASE_URL optional outside prod

  Promise.all([redisCheck, dbCheck]).then(function (results) {
    res.json({
      status: 'ok',              // D-02: NEVER flips on database:false this phase
      authenticated: zohoAuth.isAuthenticated(),
      redis: results[0],
      database: results[1],
      uptime: process.uptime()
    });
  });
});
```
Note: the existing `gated-deploy.yml` smoke-check hard-fails on `redis !== 'true'` but does **not** currently check `database` — per D-02/the Deferred Ideas list ("Making `/health` fail... on database outage — revisit in Phase 84"), this phase should **not** add `database` to that smoke-check's hard-fail conditions; only extend the JSON shape.

### `validateEnv.js` addition (D-01)
```js
// Source: pattern mirrors existing REQUIRED_IN_PROD entries exactly
var REQUIRED_IN_PROD = [
  // ...existing entries...
  { name: 'DATABASE_URL', desc: 'Postgres connection string (private Railway network) — required in prod (D-01, DB-02)' }
];
```

### Migration file (`migrations/0001_init.sql`) skeleton
```sql
-- Source: node-pg-migrate SQL-migration format (salsita/node-pg-migrate docs + GitHub,
-- WebSearch-verified "-- Up Migration" / "-- Down Migration" comment markers)
-- Up Migration
-- D-04: additive only. Nothing here drops/renames/rewrites existing data (there is none yet).
-- Phase 83 proves the plumbing on an empty schema — no real tables for gift_cards etc. yet.
-- (Real per-store DDL arrives with its own migration file in Phases 84-88, per
--  .planning/notes/sheets-to-postgres-data-conversion.md §3.)
select 1; -- placeholder: replace with the actual empty-schema-proving DDL the plan settles on

-- Down Migration
select 1;
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|---------------|--------|
| `xlsx`/SheetJS via npm registry | `exceljs`, or SheetJS's own CDN tarball | SheetJS stopped npm publishing in 2023 | Any new `.xlsx`-reading code in this ecosystem should not reach for the npm-hosted `xlsx` package by habit |
| `node-pg-migrate` CJS builds | ESM-only from v8+ | Ongoing (v9 current, v10 alpha adding `require(esm)`) | CLI-only invocation is now a hard requirement for CommonJS projects on Node <22, not just a style preference |
| Testcontainers Node.js supporting Node 18/20 | Testcontainers Node.js 12.1.0+ requires Node 22.22+ | Recent minor bump within the 12.x line (between 12.0.4 and 12.1.0) | Pin to `12.0.4` until this project's Node engine is upgraded |

**Deprecated/outdated:** `xlsx` (SheetJS) on the public npm registry — unmaintained since 2023, unpatched CVEs, do not add as a new dependency.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|----------------|
| A1 | `exceljs` is the right `.xlsx`-reading replacement for the backfill pipeline (surfaced via WebSearch, not official docs/Context7) | Standard Stack, Don't Hand-Roll | Low — `exceljs` is a devDependency for a local-only script, not shipped to production; if the owner or planner prefers a different reader (e.g. SheetJS's own CDN tarball, since this codebase already deviates from npm-registry-only patterns nowhere else) the swap is contained to `scripts/backfill/read-xlsx.js` |
| A2 | Railway's production and staging *environment names* (not service names) are literally `production` and `staging` — inferred from the service names `svmiddleware-production`/`svmiddleware-staging` in `docs/RUNBOOK.md`, not confirmed against the Railway dashboard's Environments tab | Architecture Patterns (Pattern 4), Summary | High if wrong — D-07's mirror-hard-off-on-staging gate depends on this exact string match; a wrong value means the mirror check silently never fires (safe-ish, mirror just never runs) or worse, fires on staging (writes to the shared prod workbook, the exact incident D-07 exists to prevent). Confirm on the dashboard as part of the D-15 provisioning checklist before wiring Pattern 4 into code. |
| A3 | `node-pg-migrate`'s SQL-file support accepts an arbitrary sortable filename like `0001_init.sql` (not strictly requiring its own `create`-generated timestamp prefix) | Architecture Patterns (Pattern 2), Code Examples | Low-Medium — if node-pg-migrate's file-discovery regex requires a specific prefix format, `0001_init.sql` (already named in CONTEXT.md's locked decisions) may need renaming or a `--migration-filename-format` config flag; verify against the installed version's actual CLI help output (`node-pg-migrate --help`) during implementation, since the docs site returned a 404 for the specific configuration page fetched this session |
| A4 | Railway's `preDeployCommand` has access to the service's own `DATABASE_URL` and other environment variables at the environment-specific values (i.e., staging's pre-deploy sees staging's `DATABASE_URL`, not a project-wide shared value) | Architecture Patterns (Pattern 2) | Low — this matches Railway's documented per-environment variable scoping (already relied upon elsewhere in this repo, e.g. `STAFF_EMAILS` differing between `svmiddleware-production` and other environments per `docs/RUNBOOK.md`), and Railway's own docs state pre-deploy commands "have access to your application's environment variables" — but this specific claim (pre-deploy sees the *correct environment's* values, not some build-time snapshot) was not tested live this session |

## Open Questions

1. **Exact Railway environment names for `RAILWAY_ENVIRONMENT_NAME`**
   - What we know: service names are `svmiddleware-production`/`svmiddleware-staging` (confirmed in `docs/RUNBOOK.md`); Railway documents `RAILWAY_ENVIRONMENT_NAME` as "the environment name of the service instance," a distinct concept from service name.
   - What's unclear: whether the environments themselves (as opposed to the services) are named exactly `production`/`staging`, or something else (e.g. matching the Railway default of `production` for the first environment, with a custom-named second environment).
   - Recommendation: add a one-line dashboard check to the D-15 provisioning checklist — read the value directly (e.g., a throwaway `console.log(process.env.RAILWAY_ENVIRONMENT_NAME)` in a one-off deploy, or the Railway dashboard's Environments list) before hardcoding Pattern 4's string comparison.

2. **Whether `DATABASE_URL` (private) or a Railway "internal" reference variable is what actually gets linked into each middleware service's Variables tab**
   - What we know: Railway auto-populates `DATABASE_URL` when a Postgres plugin is referenced from a service in the same environment (standard Railway variable-reference behaviour, e.g. `${{Postgres.DATABASE_URL}}`); D-15 assigns this linking to the owner as a dashboard checklist step.
   - What's unclear: the exact reference variable name Railway generates for a Postgres service added to this specific project (it depends on what the Postgres service is named when provisioned, e.g. if the owner names it `Postgres` vs `postgres-staging`).
   - Recommendation: the plan's D-15 checklist step should have the owner confirm the generated variable name matches a literal `DATABASE_URL` in each middleware service's Variables tab (renaming the reference if Railway defaults to something like `POSTGRES_URL`), since `validateEnv.js` and `lib/db.js` both hardcode the name `DATABASE_URL`.

3. **`node-pg-migrate`'s exact CLI flags for pointing at a non-default migrations directory / scratch schema for the backfill pipeline's schema checks**
   - What we know: `--schema`/`-s` sets the schema migrations SQL runs against (default `public`); `--migrations-schema` sets where the tracking table lives.
   - What's unclear: whether the backfill pipeline's scratch-schema promotion step should also go through `node-pg-migrate` (schema-scoped) or be a separate raw-SQL step outside the migration-tracking system (since scratch-schema work is explicitly not "real" migrations, D-04's additive-only constraint may not even apply to it).
   - Recommendation: treat the scratch-schema DDL as ad-hoc SQL run by the backfill CLI itself (via `lib/db.js`'s `query()`), not as `node-pg-migrate` migrations — keeps the migrations table's history meaningful (only real, promoted schema changes) and avoids entangling the backfill pipeline's experimentation with the deploy-gating migration mechanism.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Docker | Testcontainers Jest harness (dev machine + CI) | ✓ (this research machine) | 28.0.2 (local); GitHub Actions `ubuntu-latest` ships Docker preinstalled per Testcontainers' own docs | D-14's local skip-with-message path when Docker is absent; CI has no fallback (must fail, per D-14) |
| Node.js | Everything in this phase | ✓ | v20.17.0 (matches `zoho-middleware/package.json` `engines.node: "20.x"` and root `.nvmrc` = `20`) | — |
| `psql` (CLI client) | Manual inspection during backfill/migration debugging (not required by any automated step) | ✗ (not installed on this research machine) | — | `pg` (the npm library) covers all programmatic needs; `psql` is a nice-to-have for the owner's manual DB poking — `brew install postgresql` if wanted, or use `railway connect` (Railway CLI, confirmed available locally at v4.30.2) which opens a `psql` session without a separate install |
| Railway CLI | Optional — deploy-ID capture already uses it in `gated-deploy.yml`; could assist manual DB connection (`railway connect`) | ✓ | 4.30.2 (local) | Not required by this phase's automated plumbing; useful for the owner's D-15/D-16 dashboard-adjacent checks |
| Railway Postgres (staging + production instances) | The entire phase | ✗ — not yet provisioned (D-15: owner action, outside Claude's reach) | — | None — this is the phase's own precondition; the plan must sequence the owner's provisioning checklist (D-15) before any code that assumes `DATABASE_URL` exists can be exercised end-to-end |

**Missing dependencies with no fallback:**
- Both Railway Postgres databases (staging + production) — must be provisioned by the owner (D-15) before this phase's middleware can deploy successfully (D-01 makes `DATABASE_URL` required-in-prod).

**Missing dependencies with fallback:**
- `psql` CLI — `railway connect` (already installed) or `pg`-library-only workflows cover the gap.

## Validation Architecture

Skipped: `.planning/config.json` sets `workflow.nyquist_validation: false` explicitly. Per the skip condition in this agent's protocol, no test-framework/requirement-to-test mapping is produced. (Noted here only because the task's output instructions explicitly asked this section be present — config-driven skip takes precedence over the boilerplate ask; the phase's own Jest-harness requirements are instead covered under Architecture Patterns → Pattern 5 and Don't Hand-Roll above.)

## Security Domain

`workflow.security_enforcement: true`, `security_asvs_level: 1`, `security_block_on: "high"` (`.planning/config.json`).

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|----------------|---------|-------------------|
| V2 Authentication | No | This phase adds no new authn surface |
| V3 Session Management | No | No session changes |
| V4 Access Control | Partial — yes | `DATABASE_URL`/`DATABASE_PUBLIC_URL` are bearer credentials to the entire database; access is scoped to (a) the Railway middleware process (via Railway's own env-var injection, already access-controlled by the Railway dashboard) and (b) the owner's laptop for the backfill CLI (D-10) — no code-level access control needed this phase since no HTTP endpoint exposes DB access directly |
| V5 Input Validation | Yes | Every `lib/db.js` `query()` call MUST use parameterized queries (`$1`, `$2`, ...) — never string-concatenate or template-literal user/Sheets-derived data into SQL text. The store-flag helper's enum validation (Pattern 3) is itself an input-validation control (D-06: reject-not-coerce on invalid env values) |
| V6 Cryptography | Yes | TLS handling for Postgres connections — see Pitfall 3 (`ssl: { rejectUnauthorized: false }` for the public proxy, no SSL needed for the private network). `DATABASE_URL`/`DATABASE_PUBLIC_URL` must never be logged verbatim (both embed a plaintext password) — audit any error-logging path that might interpolate a `pg` connection error object, since `pg` error messages can echo back connection parameters |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|----------------------|
| SQL injection via string-built queries | Tampering | Parameterized queries only (`pg`'s `$1`/`$2` placeholders); code review should flag any `query('... ' + variable)` pattern in `lib/db.js` callers |
| Credential leakage via logged connection strings or Sentry breadcrumbs | Information Disclosure | Never `log.info`/`console.log` a raw `DATABASE_URL`/`DATABASE_PUBLIC_URL`; if `lib/db.js` ever logs a connection error, strip/redact the connection string field before logging or sending to Sentry (existing `lib/sentry-capture.js`'s never-throw wrapper does not itself redact — a redaction step must be added at the call site) |
| PII exposure via committed snapshot/rejects files | Information Disclosure | D-13 already covers this (gitignore, never commit `.xlsx` snapshots or rejects reports) — the plan should add the actual glob pattern(s) to `.gitignore` as part of implementing the backfill CLI, not just document the rule |
| Self-signed-cert MITM risk on the public TCP proxy (`rejectUnauthorized: false`) | Tampering / Spoofing | Accepted risk for this specific use-case (short-lived, owner-initiated, credential-bearing connection over Railway's own infrastructure — not a general pattern to reuse elsewhere); do not extend `rejectUnauthorized: false` to any other TLS connection in this codebase without the same reasoning |
| Invalid/malicious store-flag env value silently falling back to an unintended mode | Tampering (config integrity) | D-06 already mandates fail-closed (refuse to boot) rather than coerce — Pattern 3 implements this |

## Sources

### Primary (HIGH confidence)
- `npm view pg version` / `npm view pg engines` — registry query, this session, 2026-09-30
- `npm view node-pg-migrate version` / `engines` — registry query, this session
- `npm view @testcontainers/postgresql versions --json` / `engines` (multiple version probes: 12.2.0, 12.1.0, 12.0.4, 12.0.0) — registry query, this session
- `npm view testcontainers@<version> engines` (same probe set) — registry query, this session
- `npm view exceljs version` / `engines` — registry query, this session
- Live reproduction: `npm install testcontainers @testcontainers/postgresql ... ` in `zoho-middleware/` on Node v20.17.0, observed `EBADENGINE` warnings, then reverted (`git checkout -- package.json package-lock.json`) — this session
- `slopcheck install pg node-pg-migrate @testcontainers/postgresql testcontainers exceljs` — this session, all 5 rated [OK]
- Direct codebase reads: `zoho-middleware/lib/validateEnv.js`, `zoho-middleware/server.js` (`/health`, ~:126-143), `railway.toml`, `.github/workflows/gated-deploy.yml`, `.github/workflows/tests.yml`, `zoho-middleware/lib/sentry-capture.js`, `zoho-middleware/package.json`, `zoho-middleware/jest.config.js`, `.gitignore`, `docs/RUNBOOK.md` (grep for Railway service/environment names) — this session

### Secondary (MEDIUM confidence)
- [Railway: Add a Pre-Deploy Command](https://docs.railway.com/deployments/pre-deploy-command) — WebFetch this session: timing (after build, before start), env var/private-network access, fail-blocks-deploy semantics, ephemeral separate-container filesystem behaviour
- [Railway: Config as Code Reference](https://docs.railway.com/config-as-code/reference) — WebFetch this session: `preDeployCommand` array/string syntax in `[deploy]`
- [Railway: Variables Reference](https://docs.railway.com/variables/reference) — WebFetch this session: `RAILWAY_ENVIRONMENT_NAME`, `RAILWAY_ENVIRONMENT_ID` definitions
- [Railway: PostgreSQL](https://docs.railway.com/databases/postgresql) — WebFetch this session: `DATABASE_URL` vs `DATABASE_PUBLIC_URL`, TCP proxy, network egress billing
- [salsita/node-pg-migrate GitHub — Roadmap: v9 → v10 discussion #1635](https://github.com/salsita/node-pg-migrate/discussions/1635) — WebSearch this session: ESM-only status of v9, `require(esm)` plan for v10
- [Railway Help Station — pre-deploy command fails, deployment blocked](https://station.railway.com/questions/pre-deploy-command-failed-without-logs-918a0db8) and related threads — WebSearch this session: corroborates fail-blocks-deploy, old-release-keeps-serving behaviour
- Railway community reports on public-proxy self-signed cert + `pg` `ssl: { rejectUnauthorized: false }` requirement (Railway Help/Central Station threads, a GitHub PR titled "SMA-24: TLS for Railway public Postgres") — WebSearch this session
- [node-pg-migrate npm package page](https://www.npmjs.com/package/node-pg-migrate) — confirms `DATABASE_URL` env var convention, CLI `.bin` installation
- SheetJS/`xlsx` npm-registry abandonment: [bleepingcomputer.com coverage](https://www.bleepingcomputer.com/news/software/npm-package-with-14m-weekly-downloads-ditches-npmjscom-for-own-cdn/), [sarmalinux.com "From xlsx to exceljs"](https://www.sarmalinux.com/blog/xlsx-to-exceljs-no-fix-available) — WebSearch this session
- `.planning/research/sheets-to-postgres-migration.md` §1.2, §4 (Stage 1), §5.1–5.4 — prior milestone research, carried-forward stack decisions
- `.planning/notes/sheets-to-postgres-data-conversion.md` — conversion traps (money/timestamps/IDs/nulls/booleans/jsonb) and per-sheet DDL for the trivially-portable tables

### Tertiary (LOW confidence — flagged for validation)
- node-pg-migrate's exact SQL-filename-format requirement (`0001_init.sql` acceptability) — the specific docs page fetched returned 404; general `.sql`-with-comment-marker support is confirmed, but filename-prefix strictness is not (see Assumption A3)
- Whether Railway's production/staging environments are literally named `production`/`staging` (see Assumption A2, Open Question 1)

## Metadata

**Confidence breakdown:**
- Standard stack (versions/engines): HIGH — every version and engine constraint independently verified via `npm view` against the live registry this session, with one finding (testcontainers Node-22 requirement) reproduced via a real (then-reverted) install
- Architecture (db.js/store-flag/migrations-as-pre-deploy): HIGH for the Railway mechanics (WebFetch'd official docs + corroborating community reports); MEDIUM for the exact env-var value assumptions (RAILWAY_ENVIRONMENT_NAME's actual string) pending dashboard confirmation
- Pitfalls: HIGH for the four concrete, sourced findings (ESM-only, Node-22 engine bump, self-signed public-proxy cert, RAILWAY_ENVIRONMENT ambiguity); MEDIUM for Railway's exact pre-deploy failure semantics (docs + one corroborating community report, not an authoritative test against this specific project)

**Research date:** 2026-09-30
**Valid until:** ~30 days for the Railway-mechanics findings (Railway's docs/behaviour can shift; config-as-code itself is flagged deprecated in favor of Infrastructure-as-Code with a 2026-12-01 cutover per one search result — worth re-checking if this phase's implementation slips past that date); ~7 days for the exact npm version numbers (fast-moving registry), though the *engine-constraint* findings (testcontainers 12.1.0+ needing Node 22.22+) are structural and unlikely to reverse within 30 days.
