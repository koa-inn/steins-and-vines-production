---
phase: 72-beer-and-cider-launch-announcement-pages-beer-html-cider-htm
reviewed: 2026-08-22T00:00:00Z
depth: standard
files_reviewed: 8
files_reviewed_list:
  - beer.html
  - cider.html
  - index.html
  - content/home.json
  - sitemap.xml
  - package.json
  - products/ferment-in-store.html
  - 404.html
findings:
  critical: 1
  warning: 2
  info: 0
  total: 3
status: issues_found
---

# Phase 72: Code Review Report

**Reviewed:** 2026-08-22
**Depth:** standard
**Files Reviewed:** 8
**Status:** issues_found

## Summary

Reviewed the two new static announcement pages (`beer.html`, `cider.html`), the homepage's new launch banners and waitlist-form removal, `content/home.json`, `sitemap.xml`, `package.json`, and the nav-link additions on `products/ferment-in-store.html` and `404.html`.

The stale "Beer Is Coming" waitlist banner and its hidden iframe were cleanly removed from `index.html` with no dangling `<iframe>`/form markup left behind. `sitemap.xml` is well-formed XML and `content/home.json` is valid JSON. `package.json`'s `stamp:pages` array correctly registers both `beer.html` and `cider.html`. Nav links added to `products/ferment-in-store.html` and `404.html` use the correct relative/absolute path conventions for their respective directory depth. No duplicate IDs, no new inline event handlers, and no CSP regressions were found (`beer.html`/`cider.html` CSP is byte-identical to `about.html`, as expected).

However, `beer.html` and `cider.html` were cloned from the `about.html` shell but are missing two `<link>`/`<script>` tags that `about.html` has, which leaves the header search button silently non-functional on both new pages (BLOCKER). Separately, the removal of the waitlist banner from `index.html` left its JS handler function and `data-content` wiring for beer/cider announcement copy incomplete, producing two categories of dead/inert code (WARNING).

## Critical Issues

### CR-01: Header search button is dead on beer.html and cider.html (missing search-overlay assets)

**File:** `beer.html:76` (and equivalently `cider.html:76`, `beer.html:263-266`, `cider.html:264-267`)

**Issue:** Both new pages include the search icon button in the nav (`<button class="header-search-btn" ...>` at `beer.html:122` / `cider.html:122`), copied from the `about.html` shell. But unlike `about.html`, `products/ferment-in-store.html`, and `index.html`, neither `beer.html` nor `cider.html` loads `css/search-overlay.min.css` or `js/modules/17-search-overlay.min.js` (nor `js/vendor/fuse.min.js`, which the search module depends on). `js/modules/17-search-overlay.js` attaches its click handler via `document.querySelector('.header-search-btn')` inside a `DOMContentLoaded` listener that only runs if that script is loaded — since it isn't, the button renders but clicking it does nothing on every visit to these two new public pages.

Confirmed via diff: `about.html` has both tags —
```
<link rel="stylesheet" href="css/search-overlay.min.css?v=mt4wzrgy">
...
<script src="js/modules/17-search-overlay.min.js?v=mt4wzrgy" defer></script>
```
— `beer.html`/`cider.html` have neither.

**Fix:** Add the missing stylesheet and script tags to both pages, matching `about.html`:
```html
<!-- in <head>, after the styles.min.css link -->
<link rel="stylesheet" href="css/search-overlay.min.css?v=mt4wzrgy">

<!-- before </body>, alongside main.min.js -->
<script src="js/vendor/fuse.min.js" defer></script>
<script src="js/modules/17-search-overlay.min.js?v=mt4wzrgy" defer></script>
```
Also remove the search button entirely from the nav if search is intentionally out of scope for these two pages — but as shipped, the button is present and visually implies functionality that doesn't exist.

## Warnings

### WR-01: `data-content` attributes on beer/cider copy are permanently inert — no JSON wiring exists

**File:** `beer.html:133-134,136,149-150,187-188,201`; `cider.html:133-134,136,150-151,188-189,202`; `index.html:230,245`; `js/modules/13-init.js:230`

**Issue:** `beer.html` and `cider.html` mark their hero/what-it-is/price/CTA copy with `data-content="beer-hero-title"`, `"beer-whatitis-text"`, `"beer-cta"`, etc. (and cider equivalents), mirroring the JSON-driven content pattern used on `about.html` (`content/about.json`) and `index.html` (`content/home.json`). But the content loader in `js/modules/13-init.js:230` only fetches a page JSON file for pages in the allow-list `['home', 'about', 'contact', 'products', 'ingredients', 'reservation', 'admin']`. `document.body` on these pages is `data-page="beer"` / `data-page="cider"` (neither is in the list), and no `content/beer.json` or `content/cider.json` file exists. As a result, none of the `beer-hero-*`, `beer-whatitis-*`, `beer-price-*`, `beer-cta`, `cider-hero-*`, `cider-whatitis-*`, `cider-special-text`, `cider-price-*`, `cider-cta` keys will ever be populated — the static HTML fallback (including the `[PLACEHOLDER: ...]` copy) is permanently the only content that can render, silently, with no console error.

This is functionally harmless today (fallback text is already correct/placeholder), but it's a maintainability trap: the `data-content` attribute is this codebase's established signal that "this copy is owner-editable via a content JSON file," and every other page that uses it (home, about, contact, products, ingredients, reservation) actually works that way. A future editor who tries to fill in the beer/cider `[PLACEHOLDER: ...]` text by adding `content/beer.json` (the obvious, established pattern) will find it silently ignored unless `13-init.js`'s allow-list is also updated.

The same gap exists on `index.html`'s new banners: `beer-title`/`beer-text`/`cider-title`/`cider-text` are correctly wired to `content/home.json` (page `home` is in the allow-list and the keys exist), but the banner CTA buttons (`index.html:230`, `index.html:245`) have no `data-content` attribute at all and are hardcoded `[PLACEHOLDER: CTA text ...]` text — inconsistent with the sibling elements in the same banner block that are JSON-driven.

**Fix:** Either (a) add `'beer'` and `'cider'` to `PAGES_WITH_CONTENT` in `js/modules/13-init.js:230` and create `content/beer.json` / `content/cider.json` with the corresponding keys (and add `data-content="beer-cta"`/`"cider-cta"` to the `index.html` banner CTAs, adding matching keys to `content/home.json`), or (b) if these pages are intentionally meant to be hand-edited HTML only (like the catalog subpages), remove the now-misleading `data-content` attributes from `beer.html`/`cider.html` so the pattern isn't implied where it doesn't apply.

### WR-02: Dead code left behind from waitlist-form removal — `setupBeerWaitlistForm()`

**File:** `js/modules/12-checkout.js:1689-1712`; `js/modules/13-init.js:376`

**Issue:** `index.html`'s beer waitlist `<form id="beer-waitlist-form">`, its email input, confirmation message, and hidden `#beer-waitlist-iframe` were correctly removed as part of this phase (confirmed via diff against `737a29ce`). However `js/modules/12-checkout.js` still defines `setupBeerWaitlistForm()` (`document.getElementById('beer-waitlist-form')` / `'beer-waitlist-email'` / `'beer-waitlist-confirm'`, a `POST /api/waitlist` call), and `js/modules/13-init.js:376` still calls it unconditionally on every page load. The function no-ops safely (`if (!f) return;`) since the target element no longer exists anywhere in the codebase, but it's now genuinely unreachable code shipped in every page's `main.min.js` bundle. `tests/frontend/checkout-waitlist.test.js` still exercises this dead path in full.

**Fix:** Remove `setupBeerWaitlistForm()` from `js/modules/12-checkout.js`, its call site in `js/modules/13-init.js:376`, the `setupBeerWaitlistFormForTest` test export, `tests/frontend/checkout-waitlist.test.js`, and — if not used by any other feature — the `/api/waitlist` route in `zoho-middleware/` (not in review scope here, but worth a follow-up check). Run `npm run build` afterward to regenerate `main.js`/`main.min.js`.

---

_Reviewed: 2026-08-22_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
