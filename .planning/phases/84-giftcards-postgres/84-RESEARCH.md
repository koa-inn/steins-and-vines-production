# Phase 84: GiftCards → Postgres - Research

**Researched:** 2026-10-03
**Domain:** Atomic money-ledger migration (Google Sheets/Apps Script → Postgres) for a single
money-of-record table, with a dual-write verification window and a kiosk-native balance-adjust
control.
**Confidence:** HIGH (code-verified against the actual middleware, Apps Script, and kiosk source;
Phase 83 infra independently re-verified; one locked-decision conflict found and resolved below)

## Summary

This phase is well-scoped and almost entirely de-risked by Phase 83, which already shipped
`lib/db.js`, `lib/store-flag.js`, `lib/sheet-mirror.js`, `lib/dual-write-compare.js`, a
`node-pg-migrate`-driven additive-only migration pipeline with a parser-backed guard, a
Testcontainers Jest harness pinned to `postgres:18-alpine` (matching Railway's real PG 18.6), and a
spec-driven backfill pipeline (`scripts/backfill/`) explicitly built to be extended by "Phases
84-87." Phase 84's job is almost pure application: add the `gift_cards` + `gift_card_transactions`
migration, build a small store-facade module that both `routes/gift-cards.js` and
`routes/pos.js`'s 6 Apps-Script call sites go through, write the gift-card-specific backfill spec,
wire the dual-write re-run + compare, and add a new kiosk balance-adjust endpoint + UI extending
the existing Phase 54 Gift Card Management panel.

**The single most important finding in this research is a conflict between the locked
`tx_ref UNIQUE` decision and real production code behaviour**, discovered by reading
`routes/pos.js`'s confirm chain directly: the sale confirm handler reuses **one shared
`refNumber`** as `transaction_ref` across potentially multiple *different* gift-card operations
in the same sale (redeem on the payment-tender cert, *and* issue/reload on one-or-more
gift-cert cart line items, all in the same request). Sheets' existing idempotency guard
(`giftCardLedgerDecision`, Phase 51) scopes uniqueness to the **(cert_number, tx_ref) tuple**, not
to `tx_ref` globally — which is exactly why this works today. A Postgres `tx_ref text unique`
column, taken literally from the research doc's SQL sketch, would silently swallow the second
operation via `ON CONFLICT (tx_ref) DO NOTHING` the first time two gift-card operations in one
sale share a `refNumber`. **The fix is a composite, globally-unique synthetic tx_ref** —
`refNumber + ':' + cert_number + ':' + kind` — minted by the new store facade before it ever
reaches either Postgres or the Apps Script mirror call. This is detailed in Pitfall 1 below and
must be a planning decision, not an implementation afterthought.

A second finding supersedes part of the canonical research doc: `updateGiftCardInvoice` is **no
longer** outside the Apps Script lock — Phase 82 (D-18) already moved it under
`acquireScriptLock`. The CONTEXT.md canonical-refs pointer to "lock analysis (~:136–160,
`updateGiftCardInvoice` outside the lock)" describes the *pre-Phase-82* state; current
`adminApi.gs:5291-5313` shows the fix already shipped. This doesn't change anything Phase 84 needs
to build, but the planner should not re-litigate or re-fix it.

**Primary recommendation:** build one new module, `lib/gift-card-store.js`, as the single
abstraction every call site (routes + pos.js + the new adjust endpoint) goes through. It owns: (1)
reading `GIFT_CARDS_STORE` via the existing `store-flag.js`, (2) the atomic Postgres
redeem/reload/issue/void/adjust transactions, (3) minting the composite `tx_ref`, (4) firing the
sheet-mirror re-run (dual) or copy-state upsert (post-flip) via `sheet-mirror.js`, and (5) calling
`dual-write-compare.js` after every dual-mode write. Every existing call site becomes a thin
wrapper around this module; none of `pos.js`'s Zoho-facing logic (invoice creation, payment
booking, idempotency locks) changes.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Gift-card balance of record | API / Backend (`lib/gift-card-store.js` → Postgres) | Database / Storage | Money-of-record; atomicity requires a real transaction, which only the DB tier can provide |
| Gift-card ledger (audit trail) | Database / Storage | API / Backend (writes it) | Append-only; the invariant (`current_balance = sum(ledger)`) is a DB-tier concern |
| Sheet mirror (human-readable copy) | API / Backend (fire-and-forget) | — | Explicitly NOT authoritative; a write-behind convenience for the owner, never read for a decision |
| Pre-payment balance lookup (kiosk sale) | API / Backend | Browser / Client (displays result) | Must be server-authoritative (existing D-05 convention); client never supplies a balance |
| Kiosk balance-adjust UI | Browser / Client (kiosk-core.js) | API / Backend (new endpoint + validation) | UI renders the existing Phase 54 panel pattern; all validation (delta sign, floor, reason) is server-enforced, never trust-the-client |
| Discrepancy detection (dual mode) | API / Backend (`dual-write-compare.js`) | Observability (Sentry) | Pure comparison logic already exists; Sentry is the reporting sink, not the decision-maker |
| Deploy-time migration safety | Build / CI (migration-guard + migration-allowlist) | — | Enforced before any DB tier change ships; unrelated to the gift-card domain logic itself |

## Project Constraints (from CLAUDE.md)

- Never edit `js/main.js`/`js/main.min.js` directly — edit `js/modules/` sources, then
  `npm run build`. The kiosk adjust UI likely lives in `js/kiosk-core.js` (not a numbered module —
  confirm it isn't part of `concat:js` before assuming no build step is needed; it is currently
  loaded as its own script, see Code Examples).
- Run `npm test` (root) AND `cd zoho-middleware && npm test` before every commit; never commit with
  failing tests. For any `lib/db.js`-dependent change, also run `cd zoho-middleware && npm run
  test:db` (Testcontainers, Docker required).
- Write a regression test FIRST for every bug fix (applies directly to the `ensureGiftCardLedgerSheet`
  empty-tab crash folded into this phase — see Pitfall 4).
- One logical change per commit.
- `npm run lint` must be clean (middleware + root) before commit.
- Every public HTML page has a CSP `<meta>` tag — N/A here (no new third-party service), but if any
  new kiosk fetch target is introduced, double-check `kiosk.html`'s CSP already allows the
  middleware origin (it does — the adjust endpoint is same-origin middleware).
- Middleware has its own `node_modules` — always `cd zoho-middleware` first for its commands.
- Staging first, always — this phase's ≥7-day dual window (D-02) runs on **production**
  specifically (per CONTEXT D-15, after-hours cutover), but the code itself deploys to staging
  first per the standing rule, and staging gets its own full rehearsal backfill (CONTEXT D-15,
  Phase 83 D-11).

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Phase boundary / schema:**
- `gift_cards` (`numeric(10,2)` balances, `GC-` text IDs) + append-only `gift_card_transactions`
  (`tx_ref UNIQUE`); redeem/reload/issue/void/adjust are single transactions.
  **Research correction: `tx_ref UNIQUE` must be scoped as a composite synthetic value
  (sale-ref + cert_number + kind), not the raw sale-level `refNumber` — see Pitfall 1. The
  "UNIQUE" constraint itself stays locked; what gets inserted into that column is the resolved
  detail.**
- Every gift-card call site goes behind `GIFT_CARDS_STORE`: `routes/gift-cards.js` (next-number,
  lookup, void), the four `pos.js` confirm-chain sites (redeem / issue / update-invoice / reload,
  ~:1709–1790), the two `lookup_gift_card` pre-payment sites (~:740, ~:1402), and kiosk Gift Card
  Management.
- Backfill from the `.xlsx` snapshot via the Phase 83 pipeline, balances equal to the cent, zero rejects.
- `dual` ≥1 week on production → flip to `postgres`; the production sheet stays a read-only mirror.
- New kiosk balance-adjust control (ledgered, attributed) replaces hand-editing the sheet.
- Live verification on production: real kiosk sale with a gift card, a lookup, a void.
- Out of scope: other stores (Phases 85–88), MONEY-03's M15 tax parity, Zoho accounting for adjustments.

**Carried forward (do not re-open):**
- Store flag `GIFT_CARDS_STORE` = `sheets` | `dual` | `postgres` via Railway env var only; invalid
  value refuses to boot; unset = `sheets` (Phase 83 D-05/D-06, `lib/store-flag.js` already lists it).
- Sheet mirror is production-only and not overridable; staging writes only to its own Postgres
  (Phase 83 D-07, `lib/sheet-mirror.js`). On staging, `dual` therefore has no sheet leg.
- Discrepancies go through `lib/dual-write-compare.js` → Sentry (Phase 83 D-08); balances may be
  opted into `reportValuesFor`.
- Backfill: owner-downloaded `.xlsx`, run from the owner's Mac, rejects block promotion, PII files
  never committed (Phase 83 D-09..D-13). Staging gets a full real copy (D-11).
- Deploy-time migrations additive only (Phase 83 D-04). Atomic redeem shape from research Stage 2:
  `INSERT … ON CONFLICT (tx_ref) DO NOTHING` + guarded `UPDATE … WHERE current_balance >= amount`.

**Dual window & flip:**
- D-01: In `dual`, Postgres is authoritative for reads and writes; the sheet leg re-runs the real
  Apps Script ops fire-and-forget (`issue_gift_card`, `redeem_gift_card`, `reload_gift_card`,
  `void_gift_card`, `update_gift_card_invoice`, with the same `tx_ref`) so the sheet independently
  computes the result. Compare the sheet's returned balance/status with Postgres's and report via
  `dual-write-compare`. Lookups in dual read Postgres; a sheet lookup comparison is at Claude's discretion.
- D-02: Flip bar: ≥7 consecutive days in dual AND at least one real-or-scripted instance of each op
  (issue, redeem, reload, lookup, void, adjust) with zero unexplained discrepancies. If real traffic
  doesn't cover an op, staff run a scripted $1 test-card sequence on production during the window
  (the plan provides the runsheet, test card voided/cleaned up afterwards). The owner decides the flip.
- D-03: On a discrepancy, sales continue (Postgres stays authoritative) and Sentry alerts. Each
  discrepancy is investigated and recorded in the phase log as explained or bug. A bug fix restarts
  the 7-day window; an explained one does not. No auto-rollback.
- D-04: After the flip to `postgres`, the sheet mirror switches to copy state: a row upsert
  (balance, status, last_updated, invoice number) plus a read-only ledger-row append per transaction,
  fire-and-forget. The Phase 51 Apps Script logic leaves the hot path. Needs new Apps Script mirror
  action(s) and a redeploy (record the rollback version in RUNBOOK). Rollback from postgres → sheets
  = a documented ledger-replay runbook step, not just a flag flip.

**Balance-adjust control:**
- D-05: Lives in the existing kiosk Gift Card Management screen (Device Settings, Phase 54). Kiosk
  auth is device-token (no staff identity), so staff must type their name/initials and the ledger
  row stores `actor_name` (self-reported) + device ID + reason. Server-side validation on every field.
  **Research note: this codebase has no per-physical-kiosk device identifier today — the device
  tier is one shared `KIOSK_DEVICE_TOKEN` matched by `.matches()`, not an enumerable ID (see Open
  Questions). "Device ID" for the ledger will need a client-supplied value, not a server-derived one.**
- D-06: Input is a signed delta, not a new total. Balance may not go below $0 (rejected, not
  clamped). Active cards only (voided cards refused). Required reason from a pick-list: correction
  / goodwill / refund-to-card / other (+ required note for 'other'). No cap. Own `tx_ref` per adjust
  (idempotent on retry/double-tap).
- D-07: The control works only when `GIFT_CARDS_STORE` is `dual` or `postgres`. In `sheets` mode
  it's hidden or explains "edit the sheet". No new `adjust_gift_card` Apps Script action. The kiosk
  needs to learn the mode (e.g. a field on an existing gift-card response).
- D-08: No Zoho Books write for adjustments. The ledger plus sheet mirror is the record.

**Database-down behaviour:**
- D-09: In `dual`/`postgres`, if the DB is unreachable at pre-payment lookup → 503 before any
  charge (same as today's Apps-Script-unavailable path in production). No fallback to the sheet
  mirror. Non-gift-card sales unaffected.
- D-10: When any store is `dual` or `postgres`, `database:false` makes `gated-deploy.yml`'s smoke
  check fail. `/health` `status` stays `ok` (no Railway restart loop), and a Sentry alert fires on
  DB-down. In all-`sheets` mode, D-02 (Phase 83) behaviour is unchanged.
- D-11: If a card is charged and the Postgres redeem/issue/reload then fails, write a Redis pending
  record keyed by `tx_ref` + Sentry error + the existing staff-visible `gift_card_activation_failed`
  flag. A replay/reconcile path applies it to Postgres when the DB returns (safe via `tx_ref
  UNIQUE`). The regression test asserts the durable pending record, not just a log line.

**Backfill & ledger history:**
- D-12: Each card gets an opening_balance ledger row equal to its snapshot balance;
  `current_balance = sum(counted ledger rows)` is an invariant. Existing Phase 51
  `GiftCardTransactions` rows import as historical (`imported` flag, excluded from the sum); their
  `tx_ref`s are reserved so an old ref can't replay.
- D-13: Load all real certs including voided and $0 ones (status kept). Exclude `TEST-*` certs
  (TEST-LEDGER-01 + its 4 probe ledger rows) by an explicit reported rule. Rows with
  `needs_manual_review` set or an unsettled claim are rejected.
- D-14: Cert numbers: a Postgres sequence seeded above the highest backfilled `GC-NNNNNN` suggests
  the next number. Staff override kept; `UNIQUE(cert_number)` enforces no duplicates. Seed must
  account for overridden numbers above the sequence.
- D-15: Production cutover is after hours: snapshot → backfill → promote → set
  `GIFT_CARDS_STORE=dual` → run a read-only verify script comparing every Postgres balance/status
  with the live sheet to the cent before opening. Any mismatch → flip back to `sheets`, fix, redo.
  Staging does the same rehearsal first.

### Claude's Discretion

- How the adjust appears on the sheet leg during `dual` (D-01 re-runs real ops, but D-07 adds no
  adjust action): recommended approach is +delta → `reload_gift_card`, −delta → `redeem_gift_card`
  with the adjust's `tx_ref`. **Research confirms this works mechanically** — `reloadGiftCard`/
  `redeemGiftCard` in `adminApi.gs` take exactly `{cert_number, amount, transaction_ref}` and their
  idempotency guard is (cert, ref)-scoped, so a synthetic composite `tx_ref` (see Pitfall 1) is
  accepted with no Apps Script redeploy. Otherwise fold an adjust into the D-04 mirror redeploy.
- Table/column design beyond the fixed constraints, ledger `type` enum, index choices, the module
  split (e.g. `lib/gift-card-store.js` facade with sheets/dual/postgres implementations).
- Whether lookups in `dual` also fire a comparison sheet read.
- Replay mechanism for D-11 (extend `lib/reconcile.js` sweep vs a dedicated job). **Research
  recommendation: extend `lib/reconcile.js`'s existing `sv:void-failure`/`recordCollectReconcileFailure`
  pattern rather than inventing a new one — see Architecture Patterns.**
- Kiosk UI layout of the adjust form (ES5, iPad Safari, match Phase 54 screen patterns).

### Deferred Ideas (OUT OF SCOPE)

- Zoho Books journal entries for balance adjustments (D-08), as a future accounting phase if the
  bookkeeper wants it.
- Admin-page (Google-session, verified identity) adjust control, a possible later addition
  alongside the kiosk.
- Full staff attribution across admin-proxy/Apps Script writes: remains in
  `admin-write-attribution-kiosk-middleware.md`.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| DB-03 | Gift-card balance of record is Postgres — `gift_cards` + `gift_card_transactions` (`tx_ref UNIQUE`), redeem/reload atomic, all call sites flagged, backfilled to the cent, ≥1-week dual, flipped, kiosk balance-adjust control replaces sheet hand-edits; live kiosk sale/lookup/void verified. | DDL + atomic SQL pattern (Architecture Patterns, Code Examples); exact 6 call sites with line numbers (Architecture Patterns); backfill spec extension pattern (Don't Hand-Roll); dual/flip/rollback mechanics (all CONTEXT decisions, carried into Code Examples); kiosk adjust UI pattern reusing Phase 54 panel (Code Examples, Architecture Patterns) |
</phase_requirements>

## Standard Stack

### Core

| Library | Version (installed) | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `pg` | `^8.23.1` [VERIFIED: zoho-middleware/package.json] | Postgres driver, used exclusively via `lib/db.js` | Already the sole DB layer per Phase 83; no ORM in a CommonJS/ES5, no-build-step codebase |
| `node-pg-migrate` | `^9.0.0` [VERIFIED: zoho-middleware/package.json] | Migration runner, invoked by `railway.toml`'s `preDeployCommand` | Already wired; Phase 84 adds `migrations/0002_gift_cards.sql` (or similar), nothing new to install |
| `@testcontainers/postgresql` | `11.14.0` [VERIFIED: zoho-middleware/package.json] | Real-Postgres Jest harness, `postgres:18-alpine` pinned to match Railway's actual PG 18.6 | Already wired (`jest.db.config.js`, `npm run test:db`); the research doc's original `pg-mem` rejection (fakes transactional semantics) stands |

**No new packages are required for this phase.** Everything the gift-card migration needs — `pg`,
`node-pg-migrate`, the Testcontainers harness, `lib/db.js`, `lib/store-flag.js`,
`lib/sheet-mirror.js`, `lib/dual-write-compare.js` — was built and independently re-verified in
Phase 83 (`83-VERIFICATION.md`, score 36/36). Phase 84 is pure application code: a new migration
file, a new store-facade module, route wiring, a backfill spec, and kiosk UI.

### Package Legitimacy Audit

**Not applicable — no new external packages are installed by this phase.** All dependencies used
are already present in `zoho-middleware/package.json` from Phase 83 and were already subjected to
the legitimacy gate in that phase's research. Nothing to audit here.

## Architecture Patterns

### System Architecture Diagram

```
Kiosk (kiosk.html / js/kiosk-core.js)
  │
  │ (A) sale confirm w/ gift-card split-tender or gift-cert line item
  │ (B) GC lookup/void (existing Phase 44/54 panel)
  │ (C) NEW: balance-adjust (extends Phase 54 panel)
  ▼
Express middleware (Railway)
  routes/pos.js  ───────────────┐          routes/gift-cards.js
  (confirm chain: redeem/issue/ │          (next-number / lookup / void)
   reload / update-invoice)     │                    │
  │                             │                    │
  └──────────────┬──────────────┴────────────────────┘
                 ▼
     lib/gift-card-store.js   ← NEW facade, single entry point
       │  reads GIFT_CARDS_STORE via lib/store-flag.js
       │
       ├─ mode=sheets   → calls Apps Script directly (today's behaviour, unchanged)
       │
       ├─ mode=dual     → Postgres write is authoritative, response built from it
       │                  + sheet-mirror.mirrorFireAndForget() re-runs the REAL
       │                    Apps Script op with the SAME synthetic tx_ref
       │                  + dual-write-compare.compareAndReport() diffs the two
       │
       └─ mode=postgres → Postgres write only; sheet-mirror does a row-upsert +
                           ledger-append "copy state" (D-04), no Apps Script
                           business logic re-run
                 │
                 ▼
     lib/db.js withTransaction()
       BEGIN
         INSERT gift_card_transactions (..., tx_ref) ON CONFLICT (tx_ref) DO NOTHING
         UPDATE gift_cards SET current_balance = ... WHERE current_balance >= amount
       COMMIT
                 │
                 ▼
          Postgres (Railway, both environments)

     On Postgres write FAILURE after a charge succeeded (D-11):
     lib/gift-card-store.js → cache.set('giftcard:pending:' + tx_ref, ctx, ttl)
       (mirrors lib/reconcile.js's sv:void-failure pattern)
       → Sentry alert + gift_card_activation_failed=true in the sale response
       → lib/reconcile.js sweep (extended) replays into Postgres when DB returns
```

### Recommended Project Structure

```
zoho-middleware/
├── lib/
│   └── gift-card-store.js        # NEW — the single facade (sheets/dual/postgres)
├── migrations/
│   └── 0002_gift_cards.sql       # NEW — additive only (D-04); gift_cards + gift_card_transactions
├── routes/
│   ├── gift-cards.js             # MODIFIED — next-number/lookup/void route through the facade
│   │                               NEW — POST /api/kiosk/gift-card/adjust
│   └── pos.js                    # MODIFIED — 6 call sites route through the facade (no Zoho logic changes)
├── scripts/backfill/specs/
│   └── gift-cards.js             # NEW — spec file (see Don't Hand-Roll: likely needs a bespoke
│                                    script, not a drop-in single-table spec — two output tables)
└── __tests__/
    ├── gift-card-store.test.js   # NEW — facade unit tests (mode dispatch, tx_ref minting)
    └── db/
        └── gift-card-store-apply.test.js  # NEW — real-Postgres atomicity proofs (replay, crash-retry)

apps-script/
└── adminApi.gs                   # MODIFIED — fix ensureGiftCardLedgerSheet empty-tab crash (Pitfall 4);
                                     ADD mirror-copy-state action(s) for D-04 post-flip (new, not yet named)

kiosk.html                        # MODIFIED — extend #kgcm-panel with an adjust view
js/kiosk-core.js                  # MODIFIED — kioskShowGiftCardMgmt(): add adjust state + fetch
```

### Pattern 1: Composite tx_ref minting (resolves the UNIQUE conflict — Pitfall 1)

**What:** The facade, not the callers, constructs the value that goes into
`gift_card_transactions.tx_ref`. Callers keep passing their existing per-sale `refNumber` (unchanged
— no `pos.js` call-site signature needs to grow a new parameter beyond what it already has); the
facade appends the cert and the operation kind.

**When to use:** Every write path (redeem, issue, reload, adjust, and the historical backfill rows).

```javascript
// lib/gift-card-store.js (illustrative — not yet written)
function mintTxRef(saleRef, certNumber, kind) {
  // saleRef is pos.js's existing refNumber (e.g. 'KIOSK-1696300000000' or an SO reference).
  // certNumber + kind make the composite globally unique even when one sale touches
  // multiple certs (redeem cert A for payment + issue/reload cert B as a cart line) —
  // see Pitfall 1. Do NOT pass saleRef alone to tx_ref.
  return saleRef + ':' + certNumber + ':' + kind;
}
```

The SAME composite string is what gets sent to Apps Script's `transaction_ref` field during `dual`
mode's fire-and-forget re-run — Apps Script's idempotency guard (`giftCardLedgerDecision`) is
scoped to `(cert_number, tx_ref)`, so a longer, more specific string than the raw `refNumber` is
strictly safe there and does not require any Apps Script redeploy to accept.

### Pattern 2: Atomic redeem/reload (confirmed against production code + conversion notes)

```sql
-- Source: .planning/notes/sheets-to-postgres-data-conversion.md §3.1, adapted for the
-- composite tx_ref fix (Pitfall 1) and D-06's floor-at-zero adjust rule.
BEGIN;
  INSERT INTO gift_card_transactions (cert_number, tx_ref, kind, amount, balance_after)
    VALUES ($1, $2, 'redeem', $3,
      (SELECT current_balance - $3 FROM gift_cards WHERE cert_number = $1))
    ON CONFLICT (tx_ref) DO NOTHING;

  UPDATE gift_cards
     SET current_balance = current_balance - $3,
         status          = CASE WHEN current_balance - $3 <= 0 THEN 'depleted' ELSE 'active' END,
         last_updated    = now()
   WHERE cert_number = $1
     AND current_balance >= $3 - 0.001;
COMMIT;
-- Caller must check rowCount on the UPDATE; 0 rows means either the tx_ref already existed
-- (idempotent replay — re-read current state to build the response) or balance was insufficient
-- (reject). Those two cases must be distinguished with a pre-check or a follow-up SELECT —
-- the bare INSERT/UPDATE pair does not itself tell you which happened.
```

**Adjust variant (D-06):** same shape, but `kind='adjust'`, the amount can be positive or
negative, status check requires `'active'` (not `'depleted'` — D-06 says active-only, reload today
allows depleted→active implicitly), and the UPDATE's WHERE clause enforces the floor:
`current_balance + $3 >= 0` (where `$3` is the signed delta) instead of a `>=` subtraction check.

### Pattern 3: Dual-mode write (facade orchestration)

```javascript
// Illustrative shape for lib/gift-card-store.js's redeem():
function redeem(certNumber, amount, saleRef) {
  var mode = storeFlag.resolveStoreMode('GIFT_CARDS_STORE');
  var txRef = mintTxRef(saleRef, certNumber, 'redeem');

  if (mode === 'sheets') {
    return callAppsScript('redeem_gift_card', { cert_number: certNumber, amount: amount, transaction_ref: txRef });
  }

  // dual + postgres both write Postgres authoritatively
  return db.withTransaction(function (client) {
    return atomicRedeem(client, certNumber, amount, txRef); // Pattern 2's SQL
  }).then(function (pgResult) {
    if (mode === 'dual') {
      sheetMirror.mirrorFireAndForget('giftcards.redeem', function () {
        return callAppsScript('redeem_gift_card', { cert_number: certNumber, amount: amount, transaction_ref: txRef })
          .then(function (sheetsResult) {
            dualWriteCompare.compareAndReport({
              store: 'giftcards', operation: 'redeem',
              sheets: sheetsResult, postgres: pgResult,
              reportValuesFor: ['balance', 'new_balance'] // non-PII, D-08 allows
            });
          });
      });
    } else {
      // mode === 'postgres': copy-state mirror (D-04), not a real-op re-run
      sheetMirror.mirrorFireAndForget('giftcards.redeem', function () {
        return callAppsScript('mirror_gift_card_state', { /* row upsert + ledger append */ });
      });
    }
    return pgResult;
  }).catch(function (err) {
    // D-11: Postgres write failed AFTER the card was already charged upstream (pos.js's
    // confirm chain calls this only post-payment) — durable pending record, never silent.
    return recordGiftCardReconcileFailure(certNumber, txRef, amount, err).then(function () {
      throw err; // caller (pos.js) already treats a throw here as giftCardActivationFailed=true
    });
  });
}
```

### Pattern 4: D-11 replay — extend `lib/reconcile.js`, don't invent a new mechanism

`lib/reconcile.js` already has the exact shape D-11 asks for:
`recordCollectReconcileFailure(ctx, transactionId, err)` (reconcile.js:569-612) — writes an
`sv:void-failure`-style sentinel to Redis with a 30-day TTL, logs via `eventLog`, and sends the
existing `mailer.sendVoidFailureAlert`. The recommended approach is a sibling function,
`recordGiftCardReconcileFailure`, in the same file, keyed as
`'giftcard:pending:' + txRef` instead of `'sv:void-failure:' + Date.now()` (so the replay sweep can
target exactly the failed write — a `sv:void-failure:*` scan has no cert/amount structure to
safely retry against). The sweep (`sweepPendingCharges` today scans `KIOSK_PENDING_CHARGE_PREFIX +
'*'`) needs a sibling scan over `'giftcard:pending:*'` that calls the facade's redeem/issue/reload
again with the SAME stored `txRef` — safe by construction because `tx_ref UNIQUE` / `ON CONFLICT
DO NOTHING` makes the replay idempotent even if the original write actually landed just before the
connection/promise rejected.

### Pattern 5: Kiosk adjust UI extends the existing Phase 54 panel verbatim

`kiosk.html:501-534` (`#kgcm-panel`) already has a two-view state machine (`#kgcm-lookup-view` /
`#kgcm-void-view`) wired by `kioskShowGiftCardMgmt()` in `js/kiosk-core.js:5264+`. The adjust
control is a **third view** (`#kgcm-adjust-view`) in the same container, following the exact
same pattern as the existing lookup→void transition:

```javascript
// Source: js/kiosk-core.js:5264-5420 (existing, read in full during research) — the adjust
// button appends to #kgcm-result (next to the existing "Void Certificate" button), gated by
// a new field the lookup response must carry (see D-07's "kiosk needs to learn the mode"):
if (resultEl && d.store_mode && d.store_mode !== 'sheets') {
  // show Adjust Balance button; omitted or disabled when store_mode === 'sheets'
}
```

Recommended wire for D-07: add `store_mode` to the existing `/api/kiosk/gift-card/lookup` response
payload (`{ok:true, data:{..., store_mode: 'dual'}}`), resolved server-side from
`store-flag.resolveStoreMode('GIFT_CARDS_STORE')`. This reuses an existing round-trip instead of
adding a new "what mode are we in" endpoint.

### Anti-Patterns to Avoid

- **Do not reuse `pos.js`'s raw `refNumber` as `tx_ref` directly.** Confirmed by code reading
  (Pitfall 1): one sale can touch multiple certs with the same `refNumber`, and a bare global
  `UNIQUE(tx_ref)` will silently drop the second operation via `ON CONFLICT DO NOTHING`.
- **Do not give the kiosk device a server-trusted "device ID."** No such concept exists today
  (`lib/deviceToken.js` matches one shared token, not per-device identities) — don't invent one
  that implies more security than it has. See Open Questions.
- **Do not let the adjust control write to Zoho Books** (D-08, locked) — ledger + mirror only.
- **Do not fit the gift-card backfill into the existing single-table spec shape without checking
  first** — it is NOT a 1-sheet-to-1-table job like PlatoReadings/VesselHistory/FermSchedules; see
  Don't Hand-Roll.
- **Do not treat `0 rows updated`** on the atomic UPDATE as automatically "insufficient balance" —
  it is ambiguous with "this tx_ref already succeeded" (idempotent replay). Distinguish before
  responding (Pattern 2's inline note).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Postgres connection pooling / transactions | A new pool or `new Pool()` call anywhere | `lib/db.js`'s `query()`/`withTransaction()` | It's the ONLY module allowed to import `pg` (enforced by its own header comment); Phase 83 already handles SSL-for-Railway's-public-proxy, idle-client-error crash prevention, lazy connect |
| Per-store mode resolution | A new env-var reader / mode enum | `lib/store-flag.js`'s `resolveStoreMode('GIFT_CARDS_STORE')` | Already registered in `STORE_ENV_NAMES`; already enforces "DATABASE_URL required if dual/postgres" at boot |
| Sheet-mirror production gating | A new `NODE_ENV`/`RAILWAY_ENVIRONMENT_NAME` check | `lib/sheet-mirror.js`'s `mirrorFireAndForget()` / `isMirrorEnabled()` | The exact-match-on-production-name logic (not a prefix, not NODE_ENV alone) is already correct and tested; don't re-derive it |
| Dual-write discrepancy comparison | A new deep-equal / diff function | `lib/dual-write-compare.js`'s `compareAndReport()` | Already handles the 4 real normalisation traps (money-as-string vs number, Sheets booleans, ISO-vs-Date, empty-string-vs-null) that WILL occur comparing an Apps Script response to a Postgres row |
| Failed-write durable pending record | A bespoke Redis key scheme | `lib/reconcile.js`'s `recordCollectReconcileFailure` pattern (sibling function) | Same TTL convention (30-day `VOID_FAILURE_TTL`), same `eventLog` + `mailer.sendVoidFailureAlert` wiring already exist and are tested |
| Backfill read/normalise/reject pipeline | A new CSV/XLSX reader | `scripts/backfill/{read-xlsx,normalize,rejects,load}.js` | Already handles the exact conversion traps this sheet has: money-as-float, ambiguous timestamps, `''`→`NULL`, string booleans — see Pitfall 3 for why GiftCards still needs a bespoke *orchestration* script even though it reuses these primitives |
| Migration safety | Hand-written destructive-statement regex | `scripts/migration-guard.js` + `scripts/migration-allowlist.js` (parser-backed, already wired into `npm run migrate`) | Already proven fail-closed against 4 real bypass attempts (83-VERIFICATION.md); a gift-card migration file just needs to BE additive, not re-prove the guard |
| Empty-tab-crashes-on-read bug | A fresh fix pattern | Copy `ensureWaitlistSheet`'s `if (sheet.getLastColumn() === 0) { append headers }` guard (Phase 78) verbatim | Exact same bug class, exact same fix, already shipped once — see Pitfall 4 |

**Key insight:** Phase 83 was explicitly built so that Phase 84 (and 85-87) would be almost pure
domain logic. Every cross-cutting concern — connection management, mode flags, mirror gating,
discrepancy comparison, migration safety, backfill mechanics — already has a tested, re-verified
module. The temptation to route around one of these (e.g., a raw `new Pool()` in a hurry, or a
hand-rolled env check) should be treated as a hard stop.

## Common Pitfalls

### Pitfall 1 (CRITICAL — locked-decision conflict): shared `refNumber` breaks a bare global `tx_ref UNIQUE`

**What goes wrong:** `routes/pos.js`'s sale-confirm handler (`pos.js:1704-1818`) builds ONE
`refNumber` per sale and reuses it across every gift-card Apps Script call in that confirm chain:
`redeem_gift_card` for the payment-tender cert (line 1709-1715) AND `issue_gift_card`/
`reload_gift_card` for each gift-cert cart line item (lines 1749-1757, 1788-1795), all with
`transaction_ref: refNumber`. If a customer redeems GC-000001 to help pay for a sale that ALSO
contains a "buy a $50 gift card" line item (issuing GC-000002), both Apps Script calls carry the
identical `refNumber`. A naive Postgres `gift_card_transactions.tx_ref text unique` column fed
directly with `refNumber` will accept the first INSERT and `ON CONFLICT (tx_ref) DO NOTHING` the
second — **GC-000002 would be charged for by the customer (invoice line item, Zoho revenue
recorded) but never actually issued/credited in Postgres**, because its ledger row silently no-ops.

**Why it happens:** Sheets' existing idempotency guard (Phase 51's `giftCardLedgerDecision`,
`adminApi.gs:4691-4748`) scopes its uniqueness check to the **(cert_number, tx_ref) tuple** — it
loops rows filtering `row.cert_number === certNumber` FIRST, then checks `tx_ref` equality within
that filtered set. A shared `refNumber` across different certs is harmless there. The research
doc's SQL sketch (and the data-conversion notes' DDL) lifted `tx_ref UNIQUE` as a flat global
constraint without re-deriving it against the real call pattern.

**How to avoid:** Mint a composite synthetic value before it reaches the `tx_ref` column or the
Apps Script `transaction_ref` field: `saleRefNumber + ':' + certNumber + ':' + kind` (Pattern 1).
The DB constraint stays `UNIQUE(tx_ref)` exactly as locked (CONTEXT's "`tx_ref UNIQUE`" success
criterion is satisfied) — what changes is what value the facade inserts. This requires zero change
to `pos.js`'s existing `refNumber` construction or to Apps Script's `redeemGiftCard`/
`reloadGiftCard` signatures (they already just echo back whatever `transaction_ref` string they're
given).

**Warning signs:** A regression test that charges a sale containing BOTH a gift-card-tender line
and a gift-cert line item, asserts both cert balances afterward, and checks `gift_card_transactions`
row count === 2 for that sale. Without the composite fix, this test produces exactly 1 row and a
silently-un-credited second card.

### Pitfall 2: ambiguous `0 rows updated` on the atomic UPDATE

**What goes wrong:** The atomic UPDATE's `WHERE cert_number = $1 AND current_balance >= $3` can
return `rowCount === 0` for TWO different reasons: (a) the `tx_ref` already existed and the INSERT's
`ON CONFLICT DO NOTHING` fired — meaning this exact operation already completed, the correct
response is "idempotent replay, here's the current state" — or (b) the balance genuinely is
insufficient, meaning the correct response is a 400 reject. Conflating these produces either a
false "insufficient balance" error on a legitimate retry, or a false "success" on a real rejection.

**Why it happens:** The two-statement `INSERT ... ON CONFLICT DO NOTHING; UPDATE ... WHERE
balance >= amount;` pattern from the research doc doesn't itself carry enough information back to
distinguish the two zero-effect outcomes without an extra read.

**How to avoid:** Before interpreting a 0-row UPDATE result, re-query (inside the same transaction)
whether a `gift_card_transactions` row with that `tx_ref` already exists. If yes → idempotent
replay (mirror Phase 51's `redeemGiftCard`'s `{ok:true, idempotent:true, new_balance:...}` response
shape). If no → genuine insufficient-balance reject.

### Pitfall 3: GiftCards does not fit the existing single-table backfill spec shape

**What goes wrong:** `scripts/backfill/specs/index.js` and its sibling spec files (`plato-readings.js`
etc.) are built for exactly one sheet → one table, with `load.js`'s `buildCreateTableSql` deriving
one `CREATE TABLE` per spec from a flat `columns` array. GiftCards needs: (1) a `gift_cards` row
per sheet row, (2) a synthesized `opening_balance` ledger row per card (D-12 — not present in the
source sheet at all, must be derived), (3) historical `GiftCardTransactions` rows imported as
`imported=true` into the SAME `gift_card_transactions` table, with their `tx_ref`s reserved rather
than replayed, and (4) a `TEST-*` exclusion rule plus a `needs_manual_review`/unsettled-claim reject
rule that have no equivalent in any existing spec. None of this fits `load.js`'s current
single-table, positional-column model.

**Why it happens:** The generic pipeline was deliberately built as a rehearsal harness on
trivially-portable, single-table sheets (`index.js`'s own comment: "VesselHistory, PlatoReadings
and FermSchedules are REHEARSAL targets ... Phases 84-87 add their own spec files for the sheets
that actually get promoted"). GiftCards is the first REAL promotion target, and it's also the one
sheet whose schema genuinely changes shape (one sheet becomes two tables — the data-conversion
notes call this out explicitly: "This is not a 1:1 copy — the schema change *is* the bug fix").

**How to avoid:** Treat `scripts/backfill/specs/gift-cards.js` as a spec for the straightforward
`gift_cards` table only (reuse `load.js` as-is for that half), and write a small dedicated
orchestration script (e.g. `scripts/backfill/gift-cards-backfill.js`) that: reads both the
`GiftCards` AND `GiftCardTransactions` sheets, runs the straightforward spec-driven load for
`gift_cards`, then does a second pass deriving `opening_balance` rows + importing historical ledger
rows with `imported=true` into `gift_card_transactions`, applying the `TEST-*`/`needs_manual_review`
exclusion rules before any promotion. Reuse `normalize.js`/`rejects.js` primitives directly rather
than going through `load.js`'s single-table promote path for the derived/imported half.

### Pitfall 4: `ensureGiftCardLedgerSheet` crashes on an existing-but-empty tab (folded todo, confirmed in code)

**What goes wrong:** `adminApi.gs:4765-4797`'s `ensureGiftCardLedgerSheet()` reads
`sheet.getRange(1, 1, 1, sheet.getLastColumn())` to extract headers immediately after the
"insert if missing" branch — but does NOT check whether an *existing* sheet has zero columns of
data (`getLastColumn() === 0`). Google Sheets' `getRange(1, 1, 1, 0)` throws "The number of columns
in the range must be at least 1." The sheet leg of EVERY gift-card operation runs this function
during `dual` mode (D-01 re-runs the real Apps Script ops), so this crash is live-reachable
throughout the entire dual window, not just at backfill time.

**Why it happens:** confirmed by direct comparison — `ensureWaitlistSheet` (Phase 78,
`adminApi.gs:5370-5410`) has the identical header-reading structure but was fixed with an explicit
`if (sheet.getLastColumn() === 0) { sheet.appendRow(headerNames); ... }` guard BEFORE reading
headers; `ensureGiftCardLedgerSheet` was never given the equivalent fix (it predates Phase 78, or
the fix wasn't backported).

**How to avoid:** Apply the exact Phase 78 fix pattern to `ensureGiftCardLedgerSheet`: add the
`getLastColumn() === 0` guard before the header-read line, write a regression test FIRST (per
CLAUDE.md non-negotiable rule #3) reproducing the crash against an existing-but-blank tab, then
fix. This ships with the Apps Script redeploy this phase already needs for the D-04 mirror actions
— no separate redeploy required.

### Pitfall 5: Railway's public-proxy TLS relaxation must not leak into this phase's backfill tooling

**What goes wrong:** `lib/db.js`'s `sslConfigFor()` relaxes TLS verification (`rejectUnauthorized:
false`) ONLY when the connection string matches `*.proxy.rlwy.net` (the owner's Mac connecting to
Railway's public TCP proxy for the backfill CLI). If a future refactor of the gift-card backfill
orchestration script (Pitfall 3) bypasses `lib/db.js` and constructs its own `pg.Pool`/`pg.Client`
directly — which is tempting since the backfill CLI already does this via `createPool()` exported
from `lib/db.js` — it must still call `db.sslConfigFor(connectionString)` rather than reinventing
TLS config, or it will either fail to connect to Railway's public proxy or (worse) blanket-disable
TLS verification for every connection string.

**How to avoid:** The backfill orchestration script for GiftCards (Pitfall 3) should import and
reuse `lib/db.js`'s exported `createPool`/`sslConfigFor`, exactly as `scripts/backfill/backfill.js`
already does — never construct a bare `new Pool()`.

## Code Examples

### Existing gift-card call sites (exact locations, confirmed by direct read)

```
zoho-middleware/routes/gift-cards.js
  :50   GET  /api/kiosk/gift-card/next-number   → callAppsScript('get_next_cert_number', {})
  :85   GET  /api/kiosk/gift-card/lookup        → callAppsScript('lookup_gift_card', {cert_number})
  :122  POST /api/kiosk/gift-card/void          → callAppsScript('void_gift_card', {cert_number, reason})

zoho-middleware/routes/pos.js
  :740  POST /api/kiosk/sale          pre-payment balance clamp → callAppsScript-equivalent axios.post('lookup_gift_card')
  :1402 POST /api/kiosk/sale/confirm  pre-payment re-clamp      → axios.post('lookup_gift_card')
  :1709 confirm chain  redeem_gift_card   (cert_number, amount, transaction_ref: refNumber)
  :1751 confirm chain  issue_gift_card    (cert_number, face_value, issued_by, notes)
  :1771 confirm chain  update_gift_card_invoice (cert_number, zoho_invoice_number) — only on issue success
  :1790 confirm chain  reload_gift_card   (cert_number, amount, transaction_ref: refNumber)
```

All six write-path calls (void, redeem, issue, update-invoice, reload, plus the new adjust) need to
route through `lib/gift-card-store.js`. The two read-path lookups (`:740`, `:1402`) also need to
honour `GIFT_CARDS_STORE` (read from Postgres in dual/postgres).

### Phase 54 kiosk panel the adjust control extends (exact structure, confirmed by direct read)

```html
<!-- Source: kiosk.html:501-534 -->
<div class="kiosk-discount-mgmt-modal" id="kgcm-panel" style="display:none;">
  <div class="kiosk-discount-mgmt-sheet">
    <div class="kiosk-discount-mgmt-header">
      <h2>Gift Card Management</h2>
      <button type="button" class="kiosk-discount-mgmt-close" id="kgcm-close">&times;</button>
    </div>
    <div id="kgcm-lookup-view"> <!-- cert entry + lookup button --> </div>
    <div id="kgcm-void-view" style="display:none;"> <!-- reason entry + confirm/cancel --> </div>
    <!-- NEW: id="kgcm-adjust-view" follows the identical two-button confirm/cancel shape -->
  </div>
</div>
```

```javascript
// Source: js/kiosk-core.js:5264+ — kioskShowGiftCardMgmt() owns the view-switch state machine.
// Every existing fetch uses _kcMergeAuth(...) to attach kiosk auth headers — the new adjust
// POST must do the same, it does NOT get a bespoke auth path.
fetch(mwUrl + '/api/kiosk/gift-card/void', _kcMergeAuth({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ cert_number: _mgmtCert, reason: reason })
}))
```

### Apps Script redeem/reload signature (confirmed exact contract, for the dual-mode re-run)

```javascript
// Source: apps-script/adminApi.gs:4999 (redeemGiftCard), :5131 (reloadGiftCard)
// Both take exactly: { cert_number, amount, transaction_ref }
// Idempotency scoped to (cert_number, tx_ref) via giftCardLedgerDecision (adminApi.gs:4691-4748)
// — safe to pass the composite tx_ref (Pitfall 1) with NO Apps Script code change.
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|---------------|--------|
| `GiftCards` sheet is the balance of record; 4 non-atomic writes (balance, status, timestamp, last_tx_ref) with the idempotency key written last | `gift_cards` + append-only `gift_card_transactions` with `tx_ref UNIQUE` enforced by Postgres, one transaction | This phase (Phase 84) | Closes the exact crash-window double-credit/double-debit defect that justified the whole v4.9 milestone (T1/T2 in the research doc's trigger table) |
| `redeemGiftCard`/`reloadGiftCard` idempotency scoped to (cert_number, tx_ref) via a claim-row ledger inside Sheets (Phase 51) | Same semantic guarantee, enforced by a real DB constraint instead of application-level claim rows | Phase 51 → Phase 84 | Phase 51's claim-before-mutate pattern was already correct; Phase 84 doesn't need to re-derive the idempotency *rule*, just re-implement it atomically |
| `updateGiftCardInvoice` ran outside `acquireScriptLock`, racing redeem/reload/void on the same row | Fixed under the lock | Phase 82 (D-18) | The CONTEXT.md canonical-refs pointer to this as an open issue is **stale** — already shipped; do not re-plan a fix for it |
| Real-Postgres test harness pinned to `postgres:16-alpine` while Railway runs PG 18 | Harness pinned to `postgres:18-alpine`, version-matched by `server-version.test.js` | Commit `092b0a4f` (recorded in STATE.md, this session's git log) | The "Railway Postgres is v18" memory-note mismatch is **already resolved** — no action needed this phase |

**Deprecated/outdated:**
- The original research doc's bare `tx_ref UNIQUE` SQL sketch is superseded by the composite-key
  fix in Pitfall 1 — the column name and constraint stay, the value minted into it changes.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `js/kiosk-core.js` is loaded as its own `<script>` tag (not part of `concat:js`/`main.min.js`), so adjust-UI changes there don't require the full `npm run build` concat step — only the kiosk-specific minify step if one exists for it. **Not independently re-verified against `package.json`'s `minify:js`/`stamp:pages` lists in this session.** | Project Constraints, Recommended Project Structure | If wrong, a planner task could skip a required build step and ship a stale `kiosk-core.min.js` to production — verify `package.json`'s build scripts for `kiosk-core` before finalizing the plan's build-step task. |
| A2 | The D-04 "copy state" sheet-mirror post-flip needs at least one NEW Apps Script action (e.g. `mirror_gift_card_state`) distinct from the existing `redeem_gift_card`/`reload_gift_card`/etc., since those run real business logic (lock, idempotency ledger) the copy-state mode should NOT re-trigger. | Architecture Patterns (Pattern 3), CONTEXT D-04 | If wrong (i.e., if the existing actions can be safely reused for copy-state with a flag), the plan may include an unnecessary new Apps Script action; low risk either way since D-04 already calls for "new Apps Script mirror action(s) and a redeploy." |
| A3 | `kiosk.html`'s existing CSP `<meta>` tag already allows the middleware origin broadly enough that no CSP edit is needed for the new `/api/kiosk/gift-card/adjust` endpoint (same-origin middleware, no new third-party domain). **Not independently grepped against the live CSP header text in this session.** | Project Constraints | If wrong, the new fetch would be silently blocked client-side with no server-side symptom — a fast, cheap thing to verify directly (grep the CSP meta tag's `connect-src` for the middleware origin) before closing the phase. |

## Open Questions

1. **What does "device ID" mean for D-05's ledger `actor_name` + device ID when kiosk auth is one
   shared `KIOSK_DEVICE_TOKEN`?**
   - What we know: `lib/authTiers.js`/`lib/deviceToken.js` implement a single shared device token
     matched via `.matches()` — there is no concept of multiple distinguishable kiosk devices
     server-side anywhere in this codebase today.
   - What's unclear: whether "device ID" in D-05 means (a) a client-generated/stored identifier
     (e.g., a UUID written to kiosk `localStorage` once per physical iPad) sent in the adjust
     request body, or (b) something coarser like a hardcoded string `'kiosk'` that just
     distinguishes kiosk-originated adjusts from a hypothetical future admin-page adjust.
   - Recommendation: default to (a) — a client-supplied, self-reported device label (not
     security-sensitive, purely an audit-trail convenience, consistent with `actor_name` already
     being self-reported per D-05) — and have the planner confirm this reading with the owner if
     multiple physical kiosks exist in practice.

2. **Does `package.json`'s build pipeline already cover `js/kiosk-core.js` and `kiosk.html`
   correctly, or does the adjust UI need new `minify:js`/`stamp:pages` entries?**
   - What we know: the CLAUDE.md non-negotiable rules require `npm run build` after any
     `js/modules/*` change, but `kiosk-core.js` isn't a numbered module.
   - What's unclear: exact current build-script wiring for `kiosk-core.js`/`kiosk.html` (not
     grepped in this session — see Assumption A1).
   - Recommendation: the planner's first task for the kiosk UI work should grep `package.json`'s
     `minify:js`/`stamp:pages` arrays for `kiosk-core`/`kiosk.html` before writing any UI code, to
     confirm the correct build step is included in the task's definition of done.

3. **Exact shape of the new D-04 "copy state" Apps Script mirror action(s).**
   - What we know: D-04 says row upsert (balance/status/last_updated/invoice) + a read-only
     ledger-row append per transaction, fire-and-forget, replacing the real-op re-run.
   - What's unclear: whether this is one action (`mirror_gift_card_state`) taking a full snapshot
     payload, or two (one for the GiftCards row upsert, one for the ledger append) — affects how
     many Apps Script functions the eventual redeploy adds.
   - Recommendation: one action taking `{cert_number, current_balance, status, last_updated,
     zoho_invoice_number, ledger_entry: {tx_ref, kind, amount, balance_after, created_at}}` is
     simplest (one HTTP round-trip, one Apps Script function) — left as Claude's Discretion per
     CONTEXT, the planner should just pick one and record it.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Railway Postgres (staging) | All DB-tier writes in dual/postgres mode | ✓ [VERIFIED: 83-VERIFICATION.md SC1] | PG 18.x | — |
| Railway Postgres (production) | Same, for the production dual window (D-15) | ✓ [VERIFIED: 83-VERIFICATION.md SC1] | PG 18.6 | — |
| Docker (local, for `npm run test:db`) | Testcontainers-based atomicity tests | Assumed ✓ on dev machine [ASSUMED — not re-probed this session; Phase 83's harness already depends on it and was last run successfully per STATE.md] | — | A local Postgres via Homebrew + `TEST_DATABASE_URL`, per the original research doc's fallback note — not currently wired, would need its own task if Docker is unavailable |
| Railway backup/restore (production) | CONTEXT's implicit prerequisite — Phase 83's human-verification item #2 | **UNCERTAIN** — 83-VERIFICATION.md flagged this `human_needed`; STATE.md/memory notes say "backups live" post 2026-10-02, but no independent re-check in this session | — | None — this is a hard prerequisite the owner must confirm before Phase 84 writes real money data (83-GUARD-RESEARCH.md owner decision 4) |
| `libpg-query` WASM load inside Railway's actual build container | Migration guard chain on every deploy, including this phase's `0002_gift_cards.sql` | **UNCERTAIN** — 83-VERIFICATION.md's other `human_needed` item; never yet observed in a real Railway pre-deploy log per that report | — | None identified; if it fails, the deploy aborts (fail-closed, by design) and the previous release keeps serving — not a silent risk, but worth the owner confirming it before relying on an uninterrupted deploy cadence during the dual window |

**Missing dependencies with no fallback:**
- Confirmed backup/restore drill and the first real Railway pre-deploy guard-chain observation
  (both carried over from Phase 83's `human_needed` status) should be closed out — or explicitly
  re-confirmed as already closed per STATE.md's "Phase 83 Postgres infra status" memory note —
  before this phase's migration touches real gift-card money data.

**Missing dependencies with fallback:**
- Local Docker for `npm run test:db` — has a documented (if worse) fallback to a local Postgres
  installation; not currently wired as a CI-config toggle.

## Validation Architecture

> Note: `.planning/config.json` has `workflow.nyquist_validation: false`. Per this researcher's
> standing instructions this section may be skipped entirely; it is included anyway, abbreviated,
> because the orchestrator's task brief explicitly requested it. Treat it as informational —
> the planner is not obligated to enforce the sampling cadence below if the project's validation
> workflow is genuinely disabled project-wide.

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Jest `^29.7.0` (middleware), plus a dedicated real-Postgres config |
| Config file | `zoho-middleware/jest.config.js` (unit, mocked) / `zoho-middleware/jest.db.config.js` (real Postgres via Testcontainers) |
| Quick run command | `cd zoho-middleware && npx jest gift-card-store.test.js` |
| Full suite command | `cd zoho-middleware && npm test && npm run test:db` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| DB-03 | Same-`tx_ref` replay leaves balance unchanged | unit + real-DB | `npx jest gift-card-store.test.js` / `npm run test:db -- gift-card-store-apply` | ❌ Wave 0 — new files |
| DB-03 | Crash-then-retry (interrupted transaction) leaves balance unchanged | real-DB (Testcontainers, simulate a mid-transaction failure) | `npm run test:db -- gift-card-store-apply` | ❌ Wave 0 |
| DB-03 | One sale touching 2 different certs with the same `refNumber` produces 2 distinct ledger rows (Pitfall 1 regression) | integration (pos.js confirm chain) | `npx jest pos-giftcard.test.js` (extend existing file) | Existing file, new test case |
| DB-03 | `GIFT_CARDS_STORE=dual` fires both Postgres write and sheet re-run, compares, reports no false discrepancy on a clean run | unit (mocked Apps Script + real-DB) | `npx jest gift-card-store.test.js` | ❌ Wave 0 |
| DB-03 | Kiosk adjust: delta floor at $0 rejected, not clamped; voided card rejected | unit | `npx jest gift-card-store.test.js` + a new `routes/gift-cards-adjust.test.js` | ❌ Wave 0 |
| DB-03 | D-11: Postgres write failure after charge produces a durable Redis pending record (not just a log line) | unit (mocked `cache`, mocked `db` throwing) | `npx jest reconcile.test.js` (extend existing) | Existing file, new test case |
| DB-03 | Backfill: `TEST-*` excluded, `needs_manual_review`/unsettled rows rejected, opening_balance invariant holds | real-DB (Testcontainers) | `npm run test:db -- gift-cards-backfill` | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** the relevant unit test file (`npx jest <file>.test.js`)
- **Per wave merge:** `cd zoho-middleware && npm test` (full mocked suite) — real-DB suite
  (`npm run test:db`) at least once per wave given Docker startup cost
- **Phase gate:** `npm test && npm run test:db` both green, plus root `npm test` (frontend, for the
  kiosk UI changes), before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `zoho-middleware/__tests__/gift-card-store.test.js` — facade unit tests, all 5 DB-03 behaviors above
- [ ] `zoho-middleware/__tests__/db/gift-card-store-apply.test.js` — real-Postgres atomicity proofs
- [ ] `zoho-middleware/__tests__/db/gift-cards-backfill.test.js` — backfill invariants against real Postgres
- [ ] `zoho-middleware/migrations/0002_gift_cards.sql` — schema itself (not a test file, but a Wave 0 prerequisite for every real-DB test above)
- [ ] Extend existing `pos-giftcard.test.js`/`pos-gift-card.test.js` for the Pitfall 1 multi-cert-one-ref regression
- [ ] Extend existing `reconcile.js` test file for D-11's durable pending record

## Security Domain

> `security_enforcement: true`, `security_asvs_level: 1` in `.planning/config.json`.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | Yes (unchanged) | Existing 3-tier `authTiers.requireTiers`/`KIOSK_ROUTES` allowlist already covers lookup/next-number/void; the new adjust endpoint must be added to `KIOSK_ROUTES` deliberately (not via a prefix match — `isKioskRoute`'s own header comment warns against prefix-matching new routes in) |
| V4 Access Control | Yes | D-07's store-mode gate (adjust only works in dual/postgres) is an access-control rule enforced server-side, not just hidden client-side — the endpoint itself must reject with a clear error in `sheets` mode, not rely on the kiosk UI hiding the button |
| V5 Input Validation | Yes | D-06's full validation set: signed delta (reject non-numeric/NaN), floor-at-$0 (reject, don't clamp), active-card-only, required reason from a closed pick-list (+required note for 'other'), `$1$ UNIQUE tx_ref` for idempotent retry — all server-side, matching the existing `cert_number` regex (`/^GC-\d{6}$/`) and `reason` length-cap (512 chars) conventions already used in `gift-cards.js:void` |
| V6 Cryptography | No new surface | No new secrets/crypto introduced this phase — `DATABASE_URL`/TLS handling is unchanged from Phase 83 |
| V9 Data Integrity | Yes | The core of this phase — `tx_ref UNIQUE` (composite-keyed per Pitfall 1) + the guarded `UPDATE ... WHERE current_balance >= amount` are the "no double-spend" integrity controls that justify the whole migration |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Double-credit/double-debit via a crash-then-retry or a client-side replay | Tampering / Repudiation | `tx_ref UNIQUE` + `ON CONFLICT DO NOTHING` inside one DB transaction (Pattern 2) — this is literally the defect this phase exists to close |
| A leaked `KIOSK_DEVICE_TOKEN` abusing the new adjust endpoint for a no-cap, no-manager-PIN balance credit | Elevation of Privilege | D-06 has no cap and D-05 has no manager-PIN gate (consistent with the existing void control's accepted risk posture, `authTiers.js:28-37` — "the owner accepts the residual risk that a leaked device token could void a certificate"); the planner should carry the SAME accepted-risk framing into the adjust feature explicitly, since a credit-only-at-$0-floor control with no cap is a real monetary exposure if the device token leaks — recommend the plan's security review explicitly re-affirm this is an accepted risk (matching precedent) rather than silently inheriting it |
| SQL injection via `cert_number`/`reason`/adjust note | Tampering | `lib/db.js`'s `$1..$n` placeholder-only convention (enforced by its own header comment, ASVS V5) — no string-built SQL anywhere in the facade |
| A sale crediting the wrong cert due to the Pitfall 1 tx_ref collision | Tampering / Integrity | The composite tx_ref fix (Pitfall 1) is itself the mitigation — must be a locked implementation detail in the plan, not left to the task executor's judgement |

## Sources

### Primary (HIGH confidence — direct codebase read, this session)

- `zoho-middleware/lib/db.js`, `lib/store-flag.js`, `lib/sheet-mirror.js`, `lib/dual-write-compare.js`,
  `lib/reconcile.js`, `lib/money-path.js` — read in full
- `zoho-middleware/routes/gift-cards.js` — read in full
- `zoho-middleware/routes/pos.js` lines 700-940, 1380-1430, 1690-1860 — read directly
- `zoho-middleware/lib/authTiers.js` lines 1-100 — read directly
- `apps-script/adminApi.gs` lines 1605-1645 (`generateNextId`), 4654-4941 (ledger decision +
  issue/lookup), 4943-5106 (redeem), 5108-5241 (reload), 5241-5340 (void/invoice-update/list),
  5370-5410 (`ensureWaitlistSheet` fix pattern) — read directly
- `kiosk.html` lines 490-568, `js/kiosk-core.js` lines 5240-5420 — read directly
- `zoho-middleware/migrations/0001_init.sql`, `zoho-middleware/jest.db.config.js`,
  `zoho-middleware/__tests__/db/server-version.test.js`,
  `zoho-middleware/__tests__/db/helpers/pg-harness.js` (grepped), `scripts/backfill/{backfill,load,
  specs/index,specs/plato-readings}.js` — read directly
- `.planning/phases/83-postgres-infrastructure/83-VERIFICATION.md` — read in full
- `.planning/research/sheets-to-postgres-migration.md` — read in full (lines 1-635)
- `.planning/notes/sheets-to-postgres-data-conversion.md` — read in full
- `.planning/phases/84-giftcards-postgres/84-CONTEXT.md`, `84-DISCUSSION-LOG.md` — read in full
- `.planning/REQUIREMENTS.md`, `.planning/STATE.md` (relevant excerpts), `.planning/config.json` — read directly
- `zoho-middleware/package.json` (dependency versions, scripts) — read directly via grep

### Secondary (MEDIUM confidence)

- None used this session beyond direct codebase evidence — no WebSearch/Context7 lookups were
  needed; this phase is 100% internal-codebase domain knowledge, not external library research.

### Tertiary (LOW confidence)

- Assumptions A1-A3 (build-script wiring for `kiosk-core.js`, CSP coverage, exact D-04 Apps Script
  action shape) — flagged explicitly in the Assumptions Log, not independently re-verified this
  session.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new packages; everything cited exists and is pinned in `package.json`, directly grepped
- Architecture: HIGH — every call site, every reusable module, and the one critical design conflict (Pitfall 1) are confirmed by direct code reading, not inferred
- Pitfalls: HIGH — all 5 pitfalls are concrete, reproduced-by-reading-the-actual-code findings (not generic domain advice); Pitfall 1 in particular is a load-bearing correction to a locked CONTEXT.md decision that the planner must not skip

**Research date:** 2026-10-03
**Valid until:** This research is tied to the exact commit state of `zoho-middleware/routes/pos.js`,
`apps-script/adminApi.gs`, and the Phase 83 lib modules as of 2026-10-03. Re-verify the exact line
numbers cited (pos.js confirm chain, adminApi.gs function bodies) if significant unrelated changes
land on `main` before this phase is planned/executed — the underlying architectural findings
(Pitfall 1's composite-tx_ref requirement, the backfill shape mismatch, the empty-tab crash) are
structural and will not go stale, but line numbers will drift.
