---
phase: 72-beer-and-cider-launch-announcement-pages-beer-html-cider-htm
plan: 02
subsystem: ui
tags: [static-html, nav, homepage, cms-json, csp-unchanged]

# Dependency graph
requires:
  - phase: 72-01
    provides: "beer.html and cider.html launch announcement pages"
provides:
  - "Beer + Cider nav links on all 17 public pages (8 root + 404 + 8 products/)"
  - "Homepage 'Now Available' launch banners linking to beer.html and cider.html"
  - "Reconciled stale 'Beer Is Coming' waitlist banner (repurposed, not removed) + removed orphaned waitlist iframe"
affects: [72-03]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Same-edit-across-all-pages nav insertion, following commit 43d49378 precedent (out-of-stock across all shop surfaces)"
    - "data-content CMS override gotcha: js/modules/13-init.js fetches content/{page}.json for pages in PAGES_WITH_CONTENT and overwrites [data-content] element innerHTML on load — any HTML text change to a data-content element on index.html/about.html/contact.html/products.html/ingredients.html/reservation.html/admin.html MUST be mirrored in the matching content/{page}.json key or the JS silently reverts it at runtime"

key-files:
  created: []
  modified:
    - index.html
    - about.html
    - contact.html
    - custom-labels.html
    - hops.html
    - ingredients.html
    - products.html
    - reservation.html
    - 404.html
    - products/ferment-in-store.html
    - products/ingredients-supplies.html
    - products/hops.html
    - products/grains.html
    - products/yeast.html
    - products/additives.html
    - products/packaging.html
    - products/equipment.html
    - content/home.json

key-decisions:
  - "Stale-banner reconciliation: REPURPOSED the existing .beer-banner section into a live 'Now Available' Beer banner (not removed) — kept the beer-banner--green modifier, replaced badge/headline/subhead text, deleted the waitlist form, added a .btn CTA to beer.html"
  - "Cider banner uses the base .beer-banner class with NO --green modifier (only one colour modifier exists in css/styles.css) to visually differentiate the two banners with zero new CSS"
  - "Waitlist iframe (#beer-waitlist-iframe) was REMOVED, not left as dead markup — the form it targeted is gone, and js/modules/12-checkout.js:1690 setupBeerWaitlistForm() is null-guarded so no JS regression"
  - "Fixed a stale-content bug not called out in the plan: content/home.json's beer-title/beer-text keys were left saying 'Beer Is Coming' — since index.html has data-page=\"home\" and 13-init.js overwrites [data-content] elements from content/home.json on every page load, leaving the JSON unchanged would have silently reverted the new banner HTML text back to the stale copy at runtime. Updated home.json beer-title/beer-text to match the new HTML and added cider-title/cider-text keys for the new Cider banner."

requirements-completed: [OWNER-LAUNCH-72]

# Metrics
duration: ~12min
completed: 2026-08-22
---

# Phase 72 Plan 02: Nav Propagation + Homepage Launch Banners Summary

**Beer + Cider nav links added to all 17 public pages (root/404/products path-convention matched per page type), and the homepage's stale "Beer Is Coming" waitlist banner was repurposed into two live "Now Available" launch banners linking to beer.html/cider.html, with the orphaned waitlist iframe removed and a runtime CMS-JSON staleness bug fixed along the way.**

## Performance

- **Duration:** ~12 min
- **Started:** 2026-08-22T21:49:30Z
- **Completed:** 2026-08-22T21:54:07Z
- **Tasks:** 2
- **Files modified:** 17 nav pages + content/home.json (Task 2) + build-artifact side effects (admin.html, brewpad.html, kiosk.html, beer.html, cider.html cache-bust stamps + js/admin.js/js/admin.min.js timestamp)

## Accomplishments
- Beer + Cider `<li>` nav entries inserted between Products and About on all 8 root pages (bare `beer.html`/`cider.html` links), all 8 `products/*.html` pages (`../beer.html`/`../cider.html`), and `404.html` (absolute `/beer.html`/`/cider.html`, matching its simpler nav) — verified exactly one Beer link and one Cider link per page, staff pages (admin/kiosk/brewpad/batch) untouched
- Homepage `.beer-banner` section repurposed: badge "Coming Soon" → "Now Available", headline/subhead rewritten for a live launch, waitlist `<form>` deleted, replaced with a `.btn` CTA linking to `beer.html`
- New second banner added immediately after (base `.beer-banner`, no `--green` modifier, for visual distinction) — "Now Available" Cider banner linking to `cider.html`
- Orphaned `#beer-waitlist-iframe` (hidden submit target) removed from the page footer area
- `content/home.json` updated so the CMS-JSON content-loading pass doesn't silently revert the new banner text back to "Beer Is Coming" at runtime (see Deviations)
- Full build/lint/test gate green: `npm run build`, `npm run lint` (0 warnings), `npm test` (79/79 suites, 1095/1095 tests)

## Task Commits

1. **Task 1: Add Beer + Cider nav entries to all public pages** - `a9cc6969` (feat)
2. **Task 2: Homepage launch banners + reconcile the stale "Beer Is Coming" banner** - `dee27ec5` (feat)

**Plan metadata:** (this commit, to follow)

## Files Created/Modified
- `index.html` - Beer+Cider nav links; `.beer-banner` repurposed to live Beer banner; new Cider banner added; waitlist form + iframe removed
- `about.html`, `contact.html`, `custom-labels.html`, `hops.html`, `ingredients.html`, `products.html`, `reservation.html` - Beer+Cider nav links (bare links), existing nav variant preserved otherwise
- `404.html` - Beer+Cider nav links using absolute `/beer.html`/`/cider.html`, matching its simpler nav shape
- `products/ferment-in-store.html`, `products/ingredients-supplies.html`, `products/hops.html`, `products/grains.html`, `products/yeast.html`, `products/additives.html`, `products/packaging.html`, `products/equipment.html` - Beer+Cider nav links using `../beer.html`/`../cider.html` relative links
- `content/home.json` - `beer-title`/`beer-text` updated to match the new "Now Available" banner copy; `cider-title`/`cider-text` keys added for the new Cider banner
- `admin.html`, `brewpad.html`, `kiosk.html`, `beer.html`, `cider.html`, `js/admin.js`, `js/admin.min.js` - cache-bust `?v=` stamps / `BUILD_TIMESTAMP` refreshed as an inherent side effect of running the required full `npm run build`; no content/behavior changes

## Decisions Made
- **Stale-banner reconciliation choice: REPURPOSE, not remove.** The existing `.beer-banner beer-banner--green` block became the live Beer banner (badge/headline/subhead swapped, waitlist form deleted, `.btn` CTA to `beer.html` added). This was the plan's stated default, pending owner confirmation in 72-03.
- **Waitlist iframe: REMOVED**, not left as dead markup. `#beer-waitlist-iframe` had no remaining target once the form was deleted; `setupBeerWaitlistForm()` in `js/modules/12-checkout.js:1690` is null-guarded (`if (!f) return;`), so removal causes no JS regression. The waitlist handler code itself (module logic + the standalone `checkout-waitlist.test.js` regression suite, which builds its own DOM independent of index.html) was left untouched per plan instructions.
- **Cider banner colour:** used the base `.beer-banner` class with no `--green` modifier (the brown/default gradient) to visually distinguish it from the green Beer banner — only one colour modifier (`--green`) exists in `css/styles.css`, so this was the zero-new-CSS option that still gives two distinct banners.
- **[PLACEHOLDER: ...] text added to the homepage banners:** two CTA link texts — `[PLACEHOLDER: CTA text — e.g. Explore Beer →]` (Beer banner) and `[PLACEHOLDER: CTA text — e.g. Explore Cider →]` (Cider banner). Headline/subhead copy for both banners was written as final (non-placeholder) launch copy, matching the plan's `<action>` instructions; only the CTA button label was left as an owner-fillable placeholder.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] content/home.json stale CMS override would have silently reverted the new banner text at runtime**
- **Found during:** Task 2 (homepage banner edit)
- **Issue:** `js/modules/13-init.js` fetches `content/home.json` for `data-page="home"` (index.html) and overwrites every `[data-content]` element's `innerHTML` with the matching JSON key on page load. `content/home.json` still had `"beer-title": "Beer Is Coming"` and the old waitlist copy in `"beer-text"`. Editing only the static HTML (as the plan's `<action>` describes) would have shipped a page that looks correct in the raw HTML source but reverts to the stale "Beer Is Coming" copy the instant `main.min.js` runs in a browser — the exact contradiction Task 2 exists to fix, just relocated to the JSON layer.
- **Fix:** Updated `content/home.json`'s `beer-title`/`beer-text` keys to match the new HTML banner copy, and added new `cider-title`/`cider-text` keys for the second banner (both `data-content` attributes on the Cider banner's `<h2>`/`<p>` reference these new keys, extending the existing pattern rather than introducing a new one).
- **Files modified:** `content/home.json`
- **Verification:** `node -e "JSON.parse(...)"` confirms valid JSON; `grep -c 'Beer Is Coming' content/home.json index.html` returns 0 for both; full `npm test` suite green (79/79).
- **Committed in:** `dee27ec5` (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 — bug: stale runtime CMS override)
**Impact on plan:** Necessary for correctness — without this fix the plan's stated success criterion ("no longer contradicts a live beer.html") would fail at runtime despite passing a static-HTML-only review. No scope creep; the fix is additive (new JSON keys) and confined to `content/home.json`.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
All 17 public pages now link to `beer.html`/`cider.html`; the homepage features both with live "Now Available" banners and no longer shows the stale "Coming Soon" waitlist. CTA button text on both homepage banners (and the CTA text already flagged in 72-01's beer.html/cider.html) remains `[PLACEHOLDER: ...]` pending owner copy. Ready for 72-03 (owner review/confirmation of the stale-banner reconciliation choice and placeholder fill-in before production promotion). Not yet promoted to production.

---
*Phase: 72-beer-and-cider-launch-announcement-pages-beer-html-cider-htm*
*Completed: 2026-08-22*

## Self-Check: PASSED

- FOUND: .planning/phases/72-beer-and-cider-launch-announcement-pages-beer-html-cider-htm/72-02-SUMMARY.md
- FOUND: index.html
- FOUND: content/home.json
- FOUND: 404.html
- FOUND: products/equipment.html
- FOUND: a9cc6969 (Task 1 commit)
- FOUND: dee27ec5 (Task 2 commit)
