# Deferred Items

Out-of-scope discoveries logged during plan execution, per the executor's scope
boundary rule (only fix issues directly caused by the current task's changes).

## 46-06

- **`loadConsignmentReport()` (js/admin.js, ~line 5444-5450) references bare
  globals `MW_URL` and `MW_API_KEY`** — neither is declared anywhere in
  admin.js or js/sheets-config.js (the real config key is
  `SHEETS_CONFIG.MIDDLEWARE_URL`). This function was already broken before
  46-06 (fetching `undefined + '/api/admin/consignment-report...'`) — a
  pre-existing bug unrelated to the auth migration. 46-06 removed the
  `x-api-key: MW_API_KEY` header (required by this plan's acceptance
  criteria: zero `MW_API_KEY` references in admin.js) but did NOT fix the
  `MW_URL` reference, since fixing the base-URL bug is out of scope for an
  auth-transport-only plan. Flagging for a future bug-fix task: swap `MW_URL`
  for `getMwUrl()` (or `SHEETS_CONFIG.MIDDLEWARE_URL`) so the consignment
  report panel actually works.
