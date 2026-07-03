# Phase 53: Money-Path Observability & CI Gates - Context

**Gathered:** 2026-07-03
**Status:** Ready for planning

<domain>
## Phase Boundary

Add observability + CI enforcement that protect the money path hardened in Phases 47–52 from silently regressing. Two halves:
1. **Observability (M17):** every money-path failure emits a tagged, PII-scrubbed Sentry event.
2. **CI/build gates (L1/L2/L12/L13):** `npm ci` + pinned Node, a real lint gate (`--max-warnings 0` + ES5 enforcement on the frontend), and a per-file coverage floor on `pos.js`.

**No new product features.** This is instrumentation + tooling only. Requirements and the 4 success criteria are fixed by ROADMAP.md (OBS-01); this phase decides only *how* to implement them.
</domain>

<decisions>
## Implementation Decisions

### Sentry Money-Path Observability (M17)
- **D-01:** Instrument **only money-movement catch blocks** with `Sentry.captureException` — terminal charge, void, captured-amount verification, `customerpayment` recording, and gift-card money movement. Do **not** instrument best-effort catches (`cache.del`, logging, list-refresh, snapshot busting). The money-movement primitives in `lib/money-path.js` define the boundary. Candidate files: `routes/checkout.js`, `routes/pos.js`, `routes/webhooks.js`, `lib/money-path.js`.
- **D-02:** Add a lightweight **request-id middleware** so every request has a `reqId`; tag each captured event with `reqId` + `txnId` + the invoice/salesorder id where available. (Chosen over reusing `idempotency_key`, which is absent on non-idempotent paths.)
- **D-03:** **PII scrub via a global `beforeSend`** in `server.js` — strip customer emails and any PII before send; only safe correlation ids (`reqId`, `txnId`, invoice/SO id) go in tags. No raw amounts or emails in tags/messages.
- **D-04:** **Fingerprint by error class/type** so a failure burst groups into one Sentry issue. Capture **level = error** uniformly (not `fatal`) — void/orphan-charge failures already page staff via `sendVoidFailureAlert`, so `error` is sufficient.

### CI Enforcement — Lint Gate (L12)
- **D-05:** **Clear all 60 existing eslint warnings first** (its own commit), then enable **`--max-warnings 0`** on **both** frontend (`eslint js/`) and middleware (`eslint routes/ lib/ server.js`). CI must genuinely fail on any new warning.
- **D-06:** The **ES5-only rule targets frontend `js/` ONLY** (it ships ES5 to browsers). Middleware stays `ecmaVersion: 2020` (legitimately uses `await`/`const`). Mechanism (eslint `ecmaVersion: 5` vs a `no-restricted-syntax` ban on ES6 constructs) is planner/researcher's call. **Risk to check:** frontend eslint is currently `ecmaVersion: 2020`, so existing ES6 in `js/` may surface as violations that need cleanup before the rule can pass.

### CI Enforcement — npm ci + Node pin (L1/L2)
- **D-07:** **Commit `package-lock.json` for both root and `zoho-middleware/`** (middleware lockfile is currently untracked — 52-01 hit this). This pins exact dependency versions and is the prerequisite for `npm ci`.
- **D-08:** Switch **CI (`tests.yml`) and Railway** install from `npm install` → **`npm ci`** in every working directory (root + middleware).
- **D-09:** **Pin Node 20** (matches current CI `node-version: '20'`) via a `package.json` `engines` field **and** `.nvmrc`, in both root and middleware. No runtime version bump.

### CI Enforcement — Coverage Floor (L13)
- **D-10:** Add a per-file coverage floor for `routes/pos.js` to `zoho-middleware/jest.config.js`, **calibrated just below measured** (~81% lines observed → floor ≈ 80), following the existing D-06 pattern (per-file floors just under actual with ~1pt headroom). Confirm the measured number at implementation time.

### Claude's Discretion
- Exact eslint ES5 mechanism (parser `ecmaVersion` vs `no-restricted-syntax`).
- Request-id middleware: hand-rolled vs a tiny lib.
- Sentry fingerprint key composition.
- Exact `pos.js` floor number (calibrate to the measured value at build time).
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Audit findings (source of truth for scope)
- `AUDIT-2026-06-29.md` — the findings this phase closes: **M17** (Sentry on money-path catches), **L1/L2** (`npm ci` + Node pin), **L12** (lint gate), **L13** (`pos.js` coverage floor). ⚠ This doc is gitignored and not served (Phase 47) — it exists locally only.

### Roadmap / requirements
- `.planning/ROADMAP.md` § "Phase 53: Money-Path Observability & CI Gates" — goal + the 4 locked success criteria.
- `.planning/REQUIREMENTS.md` — **OBS-01** (maps M17/L1/L2/L12/L13).

### Existing code/patterns to follow
- `zoho-middleware/jest.config.js` — existing per-file coverage-floor pattern ("just below measured", D-06) to extend for `pos.js`.
- `zoho-middleware/server.js` (lines ~8–30 Sentry.init; ~588 `setupExpressErrorHandler`) — Sentry already initialized (DSN-gated, `tracesSampleRate: 0.1`); add `beforeSend` + fingerprinting here.
- `zoho-middleware/lib/money-path.js` — shared money-movement primitives; defines the M17 catch boundary.
- `zoho-middleware/lib/validateEnv.js` — already requires `SENTRY_DSN` in prod.
- `.github/workflows/tests.yml` — CI jobs to update (npm install→ci; add `--max-warnings 0`; Node pin). Separate root + middleware `working-directory` jobs — both need the change.
- `docs/RUNBOOK.md` — Railway deploy mechanics; the `npm ci` change affects Railway's install step.
</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **Sentry is already wired** (`server.js` init + Express error handler; `validateEnv` requires DSN in prod) — M17 is *adding `captureException` at money-movement call sites* + a `beforeSend`/fingerprint config, not standing Sentry up from scratch.
- **`lib/logger.js`** — money-path catches already log; Sentry capture sits alongside existing log calls.
- **`jest.config.js` per-file floors** — direct template for the `pos.js` floor (L13).

### Established Patterns
- Coverage floors set "just below measured" with ~1pt headroom (D-06).
- **ES5 frontend / ES2020 middleware split** (CLAUDE.md) — the reason the L12 ES5 rule is frontend-scoped.
- No `reqId` correlation exists today; `idempotency_key` exists only on some paths.

### Integration Points
- A single global `beforeSend` in `server.js` covers every `captureException` call — one scrub function, applied everywhere.
- `tests.yml` has distinct root + middleware jobs — both the `npm ci` swap and the lint gate must land in each.
- The `npm ci` change touches Railway's install path too (not just CI).
</code_context>

<specifics>
## Specific Ideas

- User confirmed void/orphan-charge failures stay `level=error` (not `fatal`) — they already page via the `sendVoidFailureAlert` staff email, so no double-escalation.
- Lint cleanup of the 60 warnings should be its own commit, separate from turning the gate on, so the gate flip is a clean diff.
</specifics>

<deferred>
## Deferred Ideas

- **BL-M22** (dual-cart overcharge → durable manual-review record on void-skip) — the audit notes it's "best done with OBS-01", but it's a v2 backlog item, not in OBS-01 scope. Revisit via `/gsd-review-backlog`.
- Extending Sentry `captureException` to non-money-path catches — deliberately out of scope; M17 is money-path only.
</deferred>
