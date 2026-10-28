---
phase: 94
slug: dashboard-correctness-and-data-foundations
status: verified
threats_total: 52
threats_open: 0
register_authored_at_plan_time: true
asvs_level: 1
created: 2026-10-28
---

# Phase 94 - Security

> Per-phase security contract: threat register, accepted risks, and audit trail.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| BrewPad browser -> `/api/batch/admin-proxy` | Staff PIN/session tiers (`legacy`,`session`); device tier rejected | batch type edits, dashboard aggregate (PII-free) |
| Middleware -> Postgres | Constant parameterised SQL; `batch_type` enum gate in app code | batch rows, type/completion source markers |
| Operator CLI -> production Postgres / Apps Script sheet | Env-only DB URL; dry-run + `--expect` gate; production-only replay | batch ids, SKUs, counts |
| Staging vs production shared workbook | Staging never mirrors; replay refuses outside production | batch state rows |

---

## Threat Register

| Threat ID | Category | Component | Disposition | Mitigation / Evidence | Status |
|-----------|----------|-----------|-------------|-----------------------|--------|
| T-94-01 | Tampering | batch-type-hints SQL | mitigate | Constant SQL, `$1` only: zoho-middleware/lib/batch-type-hints.js:17-18, 57, 70 | closed |
| T-94-02 | DoS | zohoTypeHint during create | mitigate | try/catch -> null: zoho-middleware/lib/batch-type-hints.js:25-33; create-path test batch-store-create-type passes | closed |
| T-94-03 | Tampering | enum values | mitigate | `normalizeBatchType` allowlist: zoho-middleware/lib/batch-rules.js:904-909; no DB CHECK per 0007 header | closed |
| T-94-04 | Info disclosure | hint logging | mitigate | Only warn is `'[batch-type-hints] kiosk cache read failed'`, no payload: zoho-middleware/lib/batch-type-hints.js:30 | closed |
| T-94-05 | Tampering | migration 0007 | mitigate | Additive nullable `add column` only: zoho-middleware/migrations/0007_batch_type.sql:11-16; applied on prod via guard (rollout log, Production release) | closed |
| T-94-06 | Tampering (figures) | getDashboardData | mitigate | Invariant + clock-independence suites: tests/frontend/brewpad-dashboard-data.test.js:261, 289 (passing) | closed |
| T-94-07 | Info disclosure | helpers | accept | Accepted: pure functions, no I/O (see Accepted Risks Log) | closed |
| T-94-08 | Tampering | createBatch batch_type | mitigate | Honoured only for source manual/internal, normalized, stored 'manual': zoho-middleware/lib/batch-pg-create.js:174-181; source coerced to manual/internal in zoho-middleware/routes/pos.js:4283-4288 | closed |
| T-94-09 | Spoofing | batch_type_source | mitigate | Server-computed in resolveBatchType (zoho-middleware/lib/batch-pg-create.js:174-195); no payload field read | closed |
| T-94-10 | DoS | create latency | mitigate | Hint is Redis-only with catch->null; no Zoho call: zoho-middleware/lib/batch-type-hints.js:23-33 | closed |
| T-94-11 | Tampering | SQL (create) | mitigate | INSERT constant with `$29,$30`: zoho-middleware/lib/batch-pg-create.js:54-62 | closed |
| T-94-12 | Tampering | source forgery | mitigate | Sources not read from updates; `trusted` set only by backfill CLIs; absent from batch-store `writeOpts` (zoho-middleware/lib/batch-store.js:106-112), batch-proxy, routes (grep: zero hits). Test batch-store-trusted passes | closed |
| T-94-13 | Tampering | invalid batch_type | mitigate | invalid_input before any write: zoho-middleware/lib/batch-pg-update.js:333-336 | closed |
| T-94-14 | Tampering | backfill overwriting staff data | mitigate | manual_locked, weak-source and expectedTypeSource re-check under row lock: zoho-middleware/lib/batch-pg-update.js:345-357 (WR-04); already_set at :360-366 | closed |
| T-94-15 | Repudiation | who changed a type | mitigate | `last_updated` always bumped (zoho-middleware/lib/batch-pg-update.js:448), source marker 'manual' vs automatic (:444-445), actor passed | closed |
| T-94-16 | Tampering | SQL (update) | mitigate | Constant `TYPE_SET_SQL` (zoho-middleware/lib/batch-pg-update.js:63); `addSet` called with fixed column names only (:428-448) | closed |
| T-94-17 | Info disclosure | aggregate payload | mitigate | Explicit column whitelist, no customer_*/access_token/notes/snapshot: zoho-middleware/lib/batch-pg-read.js:75-92; test batch-dash-stats-route passes | closed |
| T-94-18 | EoP | action reachability | mitigate | Allowlisted only in BrewPad proxy behind `requireTiers(['legacy','session'])` (zoho-middleware/routes/pos.js:4300, 4338, 4346); `/api/admin/proxy` allowlist lacks it (:4393-4433, invalid_action at :4433) | closed |
| T-94-19 | Tampering | SQL (stats) | mitigate | Constant SQL, only `$1` timezone bound, no client filters: zoho-middleware/lib/batch-pg-read.js:75-100, 263-271 | closed |
| T-94-20 | Info disclosure | memo across tiers | mitigate | Memo is in-process, reached only through intercept() behind the tier check (zoho-middleware/lib/batch-proxy.js:52-73); PII-free whitelist payload | closed |
| T-94-21 | Integrity | memo staleness | mitigate | `finish()` clears memo + bumps generation on every ok write (zoho-middleware/lib/batch-store.js:75-78); 60 s TTL (:30, :156); WR-03 gen guard (:159, :178); race test passes | closed |
| T-94-22 | Info disclosure | error responses | mitigate | Catch collapses to 502 `{ok:false,error:'server_error'}`; message logged only: zoho-middleware/lib/batch-proxy.js:90-93 | closed |
| T-94-23 | Tampering | unreviewed prod write | mitigate | Dry-run default; `--apply` requires `--expect`, mismatch exits 3: zoho-middleware/scripts/backfill/batch-type-backfill.js:55-72, 237-243; completed-at-backfill.js:49-65, 143-149. Owner OKs quoted in 94-ROLLOUT-LOG.md (B3 apply, B2 apply) | closed |
| T-94-24 | Info disclosure | DB credentials | mitigate | Argv URLs rejected (`POSTGRES_URL_RE`), env `BACKFILL_DATABASE_URL` only: batch-type-backfill.js:46-49, 290; same in completed-at-backfill.js, batch-cycle-recompute.js:59, batches-replay-to-sheet.js:48 | closed |
| T-94-25 | Info disclosure | CLI output | mitigate | Logs ids/rules/SKUs/counts; name only under `--with-names` (batch-type-backfill.js:210-212); no customer_* column in any CLI SQL | closed |
| T-94-26 | Tampering | overwriting staff data | mitigate | Manual rows planned as skip-manual (batch-type-backfill.js:101-104) and re-checked under lock; completed_at `already_set` skip (completed-at-backfill.js:174) | closed |
| T-94-27 | Tampering | SQL (CLIs) | mitigate | Constant SQL; writes only via `pgUpdate.updateBatch` (batch-type-backfill.js:133-137; completed-at-backfill.js:81-85) | closed |
| T-94-28 | Integrity | sheet drift after prod apply | mitigate | `logNext` prints replay+verify step on production; executed per rollout log: B3 replay 215/215 then verify 0 mismatches (23:28Z), B2 replay 40/40 then verify 0 mismatches (01:33Z). Deviation reviewed: one-off driver wrapped the same `runBatchesReplay` (identical payloads/order), with longer timeout and skipping only ids already sent in runs 1-2 (SV-B-000001..037), and independent verify against fresh owner snapshots proved convergence. Mitigation holds. | closed |
| T-94-29 | Tampering (XSS) | renderDashboard | mitigate | `escapeHTML` on every interpolated string (js/brewpad.js:4642-4643, 6706, 6712); remaining unescaped interpolations are numerics/constants; XSS fixture test brewpad-dashboard-render.test.js:241-246 passes | closed |
| T-94-30 | Integrity | totals disagree | mitigate | Chart legend and wine breakdown derive from shared data layer (js/brewpad.js:4580-4599); D-13 production check PASS (rollout log) | closed |
| T-94-31 | Info disclosure | client state | accept | Accepted: PII-free in-memory aggregate behind PIN/session gate (see log) | closed |
| T-94-32 | Availability | aggregate failure | mitigate | Fallback to `get_batch_dashboard_summary` + `toDashRows` on failure: js/brewpad.js diff (`adminApiGet('get_dashboard_stats').then(..., fallback)`); error copy rendered escaped | closed |
| T-94-33 | Tampering | select value | mitigate | Server enum check + stamps 'manual' (zoho-middleware/lib/batch-pg-update.js:333-343); client offers five constant values | closed |
| T-94-34 | Spoofing | who may edit | mitigate | No new endpoint; BrewPad proxy `requireTiers(['legacy','session'])` (zoho-middleware/routes/pos.js:4346) | closed |
| T-94-35 | Tampering (XSS) | Type row / hint | mitigate | `escapeHTML(typeLabel)`, `escapeHTML(typeInfo.hint)` (js/brewpad.js:6706, 6712); `<img onerror>` test brewpad-batch-type-ui.test.js:211 passes | closed |
| T-94-36 | Integrity | stale detail snapshot | mitigate | `afterBatchWrite` removes `sv-bp-batch-<id>`, resets list/dash timers, refetches open detail (js/brewpad.js:3110-3146); setBatchType calls it with batch_id (diff); test brewpad-after-batch-write passes | closed |
| T-94-37 | Tampering | staging writes | mitigate | Owner approval 'yes, apply both on staging'; `--expect=215`/`--expect=40` matched dry-run counts (rollout log, Staging applies) | closed |
| T-94-38 | Info disclosure | dry-run output | mitigate | Lists written to `~/sv-backfill/` outside repo; rollout log holds ids/counts only | closed |
| T-94-39 | Info disclosure | secrets | mitigate | CLIs read `BACKFILL_DATABASE_URL` from env only; no URL echoed in any log call; rollout log contains no credentials | closed |
| T-94-40 | Tampering | prod change w/o approval | mitigate | Pre-deploy was read-only; owner approval of exact SHA: 'release 141901a7 now' (rollout log, Production pre-deploy) | closed |
| T-94-41 | DoS | migration order | mitigate | 0006 presence verified before 0007; rollback target 90dfb9c1 recorded (rollout log, Production pre-deploy) | closed |
| T-94-42 | Tampering | wrong code to prod | mitigate | `git push production 141901a7:main` exactly the approved SHA, tagged prod-20261027-1 (rollout log, Production release) | closed |
| T-94-43 | Tampering | prod data writes | mitigate | Owner OK 'signed in, yes apply with expect=215'; `--expect` gate; manual rows locked; apply wrote 215/0 skipped. Replay driver deviation (see T-94-28) does not touch the Postgres write path. Holds. | closed |
| T-94-44 | Repudiation | data change trail | mitigate | 87-CUTOVER-LOG.md 'SQL fixes' rows (lines 187-188) with counts/timestamps; 94-ROLLOUT-LOG.md | closed |
| T-94-45 | Info disclosure | output | mitigate | Full lists in `~/sv-backfill/`, outside repo; rollout log ids/counts only | closed |
| T-94-46 | Tampering | prod completed_at writes | mitigate | Owner OK 'yes apply with expect=40'; `--expect` gate; `already_set` never overwrites (zoho-middleware/lib/batch-pg-update.js:360-366) | closed |
| T-94-47 | Integrity | misleading dates | mitigate | Trusted channel stamps `backfill-task` (zoho-middleware/lib/batch-pg-update.js:411); late-tick caveat printed by CLI (completed-at-backfill.js:178) and logged | closed |
| T-94-48 | Repudiation | audit trail | mitigate | 87-CUTOVER-LOG.md SQL fixes row 2026-10-27 23:30Z; rollout log B2 section | closed |
| T-94-49 | Tampering/Info disclosure | staging into shared workbook | mitigate | `assertProductionEnvironment()` runs first in main(), before pool/HTTP, no override (zoho-middleware/scripts/backfill/batches-replay-to-sheet.js:200-222); gate is NODE_ENV + RAILWAY_ENVIRONMENT_NAME (zoho-middleware/lib/sheet-mirror.js:42-45); spawn test batches-replay-staging-guard passes; backfill CLIs print no-replay note on staging | closed |
| T-94-50 | Info disclosure | DB credentials (recompute) | mitigate | Argv URL refused, env only: zoho-middleware/scripts/backfill/batch-cycle-recompute.js:59, test batch-cycle-recompute passes | closed |
| T-94-51 | Tampering | recompute | mitigate | `begin transaction read only` (zoho-middleware/scripts/backfill/batch-cycle-recompute.js:88), constant SQL, bound `$1` year | closed |
| T-94-52 | Tampering | operator replay from staging | mitigate | docs/RUNBOOK.md:1544-1545 forbids explicitly; replay guard refuses (T-94-49) | closed |

*Status: open · closed*
*Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party)*

Result: 52/52 closed (50 mitigate verified in current code on main or in rollout evidence, 2 accept documented). No unregistered flags: 94-08-SUMMARY.md `## Threat Flags` is "None".

Verification run: 10 middleware suites (69 tests) and 3 frontend suites (43 tests) covering trusted-channel, dash-stats route, memo race, hints, replay staging guard, backfill plans, recompute, XSS fixtures: all pass.

Informational (not a Phase 94 threat): the production `npm audit` step failed on body-parser GHSA-27r3-jxmh-p828 (rollout log); needs a separate dependency-patch change.

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-94-01 | T-94-07 | Helpers are pure functions with no I/O or storage; escaping is handled at render (plan 07) | plan 94-02 threat model | 2026-10-28 |
| AR-94-02 | T-94-31 | `_dashData` holds only the PII-free aggregate, in memory, behind the BrewPad PIN/session gate | plan 94-07 threat model | 2026-10-28 |

*Also noted within T-94-21: multi-instance memo staleness is bounded to 60 s and accepted by the plan.*

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-10-28 | 52 | 52 | 0 | gsd-security-auditor (Claude) |

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-10-28
