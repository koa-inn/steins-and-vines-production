---
phase: 22-category-subpages-navigation
reviewed: 2026-05-29T00:00:00Z
depth: standard
files_reviewed: 10
files_reviewed_list:
  - css/catalog-subpage.css
  - js/modules/10-tabs.js
  - products/additives.html
  - products/equipment.html
  - products/ferment-in-store.html
  - products/grains.html
  - products/hops.html
  - products/ingredients-supplies.html
  - products/packaging.html
  - products/yeast.html
findings:
  critical: 4
  warning: 7
  info: 3
  total: 14
status: issues_found
---

# Phase 22: Code Review Report

**Reviewed:** 2026-05-29
**Depth:** standard
**Files Reviewed:** 10
**Status:** issues_found

## Summary

Phase 22 added an ingredient category sub-nav bar and 5 new HTML subpages (additives, equipment, grains, packaging, yeast), plus updated the `hops.html` and `ingredients-supplies.html` pages and the tab navigation module. The general approach is sound — CSS-only active-pill state via `body[data-page]`, inline `SUBPAGE_CONFIG` objects, and a shared `16-catalog-subpage.min.js` driver — but there are several correctness and robustness defects across the file set that need addressing before these pages go to production.

Four critical issues were found: a JS navigation path bug that causes tab clicks to navigate to a broken URL on GitHub Pages, an empty `<h1>` that will be read aloud by screen readers before JS populates it, a `catalog-subpage.min.css` stylesheet that is never built by `npm run build`, and a `<li role="separator">` ARIA error that breaks the dropdown's accessible name tree. Seven warnings cover cross-file inconsistencies in page headers, CSP, version strings, touch target sizes, and a CSS double-class side effect.

---

## Critical Issues

### CR-01: Tab navigation uses absolute URL paths that break on GitHub Pages subdirectory

**File:** `js/modules/10-tabs.js:15-20`
**Issue:** When a user on `ferment-in-store.html` or `ingredients-supplies.html` clicks the other product tab, `location.pathname` is compared against `/products/ferment-in-store.html`. On GitHub Pages the repo is served from the repo root so the path is correct, but this comparison is fragile and already wrong if the site is ever served from a subdirectory. More concretely: on staging (`staging.steinsandvines.ca`) the path resolves correctly, but the hard-coded `/products/` prefix means any environment where the document root differs (local dev via `file://`, a subdirectory deploy) silently fails the `!==` guard and never navigates — the tab click falls through to `_activeCartTab = tab` and attempts to render inline as if the tab were on the same page, which crashes because neither `catalog-controls-kits` nor `catalog-controls-ingredients` exist on the other page's DOM. The bug is latent on production but will surface for any developer opening the pages via `file://`.

Additionally, `location.href = TAB_URLS[tab]` assigns an absolute-path URL. If GitHub Pages ever redirects to a subdirectory this silently navigates to the wrong origin.

**Fix:** Use relative paths and derive them from `location.pathname` rather than hard-coding:
```javascript
var TAB_URLS = {
  'kits': 'ferment-in-store.html',
  'ingredients': 'ingredients-supplies.html'
};
if (TAB_URLS[tab] && !location.pathname.endsWith(TAB_URLS[tab])) {
  location.href = TAB_URLS[tab];
  return;
}
```

---

### CR-02: Empty `<h1>` rendered before JS populates it — screen readers announce an empty heading

**File:** `products/additives.html:98`, `products/equipment.html:98`, `products/grains.html:98`, `products/packaging.html:98`, `products/yeast.html:98`
**Issue:** All five subpages render `<h1></h1>` and `<p class="subpage-hero-desc"></p>` as empty elements in the HTML. The intent is for `16-catalog-subpage.min.js` to populate them from `window.SUBPAGE_CONFIG`. However, the JS is loaded with `defer` (executed after DOM parse but before `DOMContentLoaded` in practice), so there is a window of time — particularly on slow connections — during which a screen reader user navigating by headings will encounter an empty H1. Additionally, if JS fails or the minified module fails to load, the page permanently shows a blank hero section with a dangling "Read more" button that controls an empty div. This is a degraded but plausible failure state that leaves users with no page identity at all.

**Fix:** Pre-populate the `<h1>` and `<p class="subpage-hero-desc">` from the inline `SUBPAGE_CONFIG` script block, which runs synchronously before `defer` scripts:
```html
<h1>Additives</h1>
<p class="subpage-hero-desc">Finings, adjuncts, flavorings, and brewing chemicals.</p>
```
The JS can still overwrite on load. Alternatively, move hero population to a synchronous inline script immediately after `SUBPAGE_CONFIG` is set.

---

### CR-03: `catalog-subpage.min.css` is not a build artifact — it will be stale or missing

**File:** `products/additives.html:27`, `products/equipment.html:27`, `products/grains.html:27`, `products/packaging.html:27`, `products/yeast.html:27`, `products/hops.html:75`, `products/ingredients-supplies.html:74`
**Issue:** All seven new/updated pages reference `../css/catalog-subpage.min.css?v=mprjcq0g`. The project build script (`npm run build`) minifies `styles.css` → `styles.min.css` and stamps the version hash. However, `catalog-subpage.css` is a new file in this phase. There is no evidence in the reviewed files or `CLAUDE.md` that `catalog-subpage.min.css` is included in the `npm run build` pipeline. If the minified file does not exist on disk, all seven pages will fail to load their primary layout CSS (toolbar, hero, pills, grid, detail panel), showing an entirely unstyled catalog section. If the file exists but was manually minified and never updated in the build pipeline, future CSS changes to `catalog-subpage.css` will not be reflected in production until someone notices.

**Fix:** Confirm `catalog-subpage.min.css` is added to the `npm run build` cleancss step. If the build config is in `package.json`, add:
```
cleancss -o css/catalog-subpage.min.css css/catalog-subpage.css
```
And ensure the version stamp step also touches `catalog-subpage.min.css`.

---

### CR-04: `<li role="separator">` is invalid ARIA — breaks screen reader dropdown navigation

**File:** `products/additives.html:59`, `products/equipment.html:59`, `products/grains.html:59`, `products/hops.html:135`, `products/ingredients-supplies.html:106`, `products/packaging.html:59`, `products/yeast.html:59` (and matching lines in `ferment-in-store.html:97`)
**Issue:** The nav dropdown divider uses `<li role="separator" class="nav-dropdown-divider">` inside a `<ul class="nav-dropdown-menu">`. The parent `<ul>` has no explicit ARIA role, so it defaults to `role="list"`. `role="separator"` is only valid as a child of certain roles (e.g. `menu`, `menubar`). Inside a plain list, it yields an invalid ARIA ownership error. NVDA and VoiceOver on macOS will report an accessibility tree warning; some screen reader + browser combos skip the element entirely or miscount the number of list items, making navigation confusing.

The correct approach for a visual divider inside a nav list is either a `<hr>` (with appropriate CSS to avoid default hr styling), or simply `<li aria-hidden="true" class="nav-dropdown-divider">` to remove it from the accessibility tree.

**Fix:**
```html
<!-- Option A: semantically correct separator hidden from AT -->
<li aria-hidden="true" class="nav-dropdown-divider"></li>

<!-- Option B: use an hr, styled to look like a line -->
<li class="nav-dropdown-divider"><hr aria-hidden="true"></li>
```

---

## Warnings

### WR-01: `sheets-config.js` loaded with stale `?v=dev` on all new subpages

**File:** `products/additives.html:186`, `products/equipment.html:186`, `products/grains.html:186`, `products/packaging.html:186`, `products/yeast.html:186`
**Issue:** All five new subpages load `../js/sheets-config.js?v=dev`. The existing pages (`hops.html`, `ingredients-supplies.html`, `ferment-in-store.html`) load it without a version suffix or with the production stamp. `?v=dev` means browsers will cache this response indefinitely under the `dev` key and will not pick up production updates to `sheets-config.js` when a new version is deployed unless users hard-refresh. This defeats the purpose of the cache-busting scheme.

**Fix:** Replace `?v=dev` with `?v=mprjcq0g` (current production stamp) or, better, ensure `npm run build` stamps all references to `sheets-config.js` automatically:
```html
<script src="../js/sheets-config.js?v=mprjcq0g"></script>
```

---

### WR-02: `ferment-in-store.html` is missing the CSP header and the subnav

**File:** `products/ferment-in-store.html:12-13`, `products/ferment-in-store.html` (no subnav)
**Issue:** This page is missing two things present on all peer pages:

1. **No `Content-Security-Policy` meta tag.** The other pages (additives, grains, equipment, etc.) all have a CSP that restricts script sources. `ferment-in-store.html` has no CSP, so inline scripts are unrestricted. This is a regression from the security posture of the other pages in the same directory.

2. **No `.ingredient-subnav` nav block.** The ferment-in-store page is not an ingredient page, so the subnav may intentionally be omitted — but without it, users who land on this page from a category pill URL have no way to navigate to the ingredient sub-nav. This is a UX gap relative to the design which shows a subnav across all products/ pages.

**Fix:** Add the CSP meta tag matching the pattern used by the other 6 subpages. For the subnav, a design decision is needed — if the subnav should not appear on ferment-in-store, that is acceptable, but the missing CSP must be corrected regardless.

---

### WR-03: `ferment-in-store.html` missing `viewport-fit=cover`, Apple mobile meta, and PWA tags

**File:** `products/ferment-in-store.html:12-13`
**Issue:** The viewport meta is `<meta name="viewport" content="width=device-width, initial-scale=1.0">` — missing `viewport-fit=cover`. All other pages in the same directory include `viewport-fit=cover` plus:
- `<meta name="apple-mobile-web-app-capable" content="yes">`
- `<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">`
- `<meta name="apple-mobile-web-app-title" content="Steins &amp; Vines">`
- `<link rel="apple-touch-icon">`
- `<link rel="manifest">`

Without `viewport-fit=cover`, the page will not use the safe-area on iPhone X+ notch/home-indicator devices. The CSS rule for `.subpage-hero` uses `env(safe-area-inset-left/right)` — if the viewport meta doesn't include `viewport-fit=cover`, those env values return `0` and the safe-area CSS has no effect.

**Fix:** Update the viewport meta and add the missing Apple/PWA tags to match the template used by the other subpages.

---

### WR-04: `<div id="subpage-catalog" class="subpage-catalog-section">` creates a CSS selector collision

**File:** `products/additives.html:122`, `products/equipment.html:122`, `products/grains.html:122`, `products/packaging.html:122`, `products/yeast.html:122`
**Issue:** On all five new subpages, the catalog container `div` has `class="subpage-catalog-section"` — the same class as its parent `<section class="subpage-catalog-section">`. The CSS rule:
```css
.subpage-catalog-section .product-grid {
  grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
}
```
targets `.product-grid` inside *any* `.subpage-catalog-section`. With the div sharing the class, the selector now also matches `.product-grid` elements that are descendants of the inner div, which is the intended behavior — but the inner div having `subpage-catalog-section` also means any CSS rule scoped to `.subpage-catalog-section` itself (e.g. padding, background) will apply twice (once to the section, once to the inner div), potentially causing layout issues depending on what `16-catalog-subpage.min.js` injects. The inner div should use a distinct class such as `subpage-catalog-grid` or have no class, since its role is to be the JS mount point.

**Fix:**
```html
<!-- Remove the duplicate class from the div; let the section carry it -->
<div id="subpage-catalog" aria-live="polite"></div>
```
And update the JS mount-point selector in `16-catalog-subpage` if it uses `document.getElementById` (which it does — `catalogContainerId: 'subpage-catalog'` — so the class is unused on the div anyway).

---

### WR-05: Subnav pills have `min-height: 36px` — below the 44px WCAG touch target minimum

**File:** `css/catalog-subpage.css:575` (`.subnav-pill { min-height: 36px; }`)
**Issue:** WCAG 2.5.5 (AAA) recommends 44x44px touch targets. WCAG 2.5.8 (AA in WCAG 2.2) requires at least 24px in the smaller dimension but recommends 44px. The subnav pills are `min-height: 36px` with `padding: 8px 16px`, meaning on touch devices they are 8px short of the comfortable tap target. Given that this is a mobile-scrollable subnav accessed primarily by touch, this is a meaningful accessibility gap. All other interactive elements in this CSS file correctly use `min-height: 44px`.

**Fix:**
```css
.subnav-pill {
  min-height: 44px; /* was 36px — match other interactive elements */
  padding: 10px 16px;
}
```
Same fix applies to `.subnav-search-btn { min-height: 36px; min-width: 36px; }` at line 614.

---

### WR-06: Five new subpages are missing `<meta name="description">` and canonical `<link rel="canonical">`

**File:** `products/additives.html`, `products/equipment.html`, `products/grains.html`, `products/packaging.html`, `products/yeast.html` — all missing both tags
**Issue:** Google requires `<meta name="description">` for rich search result snippets and `<link rel="canonical">` to prevent duplicate content penalties. The `hops.html` and `ingredients-supplies.html` pages include both. The five new category pages — which are the SEO-motivated reason for this phase — are missing both. Google will auto-generate a description from the page body, which in this case is mostly empty before JS runs, likely resulting in thin-content descriptions.

**Fix:** Add to each page's `<head>`:
```html
<!-- additives.html example -->
<meta name="description" content="Browse brewing additives in Squamish, BC — finings, adjuncts, flavorings, fruit concentrates, and brewing chemicals at Steins &amp; Vines.">
<link rel="canonical" href="https://steinsandvines.ca/products/additives">
```

---

### WR-07: `ingredients-supplies.html` missing ingredient category teaser (`#ingredients-category-teaser`) referenced in `10-tabs.js`

**File:** `products/ingredients-supplies.html`, `js/modules/10-tabs.js:54-55`
**Issue:** `10-tabs.js` line 54 does `document.getElementById('ingredients-category-teaser')` and toggles its `hidden` class when the ingredients tab is active. In `products.html` this element exists (line 213: `<div class="category-teaser hidden" id="ingredients-category-teaser">`). In `ingredients-supplies.html` — the new dedicated page for ingredients — this element is absent. When a user on `ingredients-supplies.html` clicks the "Ferment in Store" tab (before the navigation redirect fires), `categoryTeaser` is `null` and `categoryTeaser.classList.toggle(...)` throws a TypeError, potentially breaking the tab switch. The null-check on line 54-55 handles this gracefully (`if (categoryTeaser) categoryTeaser.classList.toggle(...)`), so it does not crash — but the design intent that the teaser appears when switching to ingredients is silently missing on `ingredients-supplies.html`.

This is lower severity because the guard prevents a crash, but it indicates a copy-paste gap in the HTML template. If the teaser is supposed to appear on `ingredients-supplies.html`, it needs to be added. If not, this is a stale code path in `10-tabs.js`.

**Fix:** Either add the teaser element to `ingredients-supplies.html` or remove the toggle from `10-tabs.js` if the teaser concept was dropped in Phase 22.

---

## Info

### IN-01: `hops.html` `apple-touch-icon` points to wrong asset

**File:** `products/hops.html` — no `apple-touch-icon` (the `ingredients-supplies.html` uses `SV_Logo_PrimaryCircle_green.svg` as the apple-touch-icon, which is an SVG — iOS ignores SVG apple-touch-icons)
**File:** `products/ingredients-supplies.html:16`
**Issue:** `ingredients-supplies.html` has `<link rel="apple-touch-icon" href="../images/SV_Logo_PrimaryCircle_green.svg">`. iOS ignores SVG files for apple-touch-icon; it expects a PNG. The other pages correctly use `../images/apple-touch-icon.png`. `hops.html` has no apple-touch-icon at all.

**Fix:**
```html
<link rel="apple-touch-icon" href="../images/apple-touch-icon.png">
```

---

### IN-02: `ferment-in-store.html` loads `catalog-subpage.css` indirectly via `16-catalog-subpage.min.js` but not via a stylesheet `<link>`

**File:** `products/ferment-in-store.html`
**Issue:** `ferment-in-store.html` does not include `<link rel="stylesheet" href="../css/catalog-subpage.min.css">` because it uses the original full-page product catalog layout (`products.html` template), not the new subpage layout. This is intentional and correct. No action required — noted here to confirm the omission is by design, not an oversight.

---

### IN-03: `subnav-search-btn` is `cursor: not-allowed` but has no tooltip or visible label beyond `aria-label`

**File:** `css/catalog-subpage.css:617`
**Issue:** The search button is `disabled` in HTML and styled `cursor: not-allowed; opacity: 0.5` in CSS. The `aria-label` says "Search ingredients (coming soon)" — this is fine for AT users, but sighted mouse users see only an icon with no visible hint that it's disabled or forthcoming. Not a blocker, but consider adding a `title="Coming soon"` attribute which renders as a tooltip on hover without requiring any JS.

---

_Reviewed: 2026-05-29_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
