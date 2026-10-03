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
| 2. Apps Script redeploy | — | pending (owner) |
| 3. Staging backfill (dry-run → promote) | — | pending (owner) |
| 4. GIFT_CARDS_STORE=dual on staging | — | pending (owner) |
| 5. gift-cards-verify (0 mismatches) | — | pending (owner) |
