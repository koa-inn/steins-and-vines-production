---
phase: 09-content-seo-push
plan: 02
subsystem: frontend/html
tags: [seo, landing-pages, content, css]
dependency_graph:
  requires: []
  provides: [seo-landing-copy-ferment, seo-landing-copy-ingredients]
  affects: [products/ferment-in-store.html, products/ingredients-supplies.html, css/styles.css]
tech_stack:
  added: []
  patterns: [inline-html-seo, landing-copy-section]
key_files:
  created: []
  modified:
    - products/ferment-in-store.html
    - products/ingredients-supplies.html
    - css/styles.css
    - css/styles.min.css
decisions:
  - D-01 enforced: compliance-reviewed copy used verbatim (no rephrase, no edits)
  - D-03 enforced: no [Insert address, hours, phone number] placeholders in either page
  - D-02 targeting: ferment page targets u-vin squamish / make your own wine squamish; ingredients page targets homebrew supplies squamish / beer brewing supplies
metrics:
  duration: "~2 min"
  completed: "2026-05-04"
  tasks_completed: 2
  files_changed: 4
---

# Phase 09 Plan 02: SEO Landing Copy Summary

**One-liner:** Inline SEO landing copy added to both product pages &mdash; ~500 words each targeting local ferment-on-premise and homebrew supplies keywords, with CTA buttons linking to the product catalog.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Add SEO landing copy to ferment-in-store.html + .landing-copy CSS | abe24c3 | products/ferment-in-store.html, css/styles.css, css/styles.min.css |
| 2 | Add SEO landing copy to ingredients-supplies.html | 4aecc3a | products/ingredients-supplies.html |

## What Was Built

### ferment-in-store.html
A `<section class="landing-copy">` inserted between `.page-header` and `.catalog-section` containing ~500 words of compliance-reviewed copy. Sections: "Make Your Own Wine in Squamish" (h2), "How It Works" (h3), "What's Included" (h3), "Wine Styles Available" (h3), "Groups and Special Occasions" (h3), "Come See Us. Drop-Ins Welcome" (h3). CTA: `<a href="#product-catalog" class="btn">Browse Wine Kits</a>`.

### ingredients-supplies.html
Same pattern: `<section class="landing-copy">` with ~500 words. Sections: "Homebrew Ingredients, Supplies & Equipment in Squamish" (h2), "Brewing Ingredients" (h3), "Equipment" (h3), "Cleaning and Sanitization" (h3), "Advice Is Always Free" (h3), "Serving the Sea to Sky Corridor" (h3). CTA: `<a href="#product-catalog" class="btn">Browse Homebrew Supplies</a>`.

### css/styles.css + styles.min.css
New `.landing-copy` CSS block appended after the testimonials media query. Provides `padding: 3rem 0`, `text-align: center`, green headings, max-width 800px body text, and `margin-top: 1.5rem` on CTAs. Built into `styles.min.css` via `npm run build`.

## Deviations from Plan

None &mdash; plan executed exactly as written. Copy used verbatim from 09-LANDING-COPY.md. No placeholders introduced. CTA text and href match spec exactly.

## Known Stubs

None. Both landing copy sections are fully wired with real content.

## Threat Flags

None. This plan adds only static authored HTML with no new endpoints, network access, or dynamic data.

## Self-Check: PASSED

- [x] products/ferment-in-store.html contains `landing-copy` section (1 match)
- [x] products/ferment-in-store.html contains `Browse Wine Kits` CTA linking to `#product-catalog`
- [x] products/ingredients-supplies.html contains `landing-copy` section (1 match)
- [x] products/ingredients-supplies.html contains `Browse Homebrew Supplies` CTA linking to `#product-catalog`
- [x] css/styles.css contains `.landing-copy` CSS block (5 matches for selectors)
- [x] css/styles.min.css contains `landing-copy` (build ran successfully)
- [x] No `[Insert address` placeholders in either file
- [x] All 286 frontend tests pass, all 426 middleware tests pass
- [x] Task 1 commit: abe24c3
- [x] Task 2 commit: 4aecc3a
