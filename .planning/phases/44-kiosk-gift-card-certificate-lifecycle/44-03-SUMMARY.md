---
phase: 44-kiosk-gift-card-certificate-lifecycle
plan: "03"
subsystem: middleware
tags: [gift-cards, zoho-books, apps-script, kiosk, rate-limiting, atomic-safety]

requires:
  - phase: 44-02
    provides: "7 server_token-gated Apps Script actions + GiftCards sheet (balance-of-record)"

provides:
  - "POST /api/kiosk/gift-card/issue — fail-closed, zero-tax, void-on-Zoho-failure"
  - "GET /api/kiosk/gift-card/lookup — server-authoritative balance (D-05)"
  - "GET /api/kiosk/gift-card/next-number — suggested GC-NNNNNN from Apps Script"
  - "Router mounted in server.js; issue route rate-limited via paymentLimiter"
  - "21-test suite covering all behaviors (503/409/400/502/201/200/404)"

affects:
  - "44-04 (redeem route: split-tender lookup uses GET /api/kiosk/gift-card/lookup)"
  - "44-05 (reload route: mirrors issue pattern; same Apps Script POST pattern)"
  - "44-06 (UI: consumes all three routes — shapes documented below)"

tech-stack:
  added: []
  patterns:
    - "callAppsScript(action, payload) helper: axios.post to APPS_SCRIPT_URL; all 7 gift-card actions are in doPost dispatch (not doGet)"
    - "Zero-tax invoice line: omit tax_id; item's EXEMPT setting produces tax_total=0 (44-01 Probe B confirmed)"
    - "Void-on-Zoho-failure: issue_gift_card Sheets row created first; any zohoPost rejection triggers void_gift_card(reason:'zoho_invoice_failed') fire-and-forget, then 502"
    - "Fail-closed 503 at request time: check process.env.KIOSK_GIFT_CARD_ITEM_ID at route entry, not at startup"
    - "Test harness: jest.resetModules() + handler extraction mirrors pos-custom-line.test.js"

key-files:
  created:
    - "zoho-middleware/routes/gift-cards.js (238 lines)"
    - "zoho-middleware/__tests__/gift-cards.test.js (445 lines, 21 tests)"
  modified:
    - "zoho-middleware/server.js — added paymentLimiter for /api/kiosk/gift-card/issue + router mount"

key-decisions:
  - "Zero-tax mechanism: NO tax_id on invoice line — item's own 0%/EXEMPT (KIOSK_GIFT_CARD_ITEM_ID) produces tax_total=0 (confirmed 44-01 Probe B; ZOHO_TAX_ZERO_ID not used)"
  - "All 7 Apps Script actions use axios.post (not axios.get) — doPost server_token dispatch block handles them all (44-02 deployment confirmed)"
  - "callAppsScript is module-internal (not exported); tested via route handler tests with jest.mock('axios')"
  - "lookup and next-number routes are NOT rate-limited (read-only); only issue is money-path"

requirements-completed: [GIFTCARD-01]

duration: ~30min
completed: "2026-06-28"
---

# Phase 44 Plan 03: Gift Card Middleware — Issue + Lookup + Next-Number Summary

**Issue/lookup/next-number routes shipped: fail-closed 503, zero-tax Zoho invoice, void-on-Zoho-failure, server-authoritative balance; 21 tests green (998 total, 44 suites).**

## Performance

- **Duration:** ~30 min
- **Started:** 2026-06-28
- **Completed:** 2026-06-28
- **Tasks:** 3 (Task 1: route file, Task 2: server.js mount, Task 3: test suite)
- **Files created:** 2 (gift-cards.js, gift-cards.test.js)
- **Files modified:** 1 (server.js)

## Accomplishments

- Created `zoho-middleware/routes/gift-cards.js` (238 lines) with three routes (POST issue, GET lookup, GET next-number) and a shared `callAppsScript` helper.
- Zero-tax mechanism confirmed and hardcoded: no `tax_id` on the invoice line; KIOSK_GIFT_CARD_ITEM_ID's own EXEMPT setting is sufficient (44-01 Probe B).
- Void-on-Zoho-failure implemented: issue_gift_card Sheets row is created first; if any zohoPost call throws after that, `void_gift_card(reason:'zoho_invoice_failed')` is called fire-and-forget, then 502 is returned — no orphan cert.
- Fail-closed guard at request time: `if (!process.env.KIOSK_GIFT_CARD_ITEM_ID) return res.status(503)` is the very first check in the issue handler, before any Sheets or Zoho call.
- Mounted in `server.js` with `paymentLimiter` on the issue money-path (lookup and next-number are read-only, not rate-limited).
- 21-test suite added; full middleware suite green: 998 tests, 44 suites, 0 errors, 58 pre-existing warnings.

## Task Commits

1. **Task 1: routes/gift-cards.js** — `a1cc9f6` (feat)
2. **Task 2: server.js mount + rate-limit** — `e8148dd` (feat)
3. **Task 3: gift-cards.test.js** — `e4d886d` (test)

**Plan metadata:** (this commit)

## API Shapes (for 44-06 UI)

### POST /api/kiosk/gift-card/issue

**Request:**
```json
{ "cert_number": "GC-000042", "face_value": 100, "issued_by": "kiosk", "notes": "" }
```

**Response 201:**
```json
{ "ok": true, "cert_number": "GC-000042", "face_value": 100, "zoho_invoice_number": "INV-001234" }
```

**Error responses:**
- `503` — KIOSK_GIFT_CARD_ITEM_ID not set (fail-closed)
- `409` — cert_number already exists
- `400` — cert_number not matching /^GC-\d{6}$/ or face_value not in (0, 2000]
- `502` — Zoho invoice/payment failed (Sheets row voided before returning)

### GET /api/kiosk/gift-card/lookup?cert_number=GC-NNNNNN

**Response 200:**
```json
{ "ok": true, "data": { "current_balance": 50, "status": "active", "face_value": 100 } }
```

**Error responses:**
- `404` — cert not found
- `400` — cert_number format invalid

### GET /api/kiosk/gift-card/next-number

**Response 200:**
```json
{ "ok": true, "suggested": "GC-000042" }
```

## Zero-Tax Implementation Detail

Confirmed and locked (44-01 Probe B, live Zoho verification):

The invoice line posted by the issue route:
```javascript
line_items: [{
  item_id: process.env.KIOSK_GIFT_CARD_ITEM_ID,  // 109900000000873211
  name: 'Gift Certificate GC-NNNNNN',
  quantity: 1,
  rate: face_value
  // No tax_id — item's own 0%/EXEMPT setting produces tax_total=0
}]
```

`ZOHO_TAX_ZERO_ID` is NOT used for gift card invoice lines. The item's own `tax_exemption_code=EXEMPT` is the sole tax mechanism. Downstream plans (44-05 reload) must follow the same pattern.

## Files Created/Modified

- `zoho-middleware/routes/gift-cards.js` (238 lines) — callAppsScript helper + 3 routes
- `zoho-middleware/__tests__/gift-cards.test.js` (445 lines, 21 tests)
- `zoho-middleware/server.js` — 2 lines added (rate-limiter + router mount)

## Decisions Made

- All Apps Script gift-card actions are invoked via `axios.post` (not `axios.get`) because all 7 actions are in the doPost server_token dispatch block (confirmed by 44-02 deployment)
- `callAppsScript` is a module-internal helper; not exported; tested indirectly via route handler tests
- lookup and next-number routes are not rate-limited (no money path, no balance mutation)

## Deviations from Plan

None — plan executed exactly as written. Zero-tax approach (no tax_id) and all Apps Script patterns match the confirmed facts from 44-01 and 44-02.

## Known Stubs

None. All three routes make live Apps Script and/or Zoho calls with no hardcoded placeholder data.

## Threat Flags

No new network endpoints or auth paths beyond what the plan's threat model documents. All three routes are under `/api/kiosk/gift-card/*` which inherits the existing `requireApiKey` and `requireAllowedReferer` guards from server.js line 395-396.

| In-plan coverage | File | Description |
|---|---|---|
| T-44-08 | gift-cards.js:121-124 | face_value bounds validated fail-closed |
| T-44-09 | gift-cards.js:127-130 | cert_number format /^GC-\d{6}$/ enforced |
| T-44-11 | server.js:407 | paymentLimiter on issue route |
| T-44-12 | gift-cards.js:218-228 | void_gift_card on Zoho failure |

## Self-Check: PASSED

- FOUND: zoho-middleware/routes/gift-cards.js
- FOUND: zoho-middleware/__tests__/gift-cards.test.js
- FOUND: commit a1cc9f6 (feat: gift-cards route)
- FOUND: commit e8148dd (feat: server.js mount)
- FOUND: commit e4d886d (test: gift-cards.test.js)
- Full suite: 998 tests, 44 suites, all green

---
*Phase: 44-kiosk-gift-card-certificate-lifecycle*
*Plan: 03*
*Completed: 2026-06-28*
