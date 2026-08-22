---
phase: 72-beer-and-cider-launch-announcement-pages-beer-html-cider-htm
plan: 01
subsystem: ui
tags: [static-html, seo, og-tags, twitter-cards, csp, sitemap, build-stamp]

# Dependency graph
requires: []
provides:
  - "beer.html and cider.html launch announcement pages (about.html shell + index.html section primitives)"
  - "beer.html/cider.html registered in sitemap.xml (clean-URL /beer, /cider entries)"
  - "beer.html/cider.html registered in package.json stamp:pages hardcoded array"
affects: [72-02, 72-03]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Composite static page pattern: about.html shell (head/CSP/nav/footer/scripts) + index.html section primitives (.beer-banner, .intro, .how-it-works-steps, .btn/.btn-secondary CTA) assembled into a new top-level page"
    - "[PLACEHOLDER: ...] inline text marker convention for owner-fillable business content (price/dates/CTA copy) pending production promotion"

key-files:
  created: [beer.html, cider.html]
  modified: [sitemap.xml, package.json]

key-decisions:
  - "Secondary CTA link uses class=\"btn-secondary\" alone (not \"btn btn-secondary\" as the plan's <interfaces> literal text suggested) — matches the actual site-wide convention (grep confirmed .btn-secondary is never combined with .btn anywhere in the repo) and avoids conflicting CSS rules"
  - "about.html has no pre-existing twitter:title/twitter:description tags (only twitter:card=summary) — added new page-specific twitter:title and twitter:description tags on both pages rather than 'changing' non-existent inherited ones"
  - "Ran full npm run build (not a partial/scoped stamp) per Task 3 instructions — this re-stamps ?v= cache-bust tokens across all existing HTML pages (identical byte content otherwise) and refreshes js/admin.js BUILD_TIMESTAMP; committed as a documented side effect, not scope creep"

requirements-completed: [OWNER-LAUNCH-72]

# Metrics
duration: ~35min
completed: 2026-08-22
---

# Phase 72 Plan 01: Beer & Cider Launch Announcement Pages Summary

**Authored beer.html and cider.html as composite about.html-shell + index.html-primitive static pages with owner-fillable [PLACEHOLDER: ...] business content, registered both in sitemap.xml and package.json stamp:pages, and passed the full build/lint/test gate (79/79 suites, 1095/1095 tests).**

## Performance

- **Duration:** ~35 min
- **Started:** 2026-08-22T21:42:15Z
- **Completed:** 2026-08-22T21:46:42Z
- **Tasks:** 3
- **Files modified:** 2 created (beer.html, cider.html) + 2 directly registered (sitemap.xml, package.json) + 20 build-artifact side-effect files (all pre-existing pages re-stamped by the required `npm run build`, plus js/admin.js/js/admin.min.js timestamp)

## Accomplishments
- `beer.html` — "Now Brewing: Craft Beer" announcement page, all 7 spec sections (hero, what-it-is, availability/dates, price, primary CTA, FAQ, cross-link), beer-specific og:*/twitter:* tags, clean-URL canonical `/beer`
- `cider.html` — "Now Fermenting: 100% Okanagan Juice Cider" announcement page, same structure, cider-specific og:*/twitter:* tags, clean-URL canonical `/cider`
- Both pages registered in `sitemap.xml` (clean URLs, monthly/0.7) and `package.json` `stamp:pages` array
- Full build/lint/test gate green: `npm run build` stamped `?v=` tokens, `npm run lint` clean (ES5, `--max-warnings 0`), `npm test` 79/79 suites / 1095/1095 tests passing

## Task Commits

1. **Task 1: Author beer.html** - `d616479e` (feat)
2. **Task 2: Author cider.html** - `c32c9961` (feat)
3. **Task 3: Register pages (sitemap + build config) + build/lint/test gate** - `d6ac6b93` (chore)

**Plan metadata:** (this commit, to follow)

## Files Created/Modified
- `beer.html` (269 lines) - Beer launch announcement page; about.html shell (head/CSP/nav/footer/scripts) + index.html primitives (.beer-banner hero, .intro what-it-is, .how-it-works-steps availability, .intro price, .btn CTA block, static FAQ, cross-link section)
- `cider.html` (270 lines) - Cider launch announcement page; identical shell/structure with cider content
- `sitemap.xml` - Added `<url>` entries for `https://steinsandvines.ca/beer` and `/cider` (lastmod 2026-08-22, monthly, priority 0.7)
- `package.json` - Added `'beer.html'` and `'cider.html'` to the `stamp:pages` hardcoded array (line 17) so their `?v=` cache-bust tokens get stamped by `npm run build`
- 20 other pre-existing HTML/JS files (about.html, admin.html, brewpad.html, contact.html, custom-labels.html, index.html, ingredients.html, kiosk.html, products.html, products/*.html, reservation.html, js/admin.js, js/admin.min.js) - `?v=` cache-bust tokens re-stamped and `js/admin.js` `BUILD_TIMESTAMP` refreshed as an inherent side effect of running the full `npm run build` (required by Task 3); no content/behavior changes, byte-identical otherwise

## Decisions Made
- Secondary CTA link (`or call (604) 567-4565`) uses `class="btn-secondary"` alone, not the plan interfaces' literal `class="btn btn-secondary"` — grep across the repo confirmed `.btn-secondary` is never combined with `.btn` anywhere on the site (they'd have conflicting padding/border/background rules); matching the established site-wide convention keeps the pages visually indistinguishable from the rest of the site as required by the plan's prime directive.
- about.html's actual `<head>` has no pre-existing `twitter:title`/`twitter:description` tags (only `twitter:card content="summary"`) — added net-new page-specific `twitter:title`/`twitter:description` tags on both pages (mirroring the new `og:title`/`og:description`) rather than "changing inherited" tags that don't exist in the source shell.
- Ran the full `npm run build` (not a scoped/partial stamp) exactly as Task 3 instructs — this necessarily re-stamps the `?v=` cache-bust token on every existing page in the `stamp:pages`/`stamp:index`/`stamp:admin`/`stamp:kiosk`/`stamp:brewpad` scripts (global `Date.now()` token) and refreshes `js/admin.js`'s `BUILD_TIMESTAMP`. Verified `css/*.min.css` and `js/main.min.js` are byte-identical (no new modules), so the only diffs are cache-bust tokens/timestamps — committed as a documented, required side effect of the plan's own build-gate instruction, not scope creep.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Corrected secondary-CTA class to match established site convention**
- **Found during:** Task 1 (Author beer.html)
- **Issue:** The plan's `<interfaces>` block gave an exact CTA markup pattern using `class="btn btn-secondary"` for the phone-fallback link, but grepping the repo showed `.btn-secondary` is used standalone everywhere (`about.html`, `admin.html`, `brewpad.html`) and never combined with `.btn` — combining them risks conflicting CSS (both classes independently set padding/border/background).
- **Fix:** Used `class="btn-secondary"` alone for the phone-fallback CTA on both pages.
- **Files modified:** `beer.html`, `cider.html`
- **Verification:** Visual/CSS-class grep cross-check against `css/styles.css` selectors `.btn` (771) and `.btn-secondary` (809) — independently defined, not designed to compose.
- **Committed in:** `d616479e`, `c32c9961` (part of task commits)

---

**Total deviations:** 1 auto-fixed (Rule 1)
**Impact on plan:** Cosmetic correction only, keeps pages visually indistinguishable from the rest of the site per the plan's prime directive. No scope creep.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Handoff: Placeholders to fill before production promotion

**Exact list of `[PLACEHOLDER: ...]` markers present in `beer.html`:**
1. `[PLACEHOLDER: CTA text — e.g. Reserve Your Kit]` (appears twice — hero CTA + bottom CTA block)
2. `[PLACEHOLDER: what-it-is — beer]`
3. `[PLACEHOLDER: available-from]`
4. `[PLACEHOLDER: ready-in]`
5. `[PLACEHOLDER: seasonal note]`
6. `[PLACEHOLDER: price]`
7. `[PLACEHOLDER: what's included]`
8. `[PLACEHOLDER: FAQ answer — experience needed]`
9. `[PLACEHOLDER: FAQ answer — timeline]`
10. `[PLACEHOLDER: FAQ answer — custom recipes]`

**Exact list of `[PLACEHOLDER: ...]` markers present in `cider.html`:**
1. `[PLACEHOLDER: CTA text — e.g. Reserve Your Kit]` (appears twice — hero CTA + bottom CTA block)
2. `[PLACEHOLDER: what-it-is — cider]`
3. `[PLACEHOLDER: what makes it special — 100% Okanagan juice / source]`
4. `[PLACEHOLDER: available-from]`
5. `[PLACEHOLDER: ready-in]`
6. `[PLACEHOLDER: seasonal juice note]`
7. `[PLACEHOLDER: price]`
8. `[PLACEHOLDER: what's included]`
9. `[PLACEHOLDER: FAQ answer — experience needed]`
10. `[PLACEHOLDER: FAQ answer — timeline]`
11. `[PLACEHOLDER: FAQ answer — custom recipes]`

**Flagged placeholder image filenames:** None. No `<picture>`/photo block was added to either page in this plan — the plan permitted a flagged placeholder image but made it optional ("If a real photo is wanted..."); neither page currently references a not-yet-existing image filename, so there is nothing to flag here. If the owner wants a hero/feature photo added, a follow-up plan should add a `<picture>` block following the `about.html` 179-198 webp+srcset convention (e.g. `images/launch/beer-1600w.jpg` / `images/launch/cider-1600w.jpg`) and list the missing filenames at that time.

## Next Phase Readiness
`beer.html` and `cider.html` exist, pass all plan verification checks, and are registered for SEO + cache-stamping. Ready for 72-02/72-03 (nav updates across all public pages + `index.html` feature cards) to link into these pages. Not yet promoted to production — placeholders above must be filled by the owner before promotion, per plan `<output>` instructions and the phase's locked decision ("Business content = placeholders for now... owner fills real values before production promotion").

---
*Phase: 72-beer-and-cider-launch-announcement-pages-beer-html-cider-htm*
*Completed: 2026-08-22*

## Self-Check: PASSED

- FOUND: beer.html
- FOUND: cider.html
- FOUND: .planning/phases/72-beer-and-cider-launch-announcement-pages-beer-html-cider-htm/72-01-SUMMARY.md
- FOUND: d616479e (Task 1 commit)
- FOUND: c32c9961 (Task 2 commit)
- FOUND: d6ac6b93 (Task 3 commit)
- FOUND: 171bb05a (SUMMARY commit)
