# Phase 83: Postgres Infrastructure - Pattern Map

**Mapped:** 2026-09-30
**Files analyzed:** 20 (new + modified)
**Analogs found:** 18 / 20

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|--------------------|------|-----------|-----------------|---------------|
| `zoho-middleware/lib/db.js` | service (connection pool) | CRUD / request-response | `zoho-middleware/lib/cache.js` | role-match (optional backing service, lazy connect, `isConnected()`) |
| `zoho-middleware/lib/store-flag.js` | utility / config gate | request-response (boot-time) | `zoho-middleware/lib/validateEnv.js` | exact (fail-fast enum validation, `process.exit(1)`) |
| `zoho-middleware/lib/dual-write-compare.js` | utility (never-throw wrapper) | event-driven (fire-and-forget report) | `zoho-middleware/lib/sentry-capture.js` | exact (never-throw wrapper around an external call) |
| `zoho-middleware/lib/mirror-gate.js` (or similar — D-07 helper) | utility / config gate | request-response (boot/runtime check) | `zoho-middleware/lib/validateEnv.js` (RAILWAY_ENVIRONMENT check, lines 78-88) | role-match |
| `migrations/0001_init.sql` (`zoho-middleware/migrations/0001_init.sql`) | migration | batch (deploy-time DDL) | none in-repo — first SQL migration file | no analog — use RESEARCH.md Pattern 2 skeleton |
| `railway.toml` (modify) | config | deploy pipeline | itself (existing `[build]`/`[deploy]` blocks) | exact — additive edit |
| `zoho-middleware/lib/validateEnv.js` (modify) | config / middleware | request-response (boot gate) | itself | exact — additive edit to `REQUIRED_IN_PROD` |
| `zoho-middleware/server.js` `/health` (modify) | route/controller | request-response | itself, lines 126-143 (existing redis check) | exact — additive edit, same shape |
| `zoho-middleware/scripts/backfill/backfill.js` | utility (CLI entrypoint) | batch / file-I/O | `zoho-middleware/scripts/import-vessels.js` | role-match (local CLI, argv flags, summary + error list) |
| `zoho-middleware/scripts/backfill/read-xlsx.js` | utility (file reader) | file-I/O | `zoho-middleware/scripts/csv-to-snapshot.js` | role-match (reads a spreadsheet-shaped file into row objects) |
| `zoho-middleware/scripts/backfill/normalize.js` | transform | batch / transform | `zoho-middleware/scripts/import-vessels.js` (`buildItemName`/`buildDescription`, per-field mapping) | partial-match (per-field transform functions, no direct normalize analog) |
| `zoho-middleware/scripts/backfill/rejects.js` | utility (file writer) | file-I/O | `zoho-middleware/scripts/export-snapshot.js` (`fs.writeFile` + exit-code pattern) | role-match |
| `zoho-middleware/__tests__/db/db.test.js` | test | CRUD (integration) | `zoho-middleware/__tests__/cache.test.js` | role-match (lib-level test for an optional backing service) |
| `zoho-middleware/__tests__/db/migrations.test.js` | test | batch (schema apply) | `zoho-middleware/__tests__/validateEnv.test.js` | partial-match (isolated module test with env/process setup) |
| `zoho-middleware/jest.db.config.js` | config | — | `zoho-middleware/jest.config.js` | exact — sibling config, same shape |
| `zoho-middleware/jest.config.js` (modify) | config | — | itself | exact — additive `testPathIgnorePatterns` |
| `zoho-middleware/package.json` (modify) | config | — | itself | exact — additive deps/scripts |
| `.gitignore` (modify) | config | — | itself | exact — additive entries |
| `.github/workflows/tests.yml` (modify) | CI config | batch (CI job) | itself, `test-middleware` job (lines 9-25) | exact — additive `test:db` step |
| `docs/RUNBOOK.md` (modify — D-15/D-16 checklist) | docs | — | itself, "Human Prerequisites" section (lines 212+) | exact — additive checklist section |

## Pattern Assignments

### `zoho-middleware/lib/db.js` (service, CRUD/request-response)

**Analog:** `zoho-middleware/lib/cache.js` (optional backing service with lazy connect + `isConnected()`)

**Imports pattern** (`lib/cache.js` lines 8-9):
```js
var redis = require('redis');
var log = require('./logger');
```
For `db.js`, swap to `var { Pool } = require('pg'); var log = require('./logger');` — RESEARCH.md Pattern 1 already gives the full module verbatim (SSL branching on `DATABASE_URL` vs `DATABASE_PUBLIC_URL`'s `.proxy.rlwy.net` host). Use that as the primary source; `cache.js` is the structural analog for "optional backing service that the rest of the app must tolerate being down."

**Optional-service pattern** (`lib/cache.js` lines 18-58, 173-175):
```js
function isConnected() {
  return connected;
}
```
`db.js` must expose the equivalent `isConfigured()` (RESEARCH.md Pattern 1 line ~291) so `server.js`'s `/health` and callers can probe without throwing — same shape as `cache.isConnected()`.

**Error handling / never-block-listen pattern** — see `lib/checkRedis.js` (full file, 14 lines): a separate startup-check module that logs and continues rather than crashing the process on an unavailable backing service. `db.js` itself does not need a `checkDb.js` this phase (D-02: outage is reported via `/health`, not boot-blocking) but the "warn and continue, never throw from startup" shape is the one to copy if a `checkDb.js` is added for parity with `checkRedis.js`'s log-and-continue pattern.

---

### `zoho-middleware/lib/store-flag.js` (utility/config gate, boot-time request-response)

**Analog:** `zoho-middleware/lib/validateEnv.js` (full file read, 140 lines)

**Fail-fast enum/required pattern** (lines 99-105, 113-124):
```js
if (missing.length > 0) {
  missing.forEach(function (v) {
    log.error('[startup] Missing required env var: ' + v.name + ' — ' + v.desc);
  });
  log.error('[startup] ' + missing.length + ' required env var(s) missing. Exiting.');
  process.exit(1);
}
...
if (isProd) {
  var missingProd = REQUIRED_IN_PROD.filter(function (v) { return !process.env[v.name]; });
  if (missingProd.length > 0) {
    missingProd.forEach(function (v) {
      log.error('[startup] Missing required prod secret: ' + v.name + ' — ' + v.desc);
    });
    log.error('[startup] ' + missingProd.length + ' required prod secret(s) missing. Exiting. (D-06)');
    process.exit(1);
  }
}
```
`store-flag.js`'s `resolveStoreMode()` should copy this exact "log every violation, then a single summary `log.error`, then `process.exit(1)`" shape (RESEARCH.md Pattern 3 gives the concrete implementation — same style, smaller scope: one var at a time, called per configured store from `server.js` alongside `validateEnv()`).

**Import pattern** (line 1):
```js
var log = require('./logger');
```

---

### `zoho-middleware/lib/dual-write-compare.js` (utility, never-throw wrapper, event-driven)

**Analog:** `zoho-middleware/lib/sentry-capture.js` (full file, 33 lines) — this is the exact pattern D-08 names explicitly.

**Never-throw wrapper pattern** (lines 23-30):
```js
function captureExceptionSafe(err, options) {
  try {
    return Sentry.captureException(err, options);
  } catch {
    // Never let telemetry block a money-safety path (void, refund, etc).
    return undefined;
  }
}

module.exports = { captureExceptionSafe: captureExceptionSafe };
```
`dual-write-compare.js`'s `compareAndReport(sheetsResult, pgResult, context)` should wrap its Sentry-reporting call the same way (`require('./sentry-capture').captureExceptionSafe(...)` on discrepancy) and itself never throw into the caller — same `try { ... } catch { return undefined; }` shape, same one-line JSDoc-style comment explaining *why* (a comparison helper must not break the write path it's auditing).

---

### `zoho-middleware/lib/validateEnv.js` (modify — D-01)

**Analog:** itself — additive change only.

**Exact insertion point** (lines 15-25, `REQUIRED_IN_PROD` array):
```js
var REQUIRED_IN_PROD = [
  { name: 'RECAPTCHA_SECRET_KEY',  desc: 'Google reCAPTCHA secret — required in prod (fail-closed, HARDEN-01)' },
  ...
  { name: 'SHEETS_CLIENT_ID',      desc: 'Google OAuth client ID for server-side aud check (D-46-05)' },
];
```
Append `{ name: 'DATABASE_URL', desc: 'Postgres connection string (private Railway network) — required in prod (D-01, DB-02)' }` to this array (RESEARCH.md's "Code Examples" section gives this exact line). No other change needed — the existing `missingProd` loop (lines 114-123) already handles it.

**Corresponding test analog:** `zoho-middleware/__tests__/validateEnv.test.js` (lines 1-80+) — follow its `PROD_SECRETS` array + `beforeEach`/`clearEnv`/`setEnv` harness; add `DATABASE_URL` to the `PROD_SECRETS` list used by the existing D-06 test cases rather than writing a new test file.

---

### `zoho-middleware/server.js` `/health` (modify — D-02)

**Analog:** itself, lines 126-143 (existing redis check, read in full).

**Exact current code:**
```js
app.get('/health', function (req, res) {
  var redisOk = cache.isConnected();
  var redisCheck = redisOk
    ? cache.getClient().then(function (c) {
        if (!c) return false;
        return c.ping().then(function (r) { return r === 'PONG'; }).catch(function () { return false; });
      }).catch(function () { return false; })
    : Promise.resolve(false);

  redisCheck.then(function (redisPong) {
    res.json({
      status: 'ok',
      authenticated: zohoAuth.isAuthenticated(),
      redis: redisPong,
      uptime: process.uptime()
    });
  });
});
```
RESEARCH.md's "Code Examples" section gives the extended version verbatim (`Promise.all([redisCheck, dbCheck])`, `db.isConfigured() ? db.query('select 1')... : Promise.resolve(false)`, `database: results[1]` added to the JSON — `status` never flips per D-02). Follow that extension exactly; it is a direct, same-file edit, not a new pattern.

**Downstream consumer to NOT touch:** `.github/workflows/gated-deploy.yml`'s smoke-check step (lines 305-378) parses `.redis`/`.authenticated`/`.uptime` via `jq` but does **not** reference `.database` — per D-02/Deferred Ideas, do not add a hard-fail branch on `database` there this phase.

---

### `zoho-middleware/scripts/backfill/*.js` (CLI, file-I/O/batch)

**Analogs:** `zoho-middleware/scripts/import-vessels.js` (full file, 220+ lines) and `zoho-middleware/scripts/export-snapshot.js` (full file, 83 lines) — both are existing local-CLI scripts run by the owner against a local file/CSV, exactly the shape D-09/D-10 specify for the backfill pipeline.

**Argv/flag parsing pattern** (`import-vessels.js` lines 29-40):
```js
var CSV_PATH = process.argv[2] && !process.argv[2].startsWith('--')
  ? process.argv[2]
  : path.join(__dirname, '..', '..', ...);
var DRY_RUN = process.argv.includes('--dry-run');
```
Use this shape for `backfill.js`'s `--file=`, `--sheet=`, `--target=`, `--schema=`, `--accept-rejects` flags (simple `process.argv` scanning — no arg-parsing library is used anywhere else in this codebase, so don't introduce one).

**Preflight existence/reachability check pattern** (`import-vessels.js` lines 132-137):
```js
if (!fs.existsSync(VESSEL_CSV)) {
  console.error('CSV not found: ' + VESSEL_CSV);
  process.exit(1);
}
```
`read-xlsx.js`/`backfill.js` should preflight-check the `.xlsx` file and the target `DATABASE_URL`/`DATABASE_PUBLIC_URL` connectivity the same way before doing any work.

**Per-row processing + error collection + summary pattern** (`import-vessels.js` lines 163-221):
```js
var created = 0;
var skipped = 0;
var errors = [];
for (var i = 0; i < vessels.length; i++) {
  ...
  try {
    await createItemViaMiddleware(payload);
    console.log('  ✓ Created: ' + label);
    created++;
  } catch (err) {
    console.error('  ✗ Failed:  ' + label + ' — ' + msg);
    errors.push({ id: vessel.ID, error: msg });
  }
}
console.log('\n--- Import Summary ---');
console.log('  Total vessels: ' + vessels.length);
console.log('  Created:       ' + created);
console.log('  Errors:        ' + errors.length);
```
This is the direct analog for `normalize.js`/`rejects.js`: per-row REJECT (not coerce) into an `errors`/`rejects` array with a reason, then a summary block at the end — same `console.log` style, same "count + list" shape. `rejects.js` additionally needs to **write** the rejects array to a gitignored file (see `export-snapshot.js` lines 62-68's `fs.writeFile` + exit-code-on-error pattern) rather than only printing it.

**Exit-code contract pattern** (`export-snapshot.js` lines 15-16, 38, 59, 66, 74, 81):
```js
// The script exits 0 on success and 1 on failure so it can be chained
// into a pre-deploy npm script if desired.
```
`backfill.js` must follow the same contract — D-12 requires promotion to block (non-zero exit) until rejects are zero or `--accept-rejects` is passed, mirroring `export-snapshot.js`'s existing "exit 1 on any failure condition" style.

---

### `zoho-middleware/__tests__/db/db.test.js` and `migrations.test.js` (test, integration)

**Analog:** `zoho-middleware/__tests__/cache.test.js` (structure read, lines 1-60) and `zoho-middleware/__tests__/validateEnv.test.js` (structure read, lines 1-80).

**Mock-then-require pattern** (`cache.test.js` lines 1-31):
```js
jest.mock('redis', () => ({ createClient: jest.fn() }));
jest.mock('../lib/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));

describe('cache', () => {
  var cache;
  beforeEach(() => {
    jest.resetModules();
    ...
    cache = require('../lib/cache');
  });
```
The DB tests are Testcontainers-backed (real Postgres, not mocked — RESEARCH.md Pattern 5 gives the concrete `PostgreSqlContainer` setup), so this analog applies only to the **structural** convention (`jest.resetModules()` in `beforeEach`, fresh `require()` per test, `describe`/`beforeAll`/`afterAll` nesting) — not to mocking `pg` itself.

**Env-snapshot/restore + `process.exit` spy pattern** (`validateEnv.test.js` lines 55-78):
```js
beforeEach(() => {
  SAVED_ENV = Object.assign({}, process.env);
  jest.resetModules();
  ...
  jest.spyOn(process, 'exit').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});
```
Reuse this exact harness for `store-flag.js`'s own test file (not listed as a separate row above but implied by "Claude's Discretion" — `resolveStoreMode()` needs a D-06 invalid-value test following this same env-snapshot + `process.exit` spy shape).

---

### `zoho-middleware/jest.db.config.js` (config)

**Analog:** `zoho-middleware/jest.config.js` (full file, 31 lines).

```js
module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/__tests__/**/*.test.js'],
  setupFiles: ['<rootDir>/jest.setup.js'],
  collectCoverage: true,
  ...
};
```
RESEARCH.md's Pattern 5 already gives the concrete `jest.db.config.js` contents (`testMatch: ['<rootDir>/__tests__/db/**/*.test.js']`, `collectCoverage: false`, `testTimeout: 60000`) — follow that verbatim; the analog above is for confirming the sibling-config convention (same `testEnvironment`, same `setupFiles: ['<rootDir>/jest.setup.js']` reference) so the two configs stay consistent.

**Required edit to the existing file:** add `testPathIgnorePatterns: ['<rootDir>/__tests__/db/']` to `jest.config.js` (currently absent — no existing `!`-prefix exclusions per the file's own D-08 comment on line 16) so `npm test` never picks up the DB-test directory.

---

### `.github/workflows/tests.yml` (modify — D-14 CI must run DB tests)

**Analog:** itself, `test-middleware` job (lines 9-25).

```yaml
test-middleware:
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
    - uses: actions/setup-node@v4
      with:
        node-version: '20'
    - run: npm ci
      working-directory: zoho-middleware
    - run: npm test
      working-directory: zoho-middleware
```
Add a `- run: npm run test:db` step (working-directory `zoho-middleware`) either inside this same job (after `npm test`) or as a new job — `ubuntu-latest` ships Docker preinstalled (confirmed in RESEARCH.md's Environment Availability table), so no extra Docker setup step is needed. Per D-14, do **not** add any conditional/skip logic here — CI must fail outright if Docker is unavailable, unlike the local skip path.

---

### `railway.toml` (modify — D-03)

**Analog:** itself (full file, 6 lines).

```toml
[build]
buildCommand = "cd zoho-middleware && npm install --production"
watchPatterns = ["zoho-middleware/**"]

[deploy]
startCommand = "cd zoho-middleware && node server.js"
```
Add `preDeployCommand = "cd zoho-middleware && npx --no-install node-pg-migrate up"` to the existing `[deploy]` block (RESEARCH.md Pattern 2 gives this exact line, sourced from Railway's own docs). This file is pushed to both the staging and production repos via `gated-deploy.yml`'s force-push step (see that workflow's step "d", lines 131-156) — one edit here applies to both environments automatically, each resolving its own `DATABASE_URL`.

---

### `docs/RUNBOOK.md` (modify — D-15/D-16 provisioning checklist)

**Analog:** itself, "Human Prerequisites (one-time setup)" section (lines 212 onward).

```markdown
### PROD_DEPLOY_TOKEN

The gated-deploy workflow needs write access to `koa-inn/steins-and-vines-production`.

- [ ] Go to GitHub → Settings → Developer Settings → ...
- [ ] ...
```
Add a new subsection in this same style (`### Railway Postgres (staging + production)`) with checklist items for D-15 (provision both databases, link `DATABASE_URL` into each middleware service's Variables tab — confirm the literal name per RESEARCH.md Open Question 2) and D-16 (confirm backups/PITR enabled on both, record the confirmation date) — same `- [ ]` checkbox format, same "pitfall" callout convention (`> **Pitfall:** ...`) used elsewhere in this section.

## Shared Patterns

### Fail-fast / fail-closed on invalid or missing config
**Source:** `zoho-middleware/lib/validateEnv.js` lines 77-136 (full `validateEnv()` function)
**Apply to:** `lib/db.js` (DATABASE_URL required-in-prod via `validateEnv.js` itself), `lib/store-flag.js` (D-06 invalid-enum refuse-to-boot), `railway.toml`'s `preDeployCommand` (D-03: failing migration blocks deploy, handled by Railway itself, not app code)
```js
missing.forEach(function (v) {
  log.error('[startup] Missing required env var: ' + v.name + ' — ' + v.desc);
});
log.error('[startup] ' + missing.length + ' required env var(s) missing. Exiting.');
process.exit(1);
```

### Never-throw wrapper around a non-critical external call
**Source:** `zoho-middleware/lib/sentry-capture.js` (full file)
**Apply to:** `lib/dual-write-compare.js` (D-08), any Sentry-reporting call site in `lib/db.js` error paths
```js
function captureExceptionSafe(err, options) {
  try {
    return Sentry.captureException(err, options);
  } catch {
    return undefined;
  }
}
```

### Optional backing service — connect lazily, report status, never crash the app
**Source:** `zoho-middleware/lib/cache.js` (full file) + `zoho-middleware/lib/checkRedis.js` (full file)
**Apply to:** `lib/db.js` (`isConfigured()`/pool lifecycle), `server.js` `/health` (D-02 non-fatal `database` field, mirrors the existing `redis` field exactly)
```js
function isConnected() { return connected; }
```
```js
app.get('/health', function (req, res) {
  ...
  Promise.all([redisCheck, dbCheck]).then(function (results) {
    res.json({ status: 'ok', authenticated: ..., redis: results[0], database: results[1], uptime: process.uptime() });
  });
});
```

### Local CLI script — argv flags, preflight checks, per-row try/catch, summary + exit code
**Source:** `zoho-middleware/scripts/import-vessels.js` (full file) + `zoho-middleware/scripts/export-snapshot.js` (full file)
**Apply to:** `scripts/backfill/backfill.js`, `read-xlsx.js`, `normalize.js`, `rejects.js`
```js
var DRY_RUN = process.argv.includes('--dry-run');
if (!fs.existsSync(SOURCE_PATH)) { console.error('...'); process.exit(1); }
// per-row: try { ...; ok++; } catch (err) { errors.push({...}); }
// summary: console.log('Total: ' + n + '  OK: ' + ok + '  Errors: ' + errors.length);
```

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `migrations/0001_init.sql` | migration | batch (deploy-time DDL) | No prior SQL migration files exist in this repo (first use of `node-pg-migrate`); use RESEARCH.md's Pattern 2 skeleton (`-- Up Migration` / `-- Down Migration` comment markers) verbatim as the source of truth instead of an in-repo analog |
| `zoho-middleware/scripts/backfill/normalize.js` (the Trap 1-4c conversion logic specifically — money/timestamp/ID/null/bool/jsonb coercion rules) | transform | batch/transform | No existing code in this repo converts Sheets-shaped data into Postgres-typed values; the per-field mapping functions in `import-vessels.js` (`buildItemName`/`buildDescription`) are a *structural* analog only (per-field transform functions composed into a row), not a content analog — follow `.planning/notes/sheets-to-postgres-data-conversion.md` §2-3 for the actual trap-by-trap rules instead |

## Metadata

**Analog search scope:** `zoho-middleware/lib/`, `zoho-middleware/scripts/`, `zoho-middleware/__tests__/`, `zoho-middleware/server.js`, `zoho-middleware/jest.config.js`, `zoho-middleware/package.json`, `railway.toml`, `.gitignore`, `.github/workflows/tests.yml`, `.github/workflows/gated-deploy.yml`, `docs/RUNBOOK.md`
**Files scanned:** 15 read in full or targeted excerpt (validateEnv.js, sentry-capture.js, cache.js, checkRedis.js, server.js /health region, railway.toml, jest.config.js, package.json, .gitignore, tests.yml, gated-deploy.yml, cache.test.js, validateEnv.test.js, export-snapshot.js, import-vessels.js) plus directory listings of `zoho-middleware/scripts/` and `zoho-middleware/__tests__/`
**Pattern extraction date:** 2026-09-30
