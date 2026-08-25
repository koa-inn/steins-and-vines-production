---
title: Remove dead beer-waitlist handler + test (WR-02 follow-up)
status: pending
created: 2026-08-25
source: phase 72 code review (72-REVIEW.md, finding WR-02)
area: frontend / cleanup
priority: low
---

## What

Phase 72 removed the homepage "Beer Is Coming" waitlist form and its hidden
iframe (72-02), but — per the 72-01 plan's explicit instruction — left the
JS handler in place. It is now dead code shipped in every page bundle:

- `js/modules/12-checkout.js:1689-1712` — `setupBeerWaitlistForm()` (guarded no-op; its target elements no longer exist on any page)
- `js/modules/13-init.js:376` — the unconditional call to `setupBeerWaitlistForm()`
- `tests/frontend/checkout-waitlist.test.js` — still fully tests the dead handler

## Why deferred

The 72-01 plan said "Do NOT delete the waitlist handler code from js/modules —
only the homepage markup is removed." So retaining it during phase 72 was
correct/intentional. This is a clean-up follow-up, not a phase-72 defect.

## How to apply

1. Delete `setupBeerWaitlistForm()` and its call site.
2. Delete (or repurpose) `tests/frontend/checkout-waitlist.test.js` — note
   CLAUDE.md rule #10: removing a test that exercises now-deleted code is
   legitimate here, but confirm no other behavior depends on it first.
3. `npm run build`, `npm run lint`, `npm test` — all green.
4. Grep the repo for any remaining `beer-waitlist` references before finishing.
