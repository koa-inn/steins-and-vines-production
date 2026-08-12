---
title: Kiosk — card reader sometimes doesn't receive the charge until staff cancel; investigate what bogs down the terminal push
status: pending
created: 2026-08-11
source: owner ticket (2026-08-11) — "Sometimes the card reader isn't picking up the transaction request and then does when I cancel"
area: kiosk / money path / Helcim terminal
priority: high
---

## Symptom (owner-reported)

Staff start a kiosk payment; the physical card reader doesn't prompt for the card. When
staff cancel on the kiosk, the reader THEN receives/processes the request. Intermittent.

## Where the code lives

- Client: `js/kiosk-core.js` ~2600-2812 — payment screen, cancel button wiring
  ("Phase 44: Before terminal push, Cancel just returns to browse"), `cancelled`/`saleCompleted`
  guards, terminal push + poll start (~2812).
- Middleware: `zoho-middleware/routes/pos.js` `/api/kiosk/sale` → `processSale` →
  `processSaleWithPrices` — NOTE the pre-charge pipeline that runs BEFORE the terminal push:
  idempotency lock, catalog cache read (+ possible one-shot `rebuildKioskCatalog` on a cache
  miss — a full Zoho refetch, seconds), gift-card real-balance Apps Script lookup (12s timeout),
  pre-charge total assertion, and (verify exact order) Zoho invoice creation. Then
  `zoho-middleware/lib/helcim.js` `terminalPurchase` (~200) pushes to the device and
  `pollTerminalResult` (~239) waits on webhook-cache-then-poll.

## Leading hypotheses (NONE confirmed — instrument first)

1. **The pre-push pipeline is the lag.** If the catalog cache is cold (30-min TTL) the server
   does a full Zoho rebuild before the terminal ever hears about the sale — the reader looks
   "dead" for many seconds. Cancel + retry then hits the warm cache and the push lands
   instantly, matching the owner's "works when I cancel" observation (it's really
   "works on the retry").
2. **Slow Helcim push or device session staleness** — the push request itself queues on
   Helcim's side or the device connection needs a nudge.
3. **Client-side wait/ordering** — the kiosk shows the "waiting for card" state before the
   server has actually issued the push, so all server latency reads as reader failure.

## What discriminates: timing instrumentation

Add timestamped logs (or extend the existing `kiosk.*` telemetry events) around each stage of
`processSale`: lock-acquired → catalog-read (hit/miss/rebuild!) → gc-lookup → assertion →
invoice-created → terminal-push-sent → first-poll/webhook. One slow-case log answers this
definitively. Do NOT guess-fix (see kiosk-sale-requires-refresh-recurring.md for why).

## Danger note

Cancel-then-retry against a push that eventually lands is a potential DOUBLE-CHARGE window —
verify the idempotency key + `moneyPath` void handling covers "cancelled on kiosk but the
reader completed the original push". If that window exists, this is a money bug, not a UX bug.
