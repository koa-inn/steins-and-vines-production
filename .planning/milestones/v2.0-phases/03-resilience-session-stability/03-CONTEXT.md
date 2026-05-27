# Phase 03: Resilience & Session Stability

## Goal
The kiosk recovers gracefully from network problems, terminal issues, and session interruptions without leaving staff stranded.

## Success Criteria
1. If the network drops during product load, cart update, or payment, the kiosk shows a clear error message and allows retry -- it never shows a blank screen or spinner that never resolves
2. If the Helcim terminal times out or fails to respond, the kiosk UI returns to a usable state with a clear message (not stuck on "Processing...")
3. PIN login works correctly after page refresh, browser restart, and across multiple sessions without requiring workarounds

## Dependencies
- Phase 1: Catalog & Stock Display (complete)
- Phase 2: Sales Order Integrity (complete)

## Key Context
The old kiosk sale flow used a single long-lived POST /api/kiosk/sale request that pushed to the Helcim terminal, polled for up to 180s, and then created a Zoho invoice -- all in one HTTP request. This caused Railway gateway timeouts and left the UI spinning indefinitely when the middleware connection dropped mid-poll.
