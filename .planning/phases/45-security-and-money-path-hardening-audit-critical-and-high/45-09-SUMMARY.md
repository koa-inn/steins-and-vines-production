---
phase: 45-security-and-money-path-hardening-audit-critical-and-high
plan: "09"
subsystem: money-path
tags: [money-path, uat, live-card, gift-card, split-tender, checkpoint, d16, d17]
dependency_graph:
  requires: [45-05 money-path lib, 45-06 pos hardening, 45-07 gift-card split-tender, 45-08 reconcile backstop, Phase 44 gift-card lifecycle]
  provides: [live-card-uat-signoff, F1-F7-findings, manual-confirm-verification]
  affects: [zoho-middleware/routes/pos.js, zoho-middleware/routes/gift-cards.js, js/kiosk.js, js/admin.js]
tech_stack:
  added: [tests/frontend/admin-gift-card-mgmt.test.js]
  patterns: [verify-before-book, fail-closed-409, mock-mirrors-real-contract, test-first-bugfix]
key_files:
  created:
    - .planning/phases/45-security-and-money-path-hardening-audit-critical-and-high/45-09-UAT-FINDINGS.md
    - tests/frontend/admin-gift-card-mgmt.test.js
  modified:
    - zoho-middleware/routes/pos.js
    - js/kiosk.js
    - js/kiosk.min.js
    - js/admin.js
    - js/admin.min.js
decisions:
  - "F2: manual-confirm is server-verified via pollTerminalResult(reference_number) before booking — approved→real Helcim id, declined→400, unverifiable→409 fail-closed (45-08 sweep settles genuine orphans)"
  - "F2: manual-confirm button reveal tied to POLL_TIMEOUT_MS (45s), not 15s — a real card-present approval takes ~21s"
  - "F3: exempt custom lines carry ZOHO_TAX_ZERO_ID (109900000000014433) in both sale+confirm builders so Zoho cannot default-tax them"
  - "F7: admin kgcm modal routes through kioskMwUrl() and consumes the nested {ok,data:{current_balance,...}} lookup contract"
  - "Lesson reaffirmed (F1, F7): derive test mocks from a real captured response/contract, never from the code under test"
  - "Ops discovery: Railway auto-deploys from koa-inn/steins-and-vines-production on zoho-middleware/** — a prod force-push IS a middleware deploy"
metrics:
  duration: "3 live sessions (2026-06-30, 2026-07-01 investigation, 2026-07-02 completion)"
  completed: "2026-07-02"
  tasks_completed: 8
  tasks_total: 8
  files_changed: 7
---

# Phase 45 Plan 09: Live Gift-Card + Money-Path UAT (D-16/D-17 checkpoint) Summary

Live-card UAT on the production kiosk → Railway middleware → Helcim terminal → Zoho, covering the Phase 44 gift-card lifecycle and the Phase 45 money-path hardening. **All 8 steps pass** (step 7 covered-by-test). The UAT surfaced 7 findings (F1–F7); the four defects (F1, F2, F3, F7) were fixed test-first and live-verified within the UAT window; the two UX findings are filed as issues #108/#109; one observability note recorded.

## UAT scorecard

| Step | What | Result |
|------|------|--------|
| 1 | Issue cert (cart+terminal) | ✅ INV-000127 $10, no tax at sale, cert active |
| 2 | Balance lookup | ✅ $10 |
| 3 | Reload (cart+terminal) | ✅ INV-000128 $5, balance $10→$15 |
| 4a | Partial redeem (split tender) | ✅ booked (surfaced F2/F3, both fixed+verified) |
| 4b | Full redeem | ✅ `gift_card_only` path, terminal skipped, INV-000132 |
| 5 | Void certificate | ✅ (after F7 fix) GC-000001 voided with reason |
| 6 | Over-balance clamp | ✅ server clamped $20→$8 real balance, terminal charged exact $2 remainder, INV-000133 dual-payment |
| 7 | Redeem-failure → needs_manual_review | ✅ covered-by-test (not safely reproducible on live money) |
| 8 | Double-tap idempotency | ✅ UI guard + live same-key duplicate POST answered by idempotent replay in 15ms, no second push |

## Findings (full detail in 45-09-UAT-FINDINGS.md)

- **F1** (High, fixed `51f3c64`): balance validation read `balance` instead of `current_balance` → 503 blocked all redemptions.
- **F2** (High, fixed `d8bf965`+`e029108`): premature manual-confirm race (button at 15s vs ~21s real approval) + `/confirm` booked card payments on trust with the literal `manual-confirm` as txn id. Fix: 45s reveal + server-side verify-before-book. **Live-verified on all three confirm paths** (auto ~12s real id; no-charge manual → 409 nothing booked; slow-customer manual → real id `50915774` booked).
- **F3** (High, fixed `97e8124`, pre-existing Phase 43): exempt custom lines carried no tax_id → Zoho default-taxed them (phantom GST, partially-paid invoices). Live-verified: INV-000131 books `Zero Rate (0%)`, `tax_total: 0`.
- **F4** (UX): cart re-sync bounces staff off payment → issue #108.
- **F5** (observability): Helcim refund webhooks indistinguishable from purchases in logs → follow-up.
- **F6** (UX): double-tap falls through to the control under the vanished button → issue #109.
- **F7** (High, fixed `f057094`): admin gift-card management modal entirely dead — `SHEETS_CONFIG.MW_URL` (nonexistent key), response read one level too shallow, `balance` vs `current_balance`. Regression `admin-gift-card-mgmt.test.js` (RED→GREEN); live-verified lookup + void.

## Commits

| Hash | Type | Description |
|------|------|-------------|
| 51f3c64 | fix(45-09) | F1 — gift-card balance validation reads current_balance |
| d8bf965 | fix(45-09) | F2 — verify manual-confirm against Helcim before booking |
| e029108 | fix(45-09) | F2 — delay kiosk manual-confirm reveal to poll timeout |
| 97e8124 | fix(45-09) | F3 — tag exempt custom lines with ZOHO_TAX_ZERO_ID |
| f057094 | fix(45-09) | F7 — admin gift-card mgmt modal config key + response shape |
| 20b10e2 | docs(45-09) | UAT COMPLETE — findings, verification evidence, cleanup ledger |

## Deviations from Plan

- The plan expected a single UAT session; it ran as three (pause after 4a to root-cause F2/F3 before re-charging the owner's card — correct call, both were real money-path defects).
- Step 8's physical double-tap could not reach the server (UI hides the button on first tap); the idempotency assertion was made instead with a controlled same-key duplicate POST against prod — a stronger probe. This surfaced F6.
- Step 5 was unexecutable until F7 was found and fixed mid-session (test-first, deployed, re-verified within the UAT window).

## Verification Results

- Middleware suite: 1122 green (pre-deploy re-run). Frontend: 931 green (928 + 3 new F7 regressions). Lint: 0 errors.
- Zoho evidence: INV-000131 (`tax_total:0`, payment ref `50913349`), INV-000132 (GC-only), INV-000133 ($8 GC + $2 card split), INV-000134 (manual-confirm books real id `50915774`). Gift-card accounts reconcile with the D-04 manual-deferral design.
- Cleanup ledger recorded in 45-09-UAT-FINDINGS.md (owner: refund $3 remaining; reverse 7 test invoices; dismiss one false-alarm manual-review flag).

## Known Stubs

None. Follow-ups (non-blocking) are enumerated in 45-09-UAT-FINDINGS.md §Follow-ups.

## Self-Check: PASSED

- [x] All 8 UAT steps pass (7 covered-by-test)
- [x] F1/F2/F3/F7 fixed test-first, deployed to prod, live-verified
- [x] F4/F6 filed as issues #108/#109
- [x] 45-09-UAT-FINDINGS.md complete with evidence, cleanup ledger, follow-ups
- [x] Suites green (mw 1122 / fe 931 / lint 0 errors)
