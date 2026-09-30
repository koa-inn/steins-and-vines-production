# Phase 83: Postgres Infrastructure - Context

**Gathered:** 2026-09-30
**Status:** Ready for planning

<domain>
## Phase Boundary

Stand up the Postgres plumbing every later v4.9 phase reuses, proven on an **empty schema** — no
real data is loaded into real tables in this phase (DB-02, ROADMAP Phase 83):

- Railway Postgres in the `sv-middleware` project for **staging and production**, distinct `DATABASE_URL`s
- `pg` + `node-pg-migrate` as production dependencies (`railway.toml` builds with `npm install --production`)
- `zoho-middleware/lib/db.js` — one `Pool`, `query()`, `withTransaction(fn)`
- `migrations/0001_init.sql`, applied on deploy
- `DATABASE_URL` in `validateEnv.js`; `/health` reports the database alongside redis
- Jest harness on a real Postgres (Testcontainers), run on CI
- The generic per-store flag helper (`<STORE>_STORE` = `sheets` | `dual` | `postgres`, default `sheets`,
  production Sheet mirror hard-off on staging)
- The reusable backfill pipeline (`.xlsx` snapshot → per-sheet export → normalise → rejects file →
  scratch schema → row-count/min/max checks → promote), run end-to-end into a scratch schema only

Moving any actual store (gift cards etc.) is Phases 84–88.

</domain>

<decisions>
## Implementation Decisions

### Carried forward (already decided — do not re-open)
- **Stack:** raw `pg` (no ORM/query builder), `node-pg-migrate`, `@testcontainers/postgresql`; reject
  `pg-mem` — research §5.2–5.4.
- **Hosting:** Railway Postgres in both environments (not Neon/Supabase) — research §5.1.
- **Mirror/staging (owner, 2026-09-23):** production keeps a fire-and-forget Google Sheet mirror for
  every migrated table indefinitely; staging writes only to its own Postgres and **never** mirrors to
  the shared workbook; Schedule + Homepage never go to Postgres (Phase 88 → repo content).
- All six stages committed up front (research §9 trigger gating dropped).

### Database-down behaviour
- **D-01:** `DATABASE_URL` is **required in production only** — add it to `validateEnv.js`'s
  `REQUIRED_IN_PROD` list (staging's Railway env counts as prod there, and gets its own database).
  Local dev and CI may run without it. Consequence: both Railway databases must exist and be linked
  **before** this phase's middleware deploys.
- **D-02:** A database **outage at runtime** is reported, not fatal: `/health` gains a `database`
  field (true/false) but `status` stays `ok` — no Railway restart, kiosk keeps selling (same treatment
  as Zoho `authenticated:false` today). Revisit when the first store reads from Postgres (Phase 84).
- **D-03:** Migrations run as a **Railway pre-deploy step**, not at app boot: a failing migration
  aborts the deploy and Railway keeps the current version running. Researcher confirms the exact
  Railway mechanism (`preDeployCommand` in `railway.toml` or equivalent) and that it works with the
  `npm install --production` build.
- **D-04:** Deploy-time migrations are **additive only**. Anything that drops, renames or rewrites
  data is a separate, manually triggered step with a backup first. Planner should make this
  enforceable (convention + review check at minimum).

### Store switch
- **D-05:** Each store's switch is a **Railway env var** (`<STORE>_STORE`, e.g. `GIFT_CARDS_STORE`).
  Flipping = edit the variable → Railway restarts (~1 min). No runtime/admin toggle.
- **D-06:** An **invalid value** (anything but `sheets` | `dual` | `postgres`) **refuses to start**
  with a clear message — never silently falls back. Unset = `sheets`.
- **D-07:** "No production-Sheet mirror on staging" is **hard-coded and not overridable** — the mirror
  helper no-ops unless running in production. NOTE: staging and production both run as
  `NODE_ENV=production`, so the production check must use a reliable environment signal (e.g.
  Railway's `RAILWAY_ENVIRONMENT_NAME`) — researcher to verify what Railway sets and that it cannot
  be mistaken.
- **D-08:** Build a **generic dual-write comparison helper now** (compare Sheets vs Postgres result,
  report discrepancies to Sentry), so Phase 84+ stores just call it. Reuse the existing Sentry
  capture wrapper pattern (`lib/sentry-capture.js` — never throws into the caller).

### Backfill pipeline & staging data
- **D-09:** Source is an **`.xlsx` the owner downloads** from the workbook (File → Download) — a
  frozen, repeatable snapshot. No Sheets-API credentials for the pipeline.
- **D-10:** The pipeline runs **on the owner's Mac** as an npm script against a chosen
  `DATABASE_URL` (staging or production, copied from Railway), showing each step and the rejects
  report. Researcher checks how Railway exposes the DB for external connections (public proxy URL
  vs private) and what that implies (TLS, credentials handling on the laptop).
- **D-11:** Staging's Postgres gets a **full real copy** of production data (fidelity over scrubbing;
  staging is behind Cloudflare Access and already reads the live workbook today).
- **D-12:** Unconvertible rows go to a **rejects file with reasons, and promotion is blocked** until
  rejects are zero or the owner explicitly accepts them.
- **D-13 (follow-on):** Snapshot `.xlsx` files and rejects reports contain customer PII — they must
  live outside the repo or be git-ignored; never committed.

### Local testing & setup
- **D-14:** Tests use **Testcontainers/Docker**. When Docker isn't running locally, the DB test files
  **skip with a clear message** and the rest of the suite runs; **CI always runs them** (no silent
  skip on CI — CI must fail if Docker is unavailable).
- **D-15:** The **owner provisions** both Railway Postgres databases in the dashboard (paid add-on)
  from a checklist step in the plan, and links `DATABASE_URL` into each environment's middleware
  service. Claude cannot log in to Railway from here.
- **D-16:** **Confirm Railway backups / PITR are enabled** on both databases in this phase (dashboard
  check, recorded) — 82-01 left the plan gating unverified and Phase 84 puts real balances in. The
  full **restore drill stays in Phase 88**.
- **D-17:** **Ship Phase 83 to production as soon as it's done** (empty DB, health field, migrations
  live early) — not held for Phase 84. Follow CLAUDE.md: staging first, then the gated deploy.

### Claude's Discretion
- Exact file/module layout (`lib/db.js`, store-flag helper, comparison helper, backfill scripts),
  naming of the scratch schema and migration files, per-sheet normalisation order details (follow
  research conversion traps), and how the pipeline's CLI is shaped.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Migration plan & technology
- `.planning/research/sheets-to-postgres-migration.md` §4 "Stage 1 — Infrastructure" — phase scope and effort
- `.planning/research/sheets-to-postgres-migration.md` §5.1–5.4 — Railway hosting/backups caveat, raw `pg`, `node-pg-migrate`, Testcontainers (reject `pg-mem`)
- `.planning/research/sheets-to-postgres-migration.md` §1.2 — per-sheet table (inputs for the backfill pipeline)
- `.planning/research/PITFALLS.md`, `.planning/research/STACK.md`, `.planning/research/ARCHITECTURE.md` — milestone research (conversion traps: money as float, mixed timestamp shapes, zero-padded text IDs, `''` vs NULL, string booleans, jsonb steps)

### Requirements & roadmap
- `.planning/ROADMAP.md` §"Phase 83: Postgres Infrastructure" — goal + 4 success criteria
- `.planning/REQUIREMENTS.md` — DB-02 (and DB-03..07 for what the helpers must serve)

### Prior phase
- `.planning/phases/82-store-agnostic-prerequisites/82-01-SUMMARY.md` — owner checks (Railway backups unconfirmed)
- `.planning/phases/82-store-agnostic-prerequisites/82-10-SUMMARY.md` — current production deploy state, rollback targets, notes for later phases

### Deploy & operations
- `railway.toml` — build (`npm install --production`), watchPatterns, start command
- `.github/workflows/gated-deploy.yml` — production deploy path (now waits for the Railway deployment of the pushed commit, `ff5515e8`)
- `.github/workflows/tests.yml` — CI test jobs (must run the Postgres harness)
- `docs/RUNBOOK.md` — deploy history, rollback procedures (add DB provisioning/migration notes)
- `CLAUDE.md` — non-negotiable rules (regression test first, full suites before commit, staging first)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `zoho-middleware/lib/validateEnv.js`: `REQUIRED` / `REQUIRED_IN_PROD` lists with descriptive messages and exit-on-missing — `DATABASE_URL` slots into `REQUIRED_IN_PROD` (D-01).
- `zoho-middleware/lib/sentry-capture.js`: never-throwing Sentry wrapper — basis for the dual-write discrepancy reporter (D-08).
- `zoho-middleware/lib/logger.js`: structured logging used across the middleware.
- `zoho-middleware/lib/cache.js` + `lib/checkRedis.js`: precedent for an optional backing service with a health probe (`/health` redis ping in `server.js` ~:126).

### Established Patterns
- CommonJS, Node 20, no TypeScript, no build step; ES5 in `js/`. Keep new code plain JS.
- Startup work that can hang must not block `app.listen` (see `server.js` ~:736 `checkMailer` comment) — the DB pool must not delay listen either (consistent with D-02).
- `/health` shape `{status, authenticated, redis, uptime}` is consumed by `gated-deploy.yml`'s smoke-check (jq on `.redis`) — adding `database` must not change `status` semantics (D-02).
- Jest tests in `zoho-middleware/__tests__/`, mocks for external services; Testcontainers-backed tests are new — isolate them (own files/config) so they can skip cleanly without Docker (D-14).

### Integration Points
- `railway.toml` `[deploy]` — add the pre-deploy migration command (D-03).
- `zoho-middleware/package.json` — `pg`, `node-pg-migrate` as production deps; `@testcontainers/postgresql` dev dep; npm scripts for migrate + backfill.
- `server.js` `/health` — add `database` field.
- `.github/workflows/tests.yml` and `gated-deploy.yml` test jobs — ubuntu runners have Docker; ensure the DB tests run (not skip) there.
- `.gitignore` — snapshot/rejects locations (D-13).

</code_context>

<specifics>
## Specific Ideas

- Railway `DATABASE_URL` is auto-injected when the Postgres service is referenced from the middleware service — the provisioning checklist (D-15) should say exactly which variable reference to add per environment.
- Research budget: Stage 1 ≈ 2–3 days; rollback = delete the service (nothing depends on it yet).
- Backup posture note from research §5.1: until a restore is rehearsed, Postgres backup posture is arguably worse than the nightly Drive copy — hence D-16 now and the drill in Phase 88.

</specifics>

<deferred>
## Deferred Ideas

- Making `/health` fail (and gating deploys) on database outage — revisit in Phase 84 once gift cards read from Postgres (D-02).
- Restore drill for Railway backups — Phase 88 (DB-07).

### Reviewed Todos (not folded)
- `admin-write-attribution-kiosk-middleware.md`, `brewpad-writes-retry-once.md`, `ga4-staging-pollutes-prod-property.md`, `gated-deploy-branch-unsafe.md`, `giftcard-ledger-empty-tab-crash.md` — matched on generic keywords only; unrelated to Postgres infrastructure. Gift-card ledger crash becomes moot once Phase 84 moves gift cards.

</deferred>

---

*Phase: 83-postgres-infrastructure*
*Context gathered: 2026-09-30*
