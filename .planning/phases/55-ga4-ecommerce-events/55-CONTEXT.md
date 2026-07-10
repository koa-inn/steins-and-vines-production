---
phase: 55-ga4-ecommerce-events
milestone: v4.6
requirement: ANALYTICS-01
captured: 2026-07-10
mode: review-and-ship
source_brief: "Google Drive: 6 Misc/Reports/Claude-Code-Prompt-Ecommerce-Tracking.md (+ Steins-and-Vines-GA4-Purchase-Tracking-Plan.md)"
---

# Phase 55 Context — GA4 Ecommerce Events (review + ship)

## The situation

GA4 (`G-WDYSXCM703`) and GTM (`GTM-NHRCGLC5`) are installed and fire pageviews/clicks,
but the custom JS cart/checkout pushes **no** ecommerce events, so GA4 shows zero revenue
and the `purchase` key event never receives data. The site is custom-coded (not Shopify/
Woo), with two carts (ferment-in-store + ingredients/supplies) taking real payments via
Helcim.

**This phase is a REVIEW-AND-SHIP of code that is ALREADY WRITTEN and sitting uncommitted
in the working tree.** Do NOT re-implement. (Confirmed present in `git status` 2026-07-10.)

## What's already implemented (uncommitted working tree)

- `js/modules/03-events.js` — defensive GA4 dataLayer helpers: `pushEcommerce`, `toGa4Items`,
  `ga4AddToCart`, `ga4BeginCheckout`, `ga4Purchase`. `purchase` dedupes by `transaction_id`;
  all wrapped so analytics can never throw into checkout.
- `js/modules/11-cart.js` (5 add sites) + `js/modules/07-catalog-kits.js` (1 site) —
  `ga4AddToCart(...)` beside each existing `trackEvent('add_to_cart', …)`.
- `js/modules/12-checkout.js` — `begin_checkout` in the initial-submit idempotency block;
  `purchase` in both the single-cart success (`.then(oR)`) and the dual-cart success callback,
  keyed on the real sales-order number / idempotency key.
- `tests/frontend/ga4-ecommerce.test.js` — new unit tests (untracked). Brief states 12 new,
  976 passing.
- Rebuilt bundles (`js/main.js`, `js/main.min.js`, `js/admin.*`) + HTML cache stamps —
  regenerated via `npm run build`.

Per the brief: tests pass, lint clean, build done. Nothing committed or pushed.

## Scope decisions

- **D-55-01 — Review-and-ship, not build.** The plan reviews the diff, re-runs gates, commits,
  ships to staging, verifies in GA4 DebugView, then promotes to prod. No re-implementation.
- **D-55-02 — Money-path safety is the review's #1 job.** `12-checkout.js` is the money path.
  The review must confirm: `purchase` fires only on confirmed Helcim success (single + dual),
  exactly once per order (dedup by `transaction_id`), before carts/idempotency state clear;
  and NO payment/charge/cart logic changed. Analytics wrapped so a throw can't reach checkout.
- **D-55-03 — GTM tags are NOT this phase.** The events are inert until 3 GA4 event tags exist
  in the container — that's Phase 56 (config, non-code). Ship the site events first; they do
  no harm sitting in the dataLayer unconsumed.
- **D-55-04 — Deploy flow per CLAUDE.md.** Staging first (`git push origin main`); prod only
  after staging GA4 DebugView approval, via the blessed/break-glass path as appropriate.

## Open questions for execution

- **OQ-1: Is the `products.html` GTM-snippet fix in the current diff?** The GA4 plan §3.5 flags
  `products.html` as a live page with no GTM container tag. `products.html` IS in the uncommitted
  `git status`. Confirm during review whether the diff adds the GTM snippet there; if not, add it.
- **OQ-2: Do the middleware tests need to run?** No middleware files changed, but CLAUDE.md
  requires both suites green before commit — run both regardless.
- **OQ-3: `transaction_id` source.** Confirm the value used (real sales-order number vs the
  `_checkoutIdempotencyKey`) is genuinely unique-per-order and identical across a retry of the
  same order, so GA4 dedup holds.

## Not in scope (→ Phase 56, or human-action)

- The 3 GA4 event tags + triggers + DLV variables in GTM.
- Conversion Linker tag, Google tag for Ads `AW-18091171314`, marking `purchase` a key event,
  2nd GTM admin, Metricool-tag publish decision (coordinate with RUNBOOK Stage-3 CSP↔GTM ordering).
- Optional `view_item` events (nice-to-have, not written).

## Gates & guardrails (CLAUDE.md)

- Never hand-edit `js/main.js` / `js/main.min.js` — re-run `npm run build` after any module change.
- Don't modify existing tests.
- `npm test` AND `cd zoho-middleware && npm test` both green + `npm run lint` clean before commit.
- One logical commit. Staging before prod.
