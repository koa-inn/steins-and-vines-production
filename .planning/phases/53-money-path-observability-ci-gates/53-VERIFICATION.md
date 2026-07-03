---
phase: 53-money-path-observability-ci-gates
verified: 2026-07-03T17:26:10Z
status: passed
score: 9/9 must-haves verified
overrides_applied: 0
---

# Phase 53: Money-Path Observability & CI Gates Verification Report

**Phase Goal:** Every money-path failure emits a tagged Sentry event, and CI enforces the lint/coverage/dependency gates that keep the hardened money path from silently regressing.
**Verified:** 2026-07-03T17:26:10Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Every money-path `catch` block calls `Sentry.captureException` tagged with `reqId`/`txnId`/invoice-or-SO id (ROADMAP SC#1) | VERIFIED | `grep -n captureException lib/money-path.js routes/checkout.js routes/pos.js routes/webhooks.js` → 14 call sites across all 4 files; every call's `tags` object carries `reqId`/`txnId`/`invoiceId`/`salesOrderId`/`invoiceNumber`, `level: 'error'` (never `'fatal'`), no `amount`/`total`/`email` key. |
| 2 | A forced money-path error produces a visible, PII-scrubbed Sentry event | VERIFIED | `npx jest sentry-beforeSend money-path-sentry --runInBand` → 2 suites / 8 tests pass. `sentry-beforeSend.test.js` seeds a raw email + amount in `user.email`/`tags`/`extra`/`request.data` and in `exception.values[0].value` ("charge failed for jacob@gmail.com: total=$45.50...") and asserts both are stripped/masked before send. |
| 3 | Global `beforeSend` PII scrub (`lib/sentry-scrub.js`) is wired into `server.js`'s `Sentry.init` | VERIFIED | `server.js:12-21`: `Sentry.init({..., beforeSend: function(event){ event = scrub.scrubEvent(event); event.fingerprint = scrub.fingerprintFor(event); return event; }})`, DSN-gated as before. |
| 4 | CR-01 code-review blocker (scrub did not cover exception messages / breadcrumbs) is actually fixed | VERIFIED | `lib/sentry-scrub.js` contains `scrubString()` applied to `event.exception.values[].value` (lines ~104-112) and to `event.breadcrumbs[].message`/`.data` (lines ~114-121). Confirmed via commit `21656e2` ("fix(53): scrub exception messages + breadcrumbs in Sentry beforeSend (CR-01)") and `53-REVIEW.md`'s CR-01 entry marked `RESOLVED (commit 21656e2)`. New regression test in `sentry-beforeSend.test.js` ("scrubs raw email and amount from the exception message") passes live. |
| 5 | `npm run lint` fails on ANY warning in both workspaces (`--max-warnings 0`) | VERIFIED | `package.json:23` → `"lint": "eslint js/ --max-warnings 0"`; `zoho-middleware/package.json:12` → `"lint": "eslint routes/ lib/ server.js --max-warnings 0"`. Live run: both `npm run lint` (root) and `cd zoho-middleware && npm run lint` exit 0. Negative check: appending `const zzz = 1;` to a `js/` module makes root lint fail with a parse error (reverted after check, working tree clean). |
| 6 | Frontend `js/` eslint block enforces `ecmaVersion: 5`; middleware stays `ecmaVersion: 2020` | VERIFIED | `grep ecmaVersion eslint.config.js zoho-middleware/eslint.config.js` → root `ecmaVersion: 5`, middleware `ecmaVersion: 2020`. Live negative check confirms ES6 `const` triggers a hard parse error under the root config. |
| 7 | `npm ci` used in CI (not `npm install`); Node 20 pinned via `engines` + `.nvmrc` in both workspaces; both `package-lock.json` committed | VERIFIED | `.github/workflows/tests.yml` → 3× `run: npm ci`, 0 remaining `npm install`. `package.json`/`zoho-middleware/package.json` both contain `"engines": {"node": "20.x"}`. `.nvmrc` and `zoho-middleware/.nvmrc` both contain `20`. `git ls-files package-lock.json zoho-middleware/package-lock.json` lists both (tracked). `npm ci --dry-run` and `cd zoho-middleware && npm ci --dry-run` both exit 0 against the committed lockfiles. |
| 8 | `pos.js` per-file coverage floor present in `jest.config.js`, set just below measured coverage | VERIFIED | `zoho-middleware/jest.config.js:25` → `'./routes/pos.js': { lines: 80 }` with comment "D-10: measured 81.08% — floor set at 80, ~1pt headroom." Live full-suite run (`npm test`) shows `routes/pos.js` line coverage at 81.11% — above the 80 floor, no threshold failure reported, floor is genuinely calibrated (not slack). |
| 9 | Best-effort catches (cache/mailer/list-refresh housekeeping) are NOT instrumented with `captureException` | VERIFIED | Manual grep of all 14 `captureException` call sites shows every binding is a genuine money-movement error variable (`vErr`, `voidErr`, `captureReadErr`, `payErr`, `err`) at void/order-creation/customerpayment/reconcile sites — none bound to a best-effort catch name (`cacheErr`/`batchErr`/`mailErr`/etc., per 53-02's own negative-check convention). |

**Score:** 9/9 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `zoho-middleware/lib/sentry-scrub.js` | `scrubEvent`/`fingerprintFor`, scrubs tags/extra/contexts/request + exception message + breadcrumbs | VERIFIED | Exists, exports both functions, CR-01 fix present, all 8 unit tests pass |
| `zoho-middleware/server.js` | `beforeSend` wired into `Sentry.init` | VERIFIED | Lines 12-21, DSN-gated, calls `scrub.scrubEvent` + sets `event.fingerprint` |
| `zoho-middleware/__tests__/sentry-beforeSend.test.js` | Regression proof of PII scrub incl. CR-01 | VERIFIED | 5 tests (email/amount/request strip, safe-id preserve, fingerprint grouping, exception-message scrub), all pass |
| `zoho-middleware/lib/money-path.js` | `captureException` in void primitives | VERIFIED | 3 call sites (rejectWithVoid + voidWithTimeout ×2), tagged reqId/txnId/phase |
| `zoho-middleware/routes/checkout.js` | `captureException` at money-movement catches | VERIFIED | 9 call sites, tagged reqId/txnId/invoiceId |
| `zoho-middleware/routes/pos.js` | `captureException` at sale/confirm catch | VERIFIED | 1 call site, tagged reqId/txnId/salesOrderId |
| `zoho-middleware/routes/webhooks.js` | `captureException` at reconcile catch | VERIFIED | 1 call site, tagged txnId/invoiceNumber |
| `zoho-middleware/__tests__/money-path-sentry.test.js` | Forced-error capture regression | VERIFIED | 2 tests pass (CRITICAL + timeout void branches) |
| `.github/workflows/tests.yml` | `npm ci` in all install steps | VERIFIED | 3/3 steps use `npm ci`, 0 `npm install` |
| `.nvmrc`, `zoho-middleware/.nvmrc` | Node 20 pin | VERIFIED | Both contain `20` |
| `package.json`, `zoho-middleware/package.json` | `engines.node`, `--max-warnings 0` | VERIFIED | Both present |
| `package-lock.json`, `zoho-middleware/package-lock.json` | Committed lockfiles | VERIFIED | Both tracked in git, `npm ci --dry-run` succeeds against each |
| `zoho-middleware/jest.config.js` | `pos.js` coverage floor | VERIFIED | `'./routes/pos.js': { lines: 80 }`, measured 81.11%, ~1pt headroom |
| `eslint.config.js` | Root `js/` block `ecmaVersion: 5` | VERIFIED | Confirmed, middleware config untouched at 2020 |
| `docs/RUNBOOK.md` | Documents Railway `npm ci` auto-detect side effect | VERIFIED | Note present under Overview/deploy section |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `server.js Sentry.init` | `lib/sentry-scrub.js scrubEvent` | `beforeSend` callback | WIRED | Confirmed live in server.js:15-19 |
| `routes/*.js money-path catch` | `@sentry/node captureException` | Direct call with tags | WIRED | 14 call sites confirmed, all tagged correctly |
| `routes/checkout.js` + `routes/pos.js` void calls | `lib/money-path.js voidWithTimeout`/`rejectWithVoid` | `reqId` in deps object | WIRED | `grep 'reqId: req.id'` present in both files' deps objects passed to money-path primitives |
| `.github/workflows/tests.yml install steps` | `npm ci` | `run: npm ci` | WIRED | 3/3 occurrences, 0 `npm install` remaining |
| Committed `zoho-middleware/package-lock.json` | Railway Nixpacks auto-detect | Lockfile presence | WIRED (by design/doc) | Lockfile committed; documented in RUNBOOK.md; not independently testable outside Railway |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Forced money-path void failure captures to Sentry w/ correct tags | `npx jest money-path-sentry --runInBand` | 2/2 tests pass | PASS |
| Seeded PII (email/amount) stripped before send, incl. exception message | `npx jest sentry-beforeSend --runInBand` | 5/5 tests pass (includes CR-01 regression) | PASS |
| Full middleware suite green after all phase changes | `cd zoho-middleware && npm test` | 76 suites / 1247 tests pass, no coverage-threshold failures | PASS |
| Both lint gates pass today | `npm run lint` (root) / `cd zoho-middleware && npm run lint` | Both exit 0 | PASS |
| Lint gate actually fails on a new warning/ES6 syntax (negative check) | Injected `const zzz = 1;` into `js/modules/13-init.js`, ran `npm run lint`, reverted | Parse error, non-zero-equivalent failure output (1 problem, 1 error) | PASS |
| `npm ci` succeeds against committed lockfiles in both workspaces | `npm ci --dry-run` (root and `zoho-middleware`) | Both exit 0 | PASS |
| `pos.js` coverage floor calibrated below measured | `npx jest --coverage --collectCoverageFrom='routes/pos.js'` | Lines 81.11% vs floor 80 | PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| OBS-01 | 53-01 through 53-06 (all 6 plans declare it) | Money-path observability + CI enforcement (M17/L1/L2/L12/L13) | SATISFIED | All 4 ROADMAP success criteria independently verified above; REQUIREMENTS.md traceability table (line 86) still shows "Pending" and the v1 checklist checkbox is unchecked — this is expected pre-close bookkeeping (compare Phase 52/RESIL-01, which was flipped to `[x]`/"Complete" in a separate `docs(phase-N): complete phase execution` commit made after verification, not during execution). Not a code gap; flagged below for the phase-close step, not a BLOCKER. |

**Orphaned requirements:** None — OBS-01 is the only requirement mapped to Phase 53 and is claimed by all 6 plans.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| — | — | No `TBD`/`FIXME`/`XXX` debt markers, no `TODO`/`HACK`/`PLACEHOLDER` in any phase-touched file | — | None found (one `XXX` grep hit in `pos.js:2294` is `INV-XXXXX`, a comment placeholder pattern for an invoice-number example, not a debt marker) |

**Non-blocking code-review items (from 53-REVIEW.md, all classified WARNING/INFO, not CRITICAL):**
- WR-01: `captureException` runs before void-on-failure logic in checkout.js/pos.js catch blocks — low-probability ordering risk, not a functional gap.
- WR-02: `fingerprintFor` collapses all generic `Error`-typed money-path failures into one Sentry issue (grouping is coarser than ideal) — an observability-quality concern, not a goal-blocking defect; SC#1 ("a forced money-path error produces a visible Sentry event") is still met since the event is captured, tagged, and delivered.
- WR-03: `event.request.url`/`query_string` not scrubbed and `scrubMap` is non-recursive (one level deep) — a residual PII-scrub hardening gap beyond what CR-01 required; the phase's stated must-have ("PII-scrubbed") is met for the documented/tested leak vectors (email, amount, exception message, breadcrumbs); this WR-03 gap was known to the reviewer and not raised to CRITICAL.
- IN-01/IN-02: informational notes, no action required.

These were left unresolved by design — the REVIEW.md's `status: issues_found_1_critical_resolved` frontmatter confirms only the 1 CRITICAL (CR-01) blocked closure; WARNING items are recorded as known residual risk, not phase must-haves.

### Human Verification Required

None. All must-haves for this phase are code/config-level and independently verifiable via grep, unit tests, and live command execution (lint, `npm ci --dry-run`, coverage run). The plan's own `<verification>` sections note a DSN-live Sentry-dashboard smoke test as "optional, owner" and "not required for CI" — consistent with treating it as out of scope for automated/goal-backward verification.

### Gaps Summary

No blocking gaps. All 4 ROADMAP Phase 53 success criteria and all `must_haves` truths/artifacts/key_links declared across the 6 plan frontmatters are verified present and functioning in the live codebase (not just claimed in SUMMARY.md). The one CRITICAL finding from code review (CR-01 — scrub not covering exception messages/breadcrumbs) was independently confirmed fixed via commit `21656e2`, with a passing regression test. Three WARNING-level code-review items (WR-01/02/03) remain open as documented residual risk but do not block the phase goal — they represent room for future hardening (capture-call ordering, finer-grained fingerprinting, deeper scrub recursion), not a failure to deliver "every money-path catch instrumented" or "PII-scrubbed" as scoped by this phase's must-haves.

The only non-code item noted is that `.planning/REQUIREMENTS.md`'s OBS-01 row/checkbox has not yet been flipped to done — this follows the same pattern as Phase 52 (RESIL-01), where that update lands in a dedicated "complete phase execution" commit after verification, not before. No action needed from this verification pass.

---

_Verified: 2026-07-03T17:26:10Z_
_Verifier: Claude (gsd-verifier)_
