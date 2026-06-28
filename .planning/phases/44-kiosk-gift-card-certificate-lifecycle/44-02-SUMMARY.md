---
phase: 44-kiosk-gift-card-certificate-lifecycle
plan: 02
subsystem: database
tags: [apps-script, google-sheets, gift-cards, lockservice, idempotency, atomic-writes]

# Dependency graph
requires:
  - phase: 44-01
    provides: "Confirmed Zoho item IDs (KIOSK_GIFT_CARD_ITEM_ID=109900000000873211) and account IDs; env registration"
provides:
  - "GIFT_CARDS_SHEET_NAME='GiftCards' constant in adminApi.gs"
  - "7 server_token-gated Apps Script actions: issue_gift_card, lookup_gift_card, redeem_gift_card, reload_gift_card, void_gift_card, update_gift_card_invoice, get_next_cert_number"
  - "get_gift_cards admin list action (Google OAuth / doGet path)"
  - "GiftCards Google Sheets tab with confirmed 10-column schema as balance-of-record"
  - "Apps Script web app redeployed (new version, same APPS_SCRIPT_URL)"
affects: [44-03, 44-04, 44-05, 44-06, 44-07, 44-08]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "LockService atomicity: acquireScriptLock(15000) + finally{releaseLock()} wraps every balance write (issue/redeem/reload/void)"
    - "Runtime header resolution: headers.indexOf('column_name')+1 for balance writes — robust to column reordering"
    - "last_tx_ref idempotency: repeated transaction_ref returns prior result without re-decrementing (T-44-05)"
    - "generateNextId(GIFT_CARDS_SHEET_NAME,'GC-',6) for cert-number suggestion with uniqueness gate via findRowById"

key-files:
  created: []
  modified:
    - apps-script/adminApi.gs

key-decisions:
  - "Balance-write column resolution is runtime (header name lookup), not hardcoded — only issueGiftCard's appendRow is positionally ordered"
  - "get_gift_cards routed to doGet (Google OAuth / admin panel); all 7 management actions routed to doPost server_token block"
  - "updateGiftCardInvoice has no LockService (write is idempotent — overwriting an invoice number is safe without a mutex)"

patterns-established:
  - "Gift-card action pattern: server_token → handler → acquireScriptLock(15000) → findRowById → guard checks → sheet write → invalidateSheetCache → releaseLock"
  - "Idempotency gate: check last_tx_ref BEFORE any balance modification, return {ok:true,idempotent:true} on match"

requirements-completed: [GIFTCARD-01]

# Metrics
duration: human-action plan (Task 1 code ~20min prior session; Task 2 manual deploy by owner)
completed: 2026-06-28
---

# Phase 44 Plan 02: GiftCards Apps Script Actions + Sheet Setup Summary

**Seven server_token-gated Apps Script actions (issue/lookup/redeem/reload/void/update-invoice/next-cert-number) with LockService atomicity, last_tx_ref idempotency, and a confirmed 10-column GiftCards Google Sheets balance-of-record**

## Performance

- **Duration:** Task 1 code committed in prior session; Task 2 was manual human action (sheet creation + Apps Script redeploy)
- **Started:** 2026-06-28T04:46:22Z (immediately after 44-01 completed)
- **Completed:** 2026-06-28
- **Tasks:** 2 (1 auto code commit, 1 human-action checkpoint)
- **Files modified:** 1 (apps-script/adminApi.gs)

## Accomplishments

- Added `GIFT_CARDS_SHEET_NAME = 'GiftCards'` constant and 7 server_token-dispatched actions to adminApi.gs
- All 4 balance-modifying handlers (issue/redeem/reload/void) wrap writes in `acquireScriptLock(15000)` + `finally { lock.releaseLock() }` (T-44-04 mitigation)
- `redeemGiftCard` implements last_tx_ref idempotency gate before any balance modification (T-44-05 mitigation)
- Owner created GiftCards sheet tab with exact 10-column header, pasted updated adminApi.gs into Apps Script editor, redeployed as new version at same APPS_SCRIPT_URL

## Confirmed GiftCards Column Schema (R-02)

The live GiftCards sheet has exactly these 10 columns in this order. **Downstream plans 44-04 and 44-05 depend on this schema.**

| Col (1-based) | Header               | Notes                                    |
|---------------|----------------------|------------------------------------------|
| 1             | cert_number          | Primary key; GC-NNNNNN format            |
| 2             | face_value           | Original denomination; immutable         |
| 3             | current_balance      | Decremented on redeem, incremented on reload |
| 4             | status               | active / depleted / void                 |
| 5             | issued_date          | ISO date (YYYY-MM-DD)                    |
| 6             | issued_by            | 'kiosk' or staff name                    |
| 7             | zoho_invoice_number  | Written post-issue via update_gift_card_invoice |
| 8             | notes                | Optional; void reason written here       |
| 9             | last_updated         | ISO timestamp of last write              |
| 10            | last_tx_ref          | Idempotency key (Helcim transaction ID)  |

**Column usage in code:**
- `issueGiftCard` appendRow is positionally ordered (must match the above exactly)
- `redeemGiftCard`, `reloadGiftCard`, `voidGiftCard`, `updateGiftCardInvoice` use runtime header resolution (`headers.indexOf('column_name') + 1`) — they are robust to column reordering after initial setup

## Actions Deployed

All 7 actions are server_token-gated (doPost dispatch block) — no Google OAuth path:

| Action                    | Handler                  | Lock | Notes                                              |
|---------------------------|--------------------------|------|----------------------------------------------------|
| `issue_gift_card`         | `issueGiftCard`          | Yes  | Duplicate cert_number rejected; balance = face_value at issue |
| `lookup_gift_card`        | `lookupGiftCard`         | No   | Read-only; returns balance/status/face_value       |
| `redeem_gift_card`        | `redeemGiftCard`         | Yes  | Idempotent on last_tx_ref; 'depleted' if balance=0 |
| `reload_gift_card`        | `reloadGiftCard`         | Yes  | Restores 'active' if was 'depleted'; void rejected |
| `void_gift_card`          | `voidGiftCard`           | Yes  | Only from 'active'/'depleted'; reason in notes     |
| `update_gift_card_invoice`| `updateGiftCardInvoice`  | No   | Idempotent invoice-number write (safe without lock)|
| `get_next_cert_number`    | inline generateNextId    | No   | Returns suggested GC-NNNNNN; cert must still be reserved via issue_gift_card |

`get_gift_cards` (admin list view) is gated under Google OAuth via the doGet switch block (not server_token).

## Cert-Number Format and Generator

Format: `GC-` prefix + 6 zero-padded digits (e.g., `GC-000001`).

Generated by: `generateNextId(GIFT_CARDS_SHEET_NAME, 'GC-', 6)` — reads the GiftCards sheet, finds the highest existing GC-NNNNNN, and returns the next value.

Uniqueness gate: `issueGiftCard` calls `findRowById(GIFT_CARDS_SHEET_NAME, certNum)` inside the `acquireScriptLock(15000)` critical section and rejects with `{ok:false, error:'duplicate'}` if the cert already exists (D-02).

## Apps Script Redeploy Note

Apps Script changes are NOT in CI — this is a permanent project constraint. The updated adminApi.gs was manually pasted into the Apps Script editor and deployed as a **new version** of the existing web app deployment (same APPS_SCRIPT_URL). Future Apps Script changes in this phase (44-08 or later) will require the same manual redeploy step.

## Smoke Test Status

Owner-reported: GiftCards sheet tab created with exact 10-column header; Apps Script redeployed. Explicit `get_next_cert_number → "GC-000001"` result and issue+lookup round-trip were not separately confirmed in writing. **The 44-03 integration test will serve as the authoritative end-to-end check of the deployed actions.**

## Task Commits

1. **Task 1: GiftCards sheet constant + 7 gift-card action handlers** - `2b83d68` (feat)
2. **Task 2: Create GiftCards sheet + manual Apps Script redeploy** - Human action (no commit)

**Plan metadata:** (this commit)

## Files Created/Modified

- `apps-script/adminApi.gs` — Added `GIFT_CARDS_SHEET_NAME`, 7 server_token actions in doPost dispatch, 6 handler functions (`issueGiftCard`, `lookupGiftCard`, `redeemGiftCard`, `reloadGiftCard`, `voidGiftCard`, `updateGiftCardInvoice`), `getGiftCards` doGet action

## Decisions Made

- Runtime header resolution for balance-write columns (not hardcoded positions) — future-proofs against column reordering while keeping `appendRow` in `issueGiftCard` positionally defined
- `updateGiftCardInvoice` deliberately has no LockService — overwriting an invoice number is idempotent (safe to call twice with the same value) and does not involve balance arithmetic
- `get_gift_cards` routed to Google OAuth doGet path (admin panel list view) rather than server_token, following existing batch-tracking list pattern

## Deviations from Plan

None - plan executed exactly as written. Column indices resolved at runtime (not hardcoded positionally) as the code comment notes: the RESEARCH indices were marked [ASSUMED]; the implementation defensively reads the header row instead.

## Issues Encountered

None.

## Next Phase Readiness

- **44-03 (Gift Card Sell — middleware route):** Ready. `GIFT_CARDS_SHEET_NAME`, `issue_gift_card`, `update_gift_card_invoice`, and `get_next_cert_number` actions are live. Middleware must call `POST APPS_SCRIPT_URL {action:'issue_gift_card', server_token, cert_number, face_value}` and then `update_gift_card_invoice` after Zoho invoice creation succeeds.
- **44-04 (Redeem — middleware route):** Ready. `redeem_gift_card` with LockService atomicity + last_tx_ref idempotency is live. Must pass explicit `account_id` for 'Gift Cards Sold' liability account (decision from 44-01).
- **44-05 (Reload):** Ready. `reload_gift_card` is live.
- **44-06 (Admin UI):** Ready. `get_gift_cards` (doGet, Google OAuth) and all management actions are live.
- **Blocker (pre-existing):** Smoke test confirmation is owner-reported only — 44-03's first integration test is the authoritative end-to-end gate.

---
*Phase: 44-kiosk-gift-card-certificate-lifecycle*
*Completed: 2026-06-28*
