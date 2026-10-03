# Phase 84 — GiftCards Dual-Window Log

Owner-maintained log for the `GIFT_CARDS_STORE=dual` window (D-01/D-02/D-03). See
`docs/RUNBOOK.md` § "Gift cards → Postgres (Phase 84)" for the full procedure this log
supports. No balances, no customer names — cert numbers and classifications only.

## Header

| Field | Value |
|-------|-------|
| Environment | _(staging / production)_ |
| `GIFT_CARDS_STORE=dual` set at | _(timestamp)_ |
| Window day 1 date | _(date)_ |
| Current window start (resets to day 1 on any bug-classified discrepancy) | _(date)_ |

## Op-coverage table

One row per op. "First seen at" is the first time this op ran (real traffic or the §5
scripted $1 test-card runsheet) during the CURRENT window (resets alongside "Current window
start" above). "Sentry clean?" is yes only if zero unexplained discrepancies were raised for
that op during the current window.

| Op | First seen at | Real or scripted | Sentry clean? |
|----|----------------|-------------------|----------------|
| issue | | | |
| redeem | | | |
| reload | | | |
| lookup | | | |
| void | | | |
| adjust | | | |

## Discrepancy table

One row per Sentry `dual-write giftcards.<op> discrepancy` event or manually-found mismatch.
Every row must be classified before the flip bar can be considered met.

| Date/time | Sentry event link | Op | Cert | Classification (explained/bug) | Root cause | Fix commit | Window restarted? |
|-----------|--------------------|----|------|----------------------------------|-------------|-------------|--------------------|
| | | | | | | | |

## Flip-decision block

Filled in once the §4/§6 flip bar (≥7 consecutive days, all six ops observed, zero
unexplained discrepancies) is met and the owner decides to flip to `postgres`.

| Field | Value |
|-------|-------|
| Owner | |
| Date | |
| Decision | |

---
*Phase: 84-giftcards-postgres*
*Template created: 2026-10-03 (Plan 84-09)*

## Staging rehearsal

| Step | Date | Outcome |
|------|------|---------|
| 1. Staging push | 2026-10-03 | Owner-approved `git push origin main` → `4e8432df`. Railway staging deploy `15ed5589` SUCCESS; pre-deploy log shows `0002_gift_cards` applied ("Migrations complete!") — `npm run migrate` chains migration-guard → migration-allowlist → node-pg-migrate with `&&`, so both guards passed (closes Phase 83's "first observed guard-chain log" item). `/health`: status ok, database:true, database_required:false (store mode `sheets`, expected before step 4). Startup log: `store modes: {"GIFT_CARDS_STORE":"sheets"}`, gift-card pending sweep registered. CI: test-frontend, test-middleware, artifact-drift pass; test-e2e fails (pre-existing since ≥2026-09-23, not part of the gated deploy). |
| 2. Apps Script redeploy | 2026-10-03 | Owner pasted `apps-script/adminApi.gs` @ `2881c74c` into the live project ("SV Website", the Sep-24 project `1uD14PTT…`; the Oct-1 same-named project has no deployment). Pre-paste editor copy was byte-identical to the repo's pre-84-02 file (sha256 `dd32ba55…`); post-paste matches HEAD (`344966b3…`). Deployment `AKfycb…DI968g` (shared by staging + production middleware) updated **58 → 59** at 14:08. Rollback = 58. Production `/health` ok after deploy. Probes (owner, 14:37): `setupGiftCardLedger` → "GiftCardTransactions tab ready (12 columns)." with no error; production kiosk lookup of the sheet's only card returned the correct data (sheets mode, v59). |
| 3. Staging backfill (dry-run → promote) | 2026-10-03 | Snapshot: workbook "STEINS AND VINES" (`10BzcANc…`, bound to the live `1uD14PTT…` project) exported 14:11, kept outside the repo in `~/sv-backfill/`. Over the Railway SSH tunnel: dry-run → 0 rejects; read 1 card / 0 ledger rows; 0 TEST-* excluded; total balance $0.00; seq seed 1; unmapped headers `issued_date`, `last_tx_ref` (not needed). The live sheet genuinely holds a single `void` $0 card and an empty `GiftCardTransactions` tab. Owner approved promote → "Promoted 1 cards, 1 ledger rows; sequence at 1" (in-transaction invariants passed). |
| 4. GIFT_CARDS_STORE=dual on staging | 2026-10-03 | Set via Railway CLI (staging `sv_middleware` only). After redeploy `/health`: status ok, database:true, database_required:true. Production unchanged (no GIFT_CARDS_STORE → sheets). |
| 5. gift-cards-verify (0 mismatches) | 2026-10-03 | Fresh export 14:20 → `gift-cards-verify.js`: "Verified 1 cards: 0 mismatches". Tunnel closed afterwards. Note: the staging Postgres password was printed once in the session transcript during tunnel setup — rotate it after the rehearsal. |
