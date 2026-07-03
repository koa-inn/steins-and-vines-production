---
phase: 46-auth-re-architecture-critical-split-from-phase-45
plan: 09
subsystem: auth
tags: [build, terser, cleancss, jest, eslint, kiosk, admin, brewpad]

# Dependency graph
requires:
  - phase: 46-03..46-08
    provides: migrated kiosk device-token auth, admin/brewpad Google OAuth session auth, server-side auth-tier routes
provides:
  - Rebuilt js/main.js/main.min.js, admin.min.js, kiosk.min.js, brewpad.min.js, and modules 16/17 min.js from the fully migrated auth sources
  - Cache-busted admin.html, kiosk.html, brewpad.html, index.html, and every other stamped page
  - Certified full-suite gate (frontend Jest, middleware Jest, ESLint) green on the complete auth re-architecture
  - Repo-wide proof that no x-api-key/MW_API_KEY reference survives in shipped (non-min) source
affects: [46-cutover, 47]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Monolithic build (npm run build) runs once after all source plans in a wave, not per-plan"
    - "No-key grep gate (grep -rn --include='*.js' -e x-api-key -e MW_API_KEY js/ | grep -v .min.js) as a pre-cutover certification step"

key-files:
  created: []
  modified:
    - js/main.js
    - js/main.min.js
    - js/admin.js
    - js/admin.min.js
    - js/kiosk.min.js
    - js/brewpad.min.js
    - js/modules/01-config.js
    - js/modules/16-catalog-subpage.min.js
    - js/modules/17-search-overlay.min.js
    - admin.html
    - kiosk.html
    - brewpad.html
    - index.html
    - products.html, ingredients.html, reservation.html, about.html, contact.html, custom-labels.html
    - products/additives.html, products/equipment.html, products/ferment-in-store.html, products/grains.html, products/hops.html, products/ingredients-supplies.html, products/packaging.html, products/yeast.html

key-decisions:
  - "Removed dead `var MW_API_KEY` declaration from js/modules/01-config.js (public storefront bundle) — sheets-config.js no longer defines SHEETS_CONFIG.MW_API_KEY (removed in an earlier 46-0x plan), and nothing else in the codebase read the resulting always-empty variable; this was the one grep hit blocking the certification gate"

patterns-established:
  - "Pre-cutover gate = full frontend suite + full middleware suite + lint + repo-wide no-key grep, all must be green before owner-driven auth cutover"

requirements-completed: [AUDIT-CRITICAL-AUTH, D-46-10]

# Metrics
duration: 3min
completed: 2026-07-03
---

# Phase 46 Plan 09: Full Rebuild + Pre-Cutover Gate Summary

**Rebuilt every frontend bundle from the migrated auth sources, then certified the complete auth re-architecture with a green full-suite gate (947 frontend + 1174 middleware tests, 0 lint errors) and a repo-wide grep proving no `x-api-key`/`MW_API_KEY` reference survives in shipped source — after fixing one leftover dead-code reference the grep caught.**

## Performance

- **Duration:** ~3 min (18:12:28 → 18:15:35 PDT)
- **Started:** 2026-07-03T01:12:00Z
- **Completed:** 2026-07-03T01:15:35Z
- **Tasks:** 2 completed
- **Files modified:** 26 (Task 1) + 23 (Task 2, overlapping set) — 27 unique files total across both commits

## Accomplishments
- `npm run build` regenerated `js/main.js`/`main.min.js`, `admin.min.js`, `kiosk.min.js`, `brewpad.min.js`, modules 16/17 min.js, and cache-busted admin/kiosk/brewpad/index/all product+static pages — shipping the phase 46 auth re-architecture (kiosk device-token, admin/brewpad Google OAuth session) in the live bundles
- Ran the complete pre-cutover gate: frontend `npm test` (53 suites / 947 tests), `npm run lint` (0 errors, 125 pre-existing warnings), middleware `npm test` (61 suites / 1174 tests) — all green
- Found and fixed one surviving `MW_API_KEY` reference via the repo-wide grep (dead code in the public storefront's `01-config.js`), rebuilt, and re-verified the full gate green with the grep now returning empty

## Task Commits

Each task was committed atomically:

1. **Task 1: Rebuild all bundles** - `427903e` (chore)
2. **Task 2: Full-suite gate + no-key grep proof** - `c11c856` (fix — included the required dead-code removal + gate re-verification)

**Plan metadata:** (this commit, docs — created by orchestrator after this summary)

## Files Created/Modified
- `js/main.js`, `js/main.min.js` — concatenated + minified public storefront bundle (12-checkout.js etc.), rebuilt twice (once for the general rebuild, once after the 01-config.js fix)
- `js/admin.js` — build-timestamp stamp only (source untouched)
- `js/admin.min.js`, `js/kiosk.min.js`, `js/brewpad.min.js` — minified staff/kiosk bundles reflecting migrated auth
- `js/modules/01-config.js` — removed dead `var MW_API_KEY` declaration + stale rotation comment (Rule 1 fix)
- `js/modules/16-catalog-subpage.min.js`, `js/modules/17-search-overlay.min.js` — rebuilt standalone bundles
- `admin.html`, `kiosk.html`, `brewpad.html`, `index.html`, and all other stamped HTML pages — cache-bust `?v=` tokens bumped

## Decisions Made
- Removed the vestigial `MW_API_KEY` variable from `js/modules/01-config.js` rather than suppressing the grep, per the plan's explicit instruction ("fix it in the owning source file, do not suppress"). Confirmed via grep that no other module read this variable and no test asserted on it before removing it.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Removed dead `MW_API_KEY` reference from public storefront bundle**
- **Found during:** Task 2 (no-key grep proof)
- **Issue:** `js/modules/01-config.js` still declared `var MW_API_KEY = (typeof SHEETS_CONFIG !== 'undefined' && SHEETS_CONFIG.MW_API_KEY) ? SHEETS_CONFIG.MW_API_KEY : '';` sourced from `SHEETS_CONFIG.MW_API_KEY`. `js/sheets-config.js` no longer defines that key (removed in an earlier 46-0x plan migrating kiosk/admin/brewpad off the shipped key). The resulting variable always evaluated to `''` and was never read anywhere else in the codebase — dead code with a stale comment describing a retired security model (mentions Railway `API_SECRET_KEY` rotation that no longer applies to the browser bundle).
- **Fix:** Removed the 4-line comment block + `var MW_API_KEY` declaration from `js/modules/01-config.js`; ran `npm run build` to regenerate `js/main.js`/`main.min.js` from the corrected source.
- **Files modified:** `js/modules/01-config.js`, `js/main.js`, `js/main.min.js`
- **Verification:** Confirmed via `grep -rln "MW_API_KEY" js/ --include='*.js'` that no other frontend module read the variable; confirmed via `grep -rln "01-config\|main.js" tests/frontend/*.js | xargs grep -l MW_API_KEY` that no test depended on it. Re-ran full frontend suite (947/947 pass), full middleware suite (1174/1174 pass), and lint (0 errors) after the fix. Re-ran the grep gate — now empty.
- **Committed in:** `c11c856` (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 bug/dead-code)
**Impact on plan:** Necessary to satisfy the plan's own acceptance criterion (grep must return empty). No scope creep — fix was confined to the one file the grep flagged.

## Issues Encountered
None beyond the deviation above.

## No-Key Grep Proof (final state)

Command:
```bash
grep -rn --include='*.js' -e "x-api-key" -e "MW_API_KEY" js/ | grep -v '\.min\.js'
```
Result: **empty** (exit code 1 / no matches) — confirmed after the Task 2 fix and rebuild.

Middleware-side references to `MW_API_KEY`/`x-api-key` (in `zoho-middleware/lib/apiKey.js`, `authTiers.js`, `validateEnv.js`, and their tests) are intentionally out of scope for this grep — they are server-side env-var handling for the legacy alias, never shipped to the browser, and are explicitly excluded from the plan's threat model (which targets `js/` shipped source only).

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- The complete auth re-architecture (kiosk device-token, admin/brewpad Google OAuth + 7-day server session) is built, bundled, cache-busted, and passes the full test + lint gate with no residual key exposure in shipped source.
- System is certified ready for the owner-driven cutover step referenced in phase 46 tracking.
- No blockers identified.

---
*Phase: 46-auth-re-architecture-critical-split-from-phase-45*
*Completed: 2026-07-03*
