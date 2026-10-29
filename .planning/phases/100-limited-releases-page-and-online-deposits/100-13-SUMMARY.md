---
phase: 100-limited-releases-page-and-online-deposits
plan: 13
subsystem: ops / staging verification
tags: [runbook, staging, deposits, kiosk, helcim, zoho]
requires: [100-01, 100-02, 100-03, 100-04, 100-05, 100-06, 100-07, 100-08, 100-09, 100-10, 100-11, 100-12]
provides: [staff runbook for limited-release deposits, live staging proof of deposit + brew-day path, owner sign-off]
key-files:
  created:
    - .planning/phases/100-limited-releases-page-and-online-deposits/100-STAGING-RUN.md
    - zoho-middleware/__tests__/kiosk-salesorders-limited-due.test.js
    - tests/frontend/kiosk-limited-release-card.test.js
  modified:
    - docs/RUNBOOK.md
    - zoho-middleware/routes/pos.js
    - js/kiosk-core.js
    - js/kiosk-core.min.js
    - css/kiosk.css
    - css/kiosk.min.css
    - kiosk.html
    - admin.html
decisions:
  - "Owner approved deposit wording as written (page, refunds §D, terms §9)"
  - "Owner declined lawyer review of 'non-refundable' — launch as is (accepted risk)"
  - "Kiosk SO card must show the deposit-aware remainder and hide Import to Cart for LIMITED SOs (found live; fixed before the brew-day payment)"
metrics:
  completed: 2026-10-29
---

# Phase 100 Plan 13: Runbook, staging deploy and owner staging run — Summary

Runbook written, everything deployed to staging with deposits switched on there only, and the owner ran the real-money rehearsal end to end: a $50 one-kit deposit, a $150 three-kit deposit across both collections, and a live brew-day terminal payment that applied the $50 advance and charged the remainder. Everything was voided/deleted afterwards and the owner signed off.

## Task 1 — Runbook and staging deploy

- `d3a5dfad` docs(100): runbook for limited-release deposits — "## Limited Release deposits (Phase 100)", 11 numbered procedures, before "Phase 46 Auth Cutover".
- `d87afd12` chore(100): build for staging deploy (restamped pages + admin.js).
- Pushed to `origin main` (staging repo) only; Railway staging deploy SUCCESS.
- `PREORDER_DEPOSITS_ENABLED=true` set on staging (`sv_middleware`, `-e staging`); **not set on production** (listing of 82 production variables confirmed absence).
- Smoke: staging site returns 403 (Cloudflare Access, same as other staging pages); staging middleware `/health` 200; `POST /api/preorder/initialize` with empty basket → 400 "Choose at least one kit".

## Task 2 — Owner staging run

See `100-STAGING-RUN.md` for the step-by-step record and cleanup ledger. Outcome: Steps 1–6 complete; Step 4 passed **live** (INV-000255 paid, deposit unused 50 → 0 via credits, terminal $202.85, exactly one batch SV-B-000249); cleanup ledger has no open rows; owner sign-off recorded.

## Deviations

### Auto-fixed issue found during the run (Rule 1 — bug)

**Kiosk SO card showed the full SO total for limited-release SOs, and offered Import to Cart.**
- Found during: Step 4 (owner saw "Collect $252.85" and stopped; no charge taken).
- Issue: Plan 09 added the badge and an in-flow preview, but the card amount/button still showed the full total, and Collect pushes straight to the terminal — so staff would see the wrong amount before charging. Import to Cart routes through the non-deposit-aware cart and would charge full price.
- Fix: `7de27d49` (middleware list adds `deposit_held` / `amount_due` for actionable LIMITED SOs via `computeSalesOrderAmountDue`, sequential, failure-tolerant) and `fb6882ca` (card shows the remainder with "$50.00 deposit applied · total …" or "Deposit applied at payment"; Import to Cart hidden for LIMITED SOs; badge styling). Regression tests written first and seen failing.
- Verified live: terminal asked for $202.85 after the fix.

### Other
- Staging-container script path: repo root is `/app`, middleware at `/app/zoho-middleware`, service `sv_middleware`.
- Owner's pre-existing test contact "test" (CUS-00052) was kept.

## Follow-ups
1. UI polish pass on `limited-releases.html` and the confirmation/emails ("SO SO-" duplicate, confirmation panel alignment, heading scale, general formatting) — owner request.
2. Decline path in the page payment flow not exercised live.

## Self-Check: PASSED
- `100-STAGING-RUN.md` has Steps 1–6 and an "Owner sign-off" line.
- Commits d3a5dfad, d87afd12, 7de27d49, fb6882ca exist on main and on origin/main.
