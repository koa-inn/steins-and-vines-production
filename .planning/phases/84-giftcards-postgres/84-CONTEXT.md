# Phase 84: GiftCards → Postgres - Context

**Gathered:** 2026-10-03
**Status:** Ready for planning

<domain>
## Phase Boundary

Gift-card balances move to Postgres with an atomic redeem/reload, closing the money-path defect
that justified v4.9, with a rollback path that loses nothing (DB-03, ROADMAP Phase 84):

- `gift_cards` (`numeric(10,2)` balances, `GC-` text IDs) + append-only `gift_card_transactions`
  (`tx_ref UNIQUE`); redeem/reload/issue/void/adjust are single transactions
- Every gift-card call site goes behind `GIFT_CARDS_STORE`: `routes/gift-cards.js` (next-number,
  lookup, void), the four `pos.js` confirm-chain sites (redeem / issue / update-invoice / reload,
  ~:1709–1790), the two `lookup_gift_card` pre-payment sites (~:740, ~:1402), and kiosk Gift Card
  Management
- Backfill from the `.xlsx` snapshot via the Phase 83 pipeline, balances equal to the cent, zero rejects
- `dual` ≥1 week on production → flip to `postgres`; the production sheet stays a read-only mirror
- New kiosk balance-adjust control (ledgered, attributed) replaces hand-editing the sheet
- Live verification on production: real kiosk sale with a gift card, a lookup, a void

Out of scope: other stores (Phases 85–88), MONEY-03's M15 tax parity, Zoho accounting for adjustments.

</domain>

<decisions>
## Implementation Decisions

### Carried forward (already decided — do not re-open)
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

### Dual window & flip
- **D-01:** In `dual`, Postgres is authoritative for reads and writes; the sheet leg **re-runs the real
  Apps Script ops** fire-and-forget (`issue_gift_card`, `redeem_gift_card`, `reload_gift_card`,
  `void_gift_card`, `update_gift_card_invoice`, with the same `tx_ref`) so the sheet independently
  computes the result. Compare the sheet's returned balance/status with Postgres's and report via
  `dual-write-compare`. Lookups in dual read Postgres; a sheet lookup comparison is at Claude's discretion.
- **D-02:** Flip bar: **≥7 consecutive days in dual AND at least one real-or-scripted instance of each
  op (issue, redeem, reload, lookup, void, adjust) with zero unexplained discrepancies.** If real
  traffic doesn't cover an op, staff run a scripted $1 test-card sequence on production during the
  window (plan provides the runsheet, and the test card is voided/cleaned up afterwards). The owner decides the flip.
- **D-03:** On a discrepancy, sales continue (Postgres stays authoritative) and Sentry alerts. Each
  discrepancy is investigated and recorded in the phase log as *explained* (e.g. sheet lock timeout)
  or *bug*. A bug fix **restarts the 7-day window**; an explained one does not. No auto-rollback.
- **D-04:** After the flip to `postgres`, the sheet mirror switches to **copy state**: a row upsert
  (balance, status, last_updated, invoice number) plus a read-only ledger-row append per transaction,
  fire-and-forget. The Phase 51 Apps Script logic leaves the hot path. This needs new Apps Script mirror
  action(s) and a redeploy (record the rollback version in RUNBOOK). Rollback from `postgres` → `sheets`
  = a documented **ledger-replay runbook step** (Postgres → sheet balances), not just a flag flip.

### Balance-adjust control
- **D-05:** Lives in the existing **kiosk Gift Card Management** screen (Device Settings, Phase 54).
  Kiosk auth is device-token (no staff identity), so staff must **type their name/initials** and the
  ledger row stores `actor_name` (self-reported) + device ID + reason. Server-side validation on
  every field.
- **D-06:** Input is a **signed delta**, not a new total, so concurrent operations can't overwrite each other. Balance may not go
  below $0 (rejected, not clamped). **Active cards only** (voided cards refused). **Required reason** from a
  pick-list: correction / goodwill / refund-to-card / other (+ required note for 'other'). No cap.
  Own `tx_ref` per adjust (idempotent on retry/double-tap).
- **D-07:** The control works only when `GIFT_CARDS_STORE` is `dual` or `postgres`. In `sheets`
  mode it's hidden or explains "edit the sheet". **No new `adjust_gift_card` Apps Script action.**
  The kiosk needs to learn the mode (e.g. a field on an existing gift-card response).
- **D-08:** **No Zoho Books write** for adjustments. The ledger plus sheet mirror is the record, and the
  bookkeeper reconciles liability from it.

### Database-down behaviour
- **D-09:** In `dual`/`postgres`, if the DB is unreachable at pre-payment lookup → **503 before any
  charge** (same as today's Apps-Script-unavailable path in production). No fallback to reading the sheet
  mirror. Non-gift-card sales unaffected.
- **D-10:** Revisits Phase 83 D-02: when **any store is `dual` or `postgres`**, `database:false` makes the
  `gated-deploy.yml` smoke check **fail**. `/health` `status` stays `ok` (no Railway restart loop), and
  a Sentry alert fires on DB-down. In all-`sheets` mode, D-02 behaviour is unchanged.
- **D-11:** If a card is charged and the Postgres redeem/issue/reload then fails, write a **Redis
  pending record keyed by `tx_ref`** + Sentry error + the existing staff-visible
  `gift_card_activation_failed` flag. A replay/reconcile path applies it to Postgres when the DB returns
  (safe via `tx_ref UNIQUE`). The regression test asserts the durable pending record, not just a log line
  (same rule as MONEY-03 H6).

### Backfill & ledger history
- **D-12:** Each card gets an **`opening_balance` ledger row** equal to its snapshot balance, so
  `current_balance = sum(counted ledger rows)` is an invariant the backfill and tests assert. Existing
  Phase 51 `GiftCardTransactions` rows are imported as **historical** (`imported` flag, excluded from the
  sum); their `tx_ref`s are reserved so an old ref can't replay.
- **D-13:** Load **all real certs**, including voided and $0 ones (status kept). Exclude `TEST-*` certs
  (TEST-LEDGER-01 + its 4 probe ledger rows) by an explicit rule reported in the backfill summary.
  The owner deletes them from the sheet separately. Rows with `needs_manual_review` set or an unsettled claim
  are **rejected**, so the owner resolves them before promotion.
- **D-14:** Cert numbers: a Postgres **sequence seeded above the highest backfilled `GC-NNNNNN`**
  suggests the next number. Staff override is kept (pre-printed cards), and `UNIQUE(cert_number)` enforces
  no duplicates. Same kiosk UX. Seed must account for overridden numbers above the sequence.
- **D-15:** Production cutover is **after hours** (store closed, no kiosk sales): snapshot →
  backfill → promote → set `GIFT_CARDS_STORE=dual` → run a **read-only verify script** comparing
  every Postgres balance/status with the live sheet to the cent before opening. Any mismatch → flip
  back to `sheets`, fix, redo. Staging does the same rehearsal first.

### Claude's Discretion
- How the adjust appears on the sheet leg during `dual` (D-01 re-runs real ops, but D-07 adds no
  adjust action): the recommended approach is to map +delta → `reload_gift_card`, −delta → `redeem_gift_card`
  with the adjust's `tx_ref`. Researcher must confirm the Phase 51 actions accept this (status
  checks, notes) without a redeploy. Otherwise fold an adjust into the D-04 mirror redeploy.
- Table/column design beyond the fixed constraints, ledger `type` enum, index choices, the module split
  (e.g. a `lib/gift-card-store.js` facade with sheets/dual/postgres implementations).
- Whether lookups in `dual` also fire a comparison sheet read.
- Replay mechanism for D-11 (extend `lib/reconcile.js` sweep vs a dedicated job).
- Kiosk UI layout of the adjust form (ES5, iPad Safari, match Phase 54 screen patterns).

### Folded Todos
- **`admin-write-attribution-kiosk-middleware.md`** (partial): writes are recorded as
  `kiosk-middleware` instead of a person. Folded **only** for gift-card ledger rows: every Postgres
  gift-card transaction records an actor (typed name for kiosk adjusts per D-05, device/route identity for
  sales, session email where a session exists). The broader admin-proxy/Apps Script attribution fix stays
  in the todo, which remains pending.
- **`giftcard-ledger-empty-tab-crash.md`**: `ensureGiftCardLedgerSheet` throws on an
  existing-but-empty `GiftCardTransactions` tab. The sheet leg still runs these ops throughout `dual`
  (D-01), so fix it in this phase: regression test first, same fix pattern as `ensureWaitlistSheet`
  (Phase 78). Ride the Apps Script redeploy.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Migration plan & research
- `.planning/research/sheets-to-postgres-migration.md` §"Stage 2 — GiftCards (THE migration)" — table design, redeem SQL, dual/flip/rollback, adjust button
- `.planning/research/sheets-to-postgres-migration.md` §1.2 row 1 (GiftCards), lock analysis (~:136–160, `updateGiftCardInvoice` outside the lock), §"Testing" (~:430–450, real Postgres, not an emulator)
- `.planning/notes/sheets-to-postgres-data-conversion.md` — conversion traps (money as float, timestamps, `''` vs NULL, string booleans)
- `.planning/research/PITFALLS.md`, `.planning/research/ARCHITECTURE.md` — milestone research

### Requirements & roadmap
- `.planning/ROADMAP.md` §"Phase 84: GiftCards → Postgres" — goal + 4 success criteria
- `.planning/REQUIREMENTS.md` — DB-03; MONEY-03 (M9/M18 closed structurally by typed columns)

### Prior phases
- `.planning/phases/83-postgres-infrastructure/83-CONTEXT.md` — infra decisions D-01..D-17
- `.planning/phases/83-postgres-infrastructure/83-VERIFICATION.md` and the 83 SUMMARYs — what `lib/db.js`, `store-flag.js`, `sheet-mirror.js`, `dual-write-compare.js` and the backfill pipeline actually expose
- `.planning/phases/51-gift-card-ledger-integrity/` (esp. `51-03-SUMMARY.md`) — Sheets-side ledger, D-12 idempotency, `needs_manual_review`, live probe data, TEST-LEDGER-01
- `.planning/phases/54-gift-card-management-on-the-kiosk-surface/` (D-54-01) — the screen the adjust control extends
- `.planning/phases/44-kiosk-gift-card-certificate-lifecycle/`, `.planning/phases/45-security-and-money-path-hardening-audit-critical-and-high/` — gift-card lifecycle and confirm-chain activation (D-12 `gift_card_activation_failed`)

### Code
- `zoho-middleware/routes/gift-cards.js` — next-number (cached), lookup (never cached, T-52-M8b), void
- `zoho-middleware/routes/pos.js` ~:720–790 and ~:1386–1410 (pre-payment lookups), ~:1700–1850 (confirm chain)
- `apps-script/adminApi.gs` ~:4600–5330 — GiftCards / GiftCardTransactions functions, `generateNextId` (~:1610)
- `zoho-middleware/lib/{db,store-flag,sheet-mirror,dual-write-compare,reconcile,money-path,sentry-capture}.js`
- `kiosk.html` + kiosk gift-card management JS (Device Settings section)

### Deploy & operations
- `docs/RUNBOOK.md` — add GIFT_CARDS_STORE flip, after-hours cutover, verify script, ledger-replay rollback
- `.github/workflows/gated-deploy.yml` — smoke check `.redis` jq; extend for D-10
- `CLAUDE.md` — regression test first, full suites before commit, staging first

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `lib/store-flag.js`: `GIFT_CARDS_STORE` already registered in `STORE_ENV_NAMES`.
- `lib/sheet-mirror.js`: production-only gate for every sheet-leg call (D-01/D-04).
- `lib/dual-write-compare.js`: never-throw comparator, normalises numeric strings/2-dp money, `reportValuesFor` for balances.
- `lib/db.js`: `query()` / `withTransaction(fn)` for the atomic ops.
- `lib/money-path.js` + `lib/reconcile.js`: Redis pending-record + sweep patterns for D-11.
- Phase 83 backfill pipeline + Testcontainers harness (now postgres:18-alpine, commit 092b0a4f).

### Established Patterns
- Pre-payment lookup is a discriminated `{state: ok|invalid|unavailable}` and fails closed in production → keep the shape and swap the source.
- Post-payment gift-card steps never fail the paid sale; they set `gift_card_activation_failed` and log CRITICAL.
- Lookup balances are never cached; next-number is cached (cache must not hand out a sequence value twice → re-evaluate with the sequence).
- CommonJS Node 20 middleware; ES5 frontend; `npm run build` after any `js/modules` change.

### Integration Points
- `pos.js` direct `axios.post(APPS_SCRIPT_URL, …)` calls (not `callAppsScript`) at the confirm chain and lookups: all must route through one gift-card store facade.
- `/health` + `gated-deploy.yml` for D-10.
- Kiosk Gift Card Management UI + a new adjust endpoint (KIOSK_ROUTES tier, device/session).
- `adminApi.gs`: empty-tab fix + post-flip mirror action(s) → Apps Script redeploy.

</code_context>

<specifics>
## Specific Ideas

- Gift-card volume is low (Phase 51 found no live certs at deploy), so plan the scripted $1 test-card runsheet up front. It's how D-02's "each op" bar gets met.
- Phase 83 gap-closure code is still staging-only. The production push must happen before any production dual window.
- The live production verification (sale + lookup + void) also clears Phase 51's outstanding Step 8 regression sweep.

</specifics>

<deferred>
## Deferred Ideas

- Zoho Books journal entries for balance adjustments (D-08), as a future accounting phase if the bookkeeper wants it.
- Admin-page (Google-session, verified identity) adjust control, a possible later addition alongside the kiosk.
- Full staff attribution across admin-proxy/Apps Script writes: remains in `admin-write-attribution-kiosk-middleware.md`.

### Reviewed Todos (not folded)
- `brewpad-writes-retry-once.md`, `ga4-staging-pollutes-prod-property.md`, `gated-deploy-branch-unsafe.md`, `kiosk-cash-tender.md`, `kiosk-customer-autoclear-after-sale.md`, `kiosk-manual-card-entry-moto.md`, `kiosk-sale-requires-refresh-recurring.md`, `kiosk-terminal-charge-lag.md`, `kit-inventory-bad-price-row.md`: these matched on generic keywords only and are unrelated to the gift-card store.

</deferred>

---

*Phase: 84-giftcards-postgres*
*Context gathered: 2026-10-03*
