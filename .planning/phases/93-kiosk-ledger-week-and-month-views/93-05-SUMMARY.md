# Phase 93 Plan 05: Gates, Staging Deploy, Owner UAT Summary

Status: UAT PENDING. Task 1 complete; Task 2 (owner iPad UAT) awaiting response.

## Task 1: Gates and staging push

- Root `npm test`: 204 suites, 2676 tests passed. `npm run lint`: clean (0 warnings).
- Middleware `npm test`: 3546 passed, 2 skipped, 2 failed. The 2 failures are `__tests__/vancouver-timezone.test.js` on local Node 20 (known, pre-existing; not fixed).
- `npm run build`: OK. It produced stamp-only drift (`?v=` cache-bust in 26 HTML/admin files, including kiosk.html). The kiosk min artifacts (kiosk-core.min.js, kiosk.min.js, kiosk.min.css) were unchanged, so earlier plans did not miss a rebuild. Drift reverted by path; links.html (owner's edit) untouched. Nothing committed.
- CSP check: `git diff 20647f6d -- '*.html' | grep -c Content-Security-Policy` = 0.
- Pre-push: 28 commits in `origin/main..main`, all Phase 93. `git push origin main` (staging only): dc6b5d52..5f19adf3. `origin/main` == local HEAD (5f19adf3). `production/main` unchanged at ff3239cf; production not pushed.
- Railway staging redeployed (health uptime reset to ~23 s; ok, authenticated true, redis true, database true).

## Staging smoke (no real device token used)

| Route | no credential | wrong token |
|-------|---------------|-------------|
| /api/kiosk/past-sales/range?type=week | 401 | 403 |
| /api/kiosk/past-sales/range?type=month | 401 | 403 |
| /api/kiosk/past-sales/ledger (existing) | 401 | 403 |

- `staging.steinsandvines.ca/kiosk.html` returns 403 to curl (Cloudflare Access), so `data-mode="month"` on the deployed page could not be checked. Local source contains it (count 1). The UAT covers the deployed page.

## UAT

PENDING. Owner outcome and the month-vs-day-ledger comparison (2-3 days, count/gross side by side) to be recorded here.

| Date | Month view count / gross | Day ledger count / gross | Match |
|------|--------------------------|--------------------------|-------|
| tbd | | | |

## Deviations

None.

## Open owner items

- Production promotion: separate owner go, pinned SHA per docs/RUNBOOK.md.
- buildCustomer `/^\d+$/` payments-skip smell: out of scope, separate issue.
