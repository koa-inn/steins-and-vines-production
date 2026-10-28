# Phase 95 Rollout Log

Owner/Claude-maintained record of the Phase 95 staging and production rollout (plans 95-09 to 95-11).
Ids, counts and reason codes only — no customer names, emails or tokens.

## Code gate

Node v24.21.0 (prod runtime), 2026-10-28, main at `b4e5ecaf`:

| Suite | Result |
|-------|--------|
| Frontend `npm test` | 223 suites / 3000 tests passed |
| Frontend `npm run lint` | clean |
| Middleware `npm test` | 256 suites / 3690 passed (2 skipped) |
| Middleware `npm run test:db` | 51 suites / 443 passed |
| Middleware `npm run lint` | clean |

`npm run build` from a clean tree reproduces the committed `js/brewpad.min.js` (only the `brewpad.html` cache stamp differs).

## Staging
