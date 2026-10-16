---
phase: 84-giftcards-postgres
plan: 12
subsystem: giftcards
tags: [dual-window, flip, production]
requires: [84-11]
provides: [production GIFT_CARDS_STORE=postgres with the sheet as copy-state mirror]
metrics:
  completed: 2026-10-16
---

# Phase 84 Plan 12: Dual window, flip and live verification Summary

- **Window:** 2026-10-06 → 2026-10-16, ten days with no restart. Real traffic was a single lookup, so the RUNBOOK §5 $1 cash runsheet covered issue, redeem, reload, adjust (±0.25) and void on GC-000002. Ledger, sheet and Zoho all agreed.
- **Defect found:** `ZOHO_GIFT_CARD_CLEARING_ACCOUNT_ID` was unset in both environments. Phase 52 removed the hardcoded fallback, so kiosk gift-card redemption had been fail-closed (503) since then. The env var was set to 109900000000873231 ("Gift Card Redemptions") on prod and staging. This is classified as a configuration gap, not a dual-write discrepancy.
- **Flip:** the owner checked Sentry (clean) and chose to flip. `GIFT_CARDS_STORE=postgres` was set 2026-10-16 18:22:14Z during opening hours with the kiosk idle. Startup confirmed `GIFT_CARDS_STORE: postgres`.
- **Post-flip checks:**
  - `gift-cards-verify.js` against a fresh snapshot: "Verified 2 cards: 0 mismatches". It ran inside the production container, so the DB URL never left Railway.
  - Mirror-write proof: GC-000003 issue + void landed in the sheet within about 3 seconds.
- **Cleanup:** the runsheet and mirror-test invoices INV-000242 to INV-000245 and their payments were deleted in Zoho. GC-000002 and GC-000003 remain void as test records.
- **Apps Script:** v65 active (it carries `mirror_gift_card_state`), rollback v64. A store rollback now requires the ledger-replay procedure (RUNBOOK §8).

## Deviations from Plan
- The flip happened during opening hours rather than after hours (owner decision: kiosk idle, zero real gift-card traffic).
- The verify ran in the production container instead of over the owner's tunnel. `railway connect` from zoho-middleware/ reported "No supported database found in service".
- Step 4's "real kiosk sale paid partly with a gift card" is covered by the pre-flip runsheet redeem (INV-000243) plus the post-flip GC-000003 write. A first real customer redemption after the flip has not happened yet.

## Self-Check: PASSED
