---
phase: 19-hop-inventory-catalog
plan: 01
subsystem: frontend-static
tags: [hops, html, css, nav, sitemap, seo]
dependency_graph:
  requires: []
  provides: [hops-html-shell, hops-css, hop-nav-links, hop-sitemap-entry]
  affects: [index.html, products.html, products/ferment-in-store.html, products/ingredients-supplies.html, custom-labels.html, reservation.html, about.html, contact.html, sitemap.xml]
tech_stack:
  added: [css/hops.css]
  patterns: [standalone-page-pattern, nav-dropdown-update, sitemap-xml]
key_files:
  created: [hops.html, css/hops.css]
  modified: [index.html, products.html, products/ferment-in-store.html, products/ingredients-supplies.html, custom-labels.html, reservation.html, about.html, contact.html, sitemap.xml]
decisions:
  - "Hops nav link inserted between Ingredients & Supplies and Custom Labels on all 9 public pages"
  - "products.html upgraded from flat nav to full dropdown nav matching site standard"
  - "XXXXX cache-bust tokens left in place for npm run build to stamp"
  - "css/hops.css uses only existing CSS variables from styles.css — no new :root declarations"
metrics:
  duration: 6min
  completed: "2026-05-19T04:47:11Z"
  tasks: 2
  files: 11
---

# Phase 19 Plan 01: Hops HTML Shell and CSS Summary

**One-liner:** Static hops.html page with green hero, filter/catalog container, and inline SVG radar chart CSS; nav updated across all 9 public pages with 4-item Products dropdown.

## Tasks Completed

| Task | Name | Commit | Key Files |
|------|------|--------|-----------|
| 1 | Create hops.html page and css/hops.css stylesheet | bac7623 | hops.html, css/hops.css |
| 2 | Update nav dropdown on all public pages and add hops.html to sitemap | 5ae4b97 | 8 HTML pages, sitemap.xml |

## What Was Built

### hops.html
Complete standalone public page following the custom-labels.html pattern exactly:
- GTM head + noscript body snippet (GTM-NHRCGLC5)
- Full CSP meta tag matching custom-labels.html policy
- SEO: unique title, meta description, og:title/description/url, canonical pointing to `https://steinsandvines.ca/hops`
- LocalBusiness JSON-LD (same business entity as all other public pages)
- `<body data-page="hops">` for JS module targeting
- 4-item Products nav dropdown with `class="active"` on Hops link
- Hero section with `.hops-hero` class (green background, cream text)
- Intro section with `.hops-intro` class
- Catalog section with `id="hops-catalog"`, `id="hops-search"`, `id="hops-sort"`, `id="hops-filter-row"` — all DOM targets for Plan 02's 15-hops.js
- Footer matching custom-labels.html exactly
- Script loading: sentry.min.js, sentry-init.js, sheets-config.js, main.min.js, 15-hops.min.js

### css/hops.css
All hop-specific styles (no redeclaration of styles.css rules):
- `.hops-hero` — green hero section
- `.hop-card` — extends `.product-card` with green top border accent
- `.hop-alpha` — alpha acid spec pill (uppercase, muted color)
- `.hop-flavor-tags` / `.hop-flavor-tag` — flavor profile pill badges
- `.hop-notes-body` — max-height: 900px override for expanded accordion panel
- `.hop-detail` — expanded detail flex container
- `.hop-radar-wrap` / `.hop-radar` — SVG radar chart sizing
- `.radar-bg`, `.radar-axis`, `.radar-fill`, `.radar-label`, `.radar-web` — radar SVG element styles
- `.hop-specs`, `.hop-origin`, `.hop-notes` — text element styles
- `.hop-size-toggle-group` / `.hop-size-btn` — size variant toggle buttons (min 44px height)
- `.hop-price` — price display in expanded panel
- `.hop-radar-placeholder` — empty-state placeholder for hops with no sensory data yet
- Responsive breakpoints: 768px (radar 160px), 480px (radar 140px)
- `@media (prefers-reduced-motion: reduce)` disabling accordion transition

### Nav Updates (8 existing pages + hops.html itself)
All public pages now have a 4-item Products dropdown in this order:
1. Ferment in Store
2. Ingredients & Supplies
3. **Hops** (NEW)
4. Custom Labels

Root-level pages use `href="hops.html"`, subdirectory pages use `href="../hops.html"`.

### sitemap.xml
Added hops page entry:
```xml
<url>
  <loc>https://steinsandvines.ca/hops</loc>
  <lastmod>2026-05-18</lastmod>
  <changefreq>weekly</changefreq>
  <priority>0.8</priority>
</url>
```

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical Functionality] products.html had no dropdown nav**
- **Found during:** Task 2
- **Issue:** products.html had a flat 4-item nav list without any `nav-dropdown` or `nav-dropdown-menu` structure. The plan's acceptance criteria required `products.html nav-dropdown-menu contains Hops link`, which was impossible without first adding the dropdown structure.
- **Fix:** Upgraded products.html's flat Products link to a full `nav-dropdown` with `nav-dropdown-menu` containing all 4 items including the new Hops link. The `<li><a href="products.html" class="active">` became `<li class="nav-dropdown"><a href="products/ferment-in-store.html" class="active">` consistent with the site standard.
- **Files modified:** products.html
- **Commit:** 5ae4b97

## Known Stubs

- `?v=XXXXX` tokens in hops.html asset URLs — intentional cache-bust placeholders stamped by `npm run build`. This is the correct pattern matching all other pages. Plan 02 will not need to touch these as `npm run build` handles stamping automatically.

## Threat Flags

No new threat surface beyond what was planned in the plan's threat model (T-19-01, T-19-02, T-19-03 all covered). hops.html is a public static page with no auth or dynamic server-side rendering.

## Self-Check

### Files Created/Modified
- FOUND: hops.html (12,417 bytes)
- FOUND: css/hops.css (4,205 bytes)
- FOUND: All 8 existing public pages updated (verified by grep in Task 2)
- FOUND: sitemap.xml updated

### Commits
- FOUND: bac7623 (Task 1 — hops.html + css/hops.css)
- FOUND: 5ae4b97 (Task 2 — nav updates + sitemap)

## Self-Check: PASSED
