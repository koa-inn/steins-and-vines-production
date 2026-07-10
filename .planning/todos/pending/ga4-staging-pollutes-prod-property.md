---
title: Staging shares the GTM container + GA4 property with prod — staging events pollute prod analytics
status: pending
created: 2026-07-10
source: discovered during Phase 55 browser verification (GA4 events confirmed live)
area: analytics / GTM
priority: high
---

## What

GTM container `GTM-NHRCGLC5` and GA4 property `G-WDYSXCM703` are the SAME across
`staging.steinsandvines.ca` and production. Confirmed live 2026-07-10: firing an event on
staging produced a GA4 collect POST to `google.com/g/collect?...tid=G-WDYSXCM703...` with
`dl=https://staging.steinsandvines.ca/...`. So **every staging event — pageviews, add_to_cart,
begin_checkout, and any test `purchase` — lands in the same GA4 property as real production
revenue.**

## Why it matters

- Any staging QA order inflates prod GA4 revenue/funnel with fake data.
- The Phase 55 `purchase` DebugView UAT (a real test transaction on staging) will itself inject
  a test purchase into the prod GA4 property unless this is fixed first.
- (Incident: during Phase 55 verification, two test `purchase` events —
  `SO-TEST-DEDUP-001` $25 and `SO-TEST-OTHER-002` $10 — plus test add_to_cart/begin_checkout
  were pushed on staging and forwarded to GA4. Collect beacons returned HTTP 503 at the time,
  so they may or may not have been recorded — check GA4 Realtime/DebugView and filter these
  transaction_ids if present.)

## Fix options (pick one; Phase 56 scope)

1. **GTM trigger exception (recommended):** add a "Page Hostname does not contain `staging.`"
   condition to the ecommerce/Google tags, OR block all tags on staging via a blocking trigger.
2. **GA4 internal-traffic / data filter:** define staging (by hostname `staging.steinsandvines.ca`)
   as internal/dev traffic and exclude it, or use a separate GA4 property / DebugView-only for staging.
3. **Separate GTM environment** for staging vs prod.

## Notes

- Ties into the RUNBOOK "Stage-3 CSP↔GTM ordering" note (the shared container is already flagged
  there for the Metricool tag). Same root cause: one container, two sites.
- The GA4 *pipeline itself works* (site → dataLayer → GTM → GA4 verified end-to-end) — this is a
  data-hygiene/environment-split gap, not a tracking bug.
