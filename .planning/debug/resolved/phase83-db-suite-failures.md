---
status: resolved
trigger: "First real-Postgres run (npm run test:db): backfill runBackfill e2e 4 cases exitCode 1; db.test.js afterAll hook timeout at harnessPool.end()"
created: 2026-10-02T00:00:00Z
updated: 2026-10-02T17:45:00Z
---

## Current Focus

hypothesis: both confirmed and fixed (see Resolution)
test: full gates run
expecting: n/a
next_action: owner confirms; then archive session to resolved/

## Symptoms

expected: DB suite fully green (runBackfill exit 0/2 per case; db.test.js afterAll completes)
actual: 22 passed, 4 failed (all runBackfill file-based cases exitCode 1 incl. dryRun), db.test.js afterAll hook timeout 120000ms
errors: "Exceeded timeout of 120000 ms for a hook"; expect(result.exitCode).toBe(0) received 1
reproduction: cd zoho-middleware && npx jest -c jest.db.config.js (Node 20.20.2, Docker running)
started: first ever run of real-Postgres suite

## Eliminated

## Evidence

- timestamp: 2026-10-02T17:19Z
  checked: runBackfill dryRun via plain node and via a jest test WITHOUT jest.resetModules()
  found: both return exitCode 0
  implication: failure is specific to backfill.test.js environment, not the pipeline logic
- timestamp: 2026-10-02T17:21Z
  checked: instrumented runBackfill log + err.stack in the real DB test (dryRun case)
  found: "[1/6] Read snapshot" then TypeError Cannot read properties of undefined (reading 'objectMode') at exceljs/node_modules/readable-stream/lib/_stream_writable.js:290 from XLSX.load (xlsx.js:312 new PassThrough().write)
  implication: PassThrough constructed without _writableState
- timestamp: 2026-10-02T17:22Z
  checked: readable-stream 3.6.2 _stream_writable.js:232-246
  found: Writable() lazily does `Duplex = Duplex || require('./_stream_duplex')`; if `this instanceof Duplex` is false and not instanceof Writable it returns `new Writable()` leaving this._writableState unset. backfill.test.js calls jest.resetModules() in beforeAll AFTER exceljs was loaded (top-level require of backfill -> read-xlsx -> exceljs) but before any PassThrough was built, so the lazy require resolves a second _stream_duplex copy from the fresh registry.
  implication: module-registry split -> isDuplex false -> broken PassThrough -> readSheet rejects -> runBackfill exit 1
- timestamp: 2026-10-02T17:30Z
  checked: bug 1 fix (lazy require('exceljs') inside readSheet) -> backfill.test.js
  found: 16/16 pass; new unit regression read-xlsx-reset-modules.test.js RED before, GREEN after
  implication: bug 1 resolved
- timestamp: 2026-10-02T17:33Z
  checked: Jest 29.7 (circus) afterAll order via throwaway test
  found: afterAll hooks run in DECLARATION order (#1 then #2), contrary to db.test.js line 109-111 comment
  implication: db.test.js's pool.end() afterAll runs BEFORE rollbackEachTest's afterAll releases the client
- timestamp: 2026-10-02T17:34Z
  checked: pg-pool end() / _pulseQueue
  found: end callback only fires when this._clients is empty; checked-out client is never idle -> promise pending until the hook times out (120000ms)
  implication: deadlock between harness-held client and pool.end(); only consumer of rollbackEachTest is db.test.js

## Resolution

root_cause: (1) read-xlsx.js bound exceljs at module load; backfill.test.js's jest.resetModules() then made readable-stream's lazy require('./_stream_duplex') load a second copy, so exceljs's PassThrough got no _writableState and readFile rejected ('objectMode') -> runBackfill exit 1. (2) Jest-circus runs afterAll in declaration order, so db.test.js's harnessPool.end() ran while rollbackEachTest still held its client; pg-pool end() waits for all clients -> hook timeout.
fix: (1) require('exceljs') inside readSheet (commit 089575cd). (2) rollbackEachTest checks out+BEGIN per test in beforeEach, ROLLBACK+release in afterEach (commit 2363caa0).
verification: DB suite 26/26 (3 suites, 0 skipped); middleware 1885/1885 (127 suites) + lint; frontend 2048/2048 (141 suites) + lint; both new regression tests RED before fix, GREEN after.
files_changed: [zoho-middleware/scripts/backfill/read-xlsx.js, zoho-middleware/__tests__/backfill/read-xlsx-reset-modules.test.js, zoho-middleware/__tests__/db/helpers/pg-harness.js, zoho-middleware/__tests__/db-harness-rollback.test.js]
