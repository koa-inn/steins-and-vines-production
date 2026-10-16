# Phase 92 Plan 08: Verification, Staging Deploy, Owner UAT Summary

Status: Tasks 1-2 complete; Task 3 (owner UAT) AWAITING owner. This SUMMARY is provisional until the UAT verdict is recorded.

## Task 1: Gates and env check

- `npm run build`: OK. It restamps cache-bust/build stamps (`?v=`, `BUILD_TIMESTAMP`) in 26 tracked files (HTML pages, js/admin.js, js/admin.min.js). This is stamp-only drift, not code. Reverted with `git checkout` (links.html left alone), so the plan's "no tracked-file diff" criterion holds after revert. Not committed.
- Root `npm test`: 201 suites, 2619 tests passed. Root `npm run lint`: clean.
- Middleware `npm test`: 3481 passed, 1 skipped, 2 failed. The 2 failures are `__tests__/vancouver-timezone.test.js` on local Node 20.20.2 (known and pre-existing on unmodified main; prod/staging run Node 24). Not blocking. Middleware lint: clean.
- CSP check: `git diff dc9e2378~1..HEAD -- '*.html' | grep -ci content-security-policy` = 0. No CSP changed.
- KIOSK_CONTACT_ID (service `sv_middleware`): staging = set (18 digits); production = set (18 digits). Values not recorded.

## Task 2: Staging push and smoke

- Pre-push `git log --oneline origin/main..HEAD`: 34 commits, all Phase 92 (92-xx, `docs(92)`, executor-worktree merges, tracking updates, and `96ac29fe docs(state): record phase 92 context session`); head 6d37b4fe, tail 242be77d. Full list was shown in the run log.
- `git push origin main` (staging only): 9c20f992..6d37b4fe. Production not pushed; `production/main` = ff3239cf, unchanged.
- Railway staging deploy fc6c20a9 SUCCESS (uptime reset to ~21 s; /health ok, authenticated true, redis true, database true).
- Smoke (staging middleware):
  - past-sales/ledger, /customer, /invoice/:id with no credential: 401, 401, 401.
  - same three with `x-device-token: wrong`: 403, 403, 403.
  - D-46-02 regression: `/api/invoices` and `/api/contacts` with wrong device token: 403, 403.
- `staging.steinsandvines.ca/kiosk.html` returned 403 to curl (Cloudflare Access), so the `kiosk-past-sales-btn` grep could not be checked. Handed to the owner (the UAT itself covers it). The button is present in the local source.

## UAT

Pending owner. Results of the 12 steps to be recorded here.

## Deviations

None to the code. Build restamp drift reverted rather than committed (see Task 1).

## Owner review items

Assumptions A-01..A-11, the 92-01 join-mode decision (blank-reference invoices, including SO-pay and manual back-office invoices, show in the ledger as In-store), and any D-14 deviation from 92-03.
