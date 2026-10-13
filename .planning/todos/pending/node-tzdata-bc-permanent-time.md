---
title: "Node tzdata is too old for BC permanent time (wrong Vancouver dates from 2026-11-01)"
status: pending
created: 2026-10-09
source: phase 87-18 (Q3 timezone check)
area: middleware / infra (all date logic, not only batches)
priority: high (deadline 2026-11-01)
---

BC moved to permanent UTC-7 after 2026-03-08. IANA tzdata 2026a+ models this for `America/Vancouver`
(as a 2026-11-01 02:00 transition that is skipped). The middleware's Node 20.20.2 bundles ICU tzdata
**2025c**, so from 2026-11-01 Node computes Vancouver as UTC-8 while BC is actually UTC-7.

Measured 2026-10-09 (local Node 20.20.2, the same version Railway runs): `Intl` offset for
America/Vancouver on 2026-11-15 = GMT-08:00 (should be GMT-07:00).

Effect: every `America/Vancouver` "today", due-date and month bucket in the middleware is one hour
behind from 00:00 to 01:00 local time, starting 2026-11-01. Apps Script (Google) and the Phase 87
parity/drift checks will disagree with Postgres-side shaping in that hour. 18 lib/routes sites reference
the zone.

To check before choosing a fix:
- Railway container Node `process.versions.tz` (railway run executes locally, so check with a
  one-off log line or /health field).
- Postgres 18.6 on Railway: `select now() at time zone 'America/Vancouver'` vs UTC-7 after Nov 1
  (needs the PG build's tzdata >= 2026a).
- Apps Script: `Utilities.formatDate(new Date('2026-11-15T12:00:00Z'), 'America/Vancouver', 'Z')`
  should print -0700.

Fix options: upgrade Node to a release whose ICU bundles tzdata >= 2026a, or ship updated ICU data via
`NODE_ICU_DATA`. Do this before 2026-11-01 and before the Phase 87 production window.

## Progress (2026-10-13)

- Confirmed inside Railway (`railway ssh`): staging AND production run Node v20.20.2, ICU 78.2,
  tz 2025c, and give America/Vancouver GMT-08:00 for 2026-11-15. Node 20 is end-of-life, so it
  will not get new tzdata.
- Chose Node 24 LTS (v24.21.0, tz 2026c, supported to Apr 2028). Root, middleware, test:db, both
  lints and migrate:guard are all green on 24. Under Node 24's npm, the install scripts it skips
  (cpu-features, ssh2, protobufjs, sharp, fsevents) belong to dev-only or macOS-only packages; none
  are middleware production deps.
- `abc4d42e` pins .nvmrc / engines / CI / docs to 24 and adds the regression test
  `zoho-middleware/__tests__/vancouver-timezone.test.js` (fails on 20, passes on 24).
- `4a8267ab` fixes an unrelated date time-bomb test that began failing 2026-10-11.
- Pushed to staging 2026-10-13. Remaining: verify the staging container, soak, then deploy to
  production with the pinned-SHA discipline before 2026-11-01, and check Postgres `America/Vancouver`.
