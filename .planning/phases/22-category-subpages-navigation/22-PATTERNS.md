# Phase 22: Category Subpages & Navigation - Pattern Map

**Mapped:** 2026-05-29
**Files analyzed:** 25 (6 new, 1 moved, 1 CSS addition, 1 build script, 9 nav-only updates, 7 sub-nav + nav updates)
**Analogs found:** 25 / 25

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `products/grains.html` | page (subpage) | request-response | `test-subpage.html` | exact |
| `products/yeast.html` | page (subpage) | request-response | `test-subpage.html` | exact |
| `products/additives.html` | page (subpage) | request-response | `test-subpage.html` | exact |
| `products/packaging.html` | page (subpage) | request-response | `test-subpage.html` | exact |
| `products/equipment.html` | page (subpage) | request-response | `test-subpage.html` | exact |
| `products/ingredients-supplies.html` | page (full rebuild — empty file) | request-response | `ingredients.html` (root, content source) + `test-subpage.html` (sub-nav, path prefix) | role-match |
| `products/hops.html` | page (moved from root) | request-response | `hops.html` (root, source of truth) | exact — path update only |
| `css/catalog-subpage.css` | stylesheet | transform | `css/catalog-subpage.css` (existing) + `css/styles.css` `.nav-dropdown*` (lines 455–513) | self + partial |
| `package.json` | config/build | batch | `package.json` `stamp:pages` (line 15) | self |
| `index.html` (nav update) | page | request-response | `index.html` lines 136–144 | self |
| `about.html` (nav update) | page | request-response | `index.html` lines 136–144 | role-match |
| `contact.html` (nav update) | page | request-response | `index.html` lines 136–144 | role-match |
| `custom-labels.html` (nav update) | page | request-response | `index.html` lines 136–144 | role-match |
| `products.html` (nav update) | page | request-response | `index.html` lines 136–144 | role-match |
| `reservation.html` (nav update) | page | request-response | `index.html` lines 136–144 | role-match |
| `test-subpage.html` (nav update) | page | request-response | `index.html` lines 136–144 | role-match |
| `ingredients.html` (nav update) | page (redirect shim) | request-response | `index.html` lines 136–144 | role-match |
| `products/ferment-in-store.html` (nav update) | page | request-response | `products/ferment-in-store.html` lines 92–104 | exact |

---

## Pattern Assignments

### `products/grains.html`, `products/yeast.html`, `products/additives.html`, `products/packaging.html`, `products/equipment.html` (subpage, request-response)

**Analog:** `test-subpage.html` — use as the literal copy template, swapping only SUBPAGE_CONFIG and `<title>`.

**Head pattern** (`test-subpage.html` lines 1–21):
```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <meta name="apple-mobile-web-app-title" content="Steins &amp; Vines">
  <link rel="apple-touch-icon" href="../images/apple-touch-icon.png">
  <link rel="manifest" href="../manifest.json">
  <meta name="theme-color" content="#4a6f4b">
  <meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' 'unsafe-inline' https://www.googletagmanager.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https://www.googletagmanager.com https://www.google-analytics.com; connect-src 'self' https://docs.google.com https://*.googleusercontent.com https://script.google.com https://sheets.googleapis.com https://www.googleapis.com https://svmiddleware-production.up.railway.app https://o4511012754358272.ingest.de.sentry.io https://www.google-analytics.com https://www.googletagmanager.com https://*.analytics.google.com; frame-src 'self' https://www.googletagmanager.com https://www.google.com">
  <title>[Category Name] | Steins &amp; Vines</title>
  <!-- font preconnect + preload identical to test-subpage.html lines 14-17 -->
  <link rel="icon" href="../images/Icon_green.svg" type="image/svg+xml">
  <link rel="stylesheet" href="../css/styles.min.css?v=STAMP">
  <link rel="stylesheet" href="../css/catalog-subpage.min.css?v=STAMP">
</head>
```

Key differences from `test-subpage.html` (root-relative):
- All asset paths get `../` prefix: `../images/`, `../css/`, `../js/`, `../manifest.json`
- `<body data-page="grains">` (etc.) — slug matches `SUBPAGE_CONFIG.categorySlug`
- GTM snippet from `hops.html` lines 4–10 must be added (test-subpage.html omits it)

**Body open + sub-nav pattern** (new in this phase — place immediately after `<main id="main">`):
```html
<body data-page="grains">
  <a href="#main" class="skip-to-content">Skip to content</a>
  <!-- header block identical to test-subpage.html lines 25-57, with:
       - logo href="../index.html"
       - nav links prefixed with "../" for root pages
       - nav-dropdown-menu updated to Phase 22 expanded format (see Shared Patterns) -->

  <main id="main">
    <nav class="ingredient-subnav" aria-label="Ingredient categories">
      <div class="container">
        <div class="subnav-pills">
          <a href="ingredients-supplies.html"  class="subnav-pill" data-subnav="all">All</a>
          <a href="hops.html"                  class="subnav-pill" data-subnav="hops">Hops</a>
          <a href="grains.html"                class="subnav-pill" data-subnav="grains">Grains</a>
          <a href="yeast.html"                 class="subnav-pill" data-subnav="yeast">Yeast</a>
          <a href="additives.html"             class="subnav-pill" data-subnav="additives">Additives</a>
          <a href="packaging.html"             class="subnav-pill" data-subnav="packaging">Packaging</a>
          <a href="equipment.html"             class="subnav-pill" data-subnav="equipment">Equipment</a>
        </div>
        <button type="button" class="subnav-search-btn" aria-label="Search ingredients (coming soon)" disabled>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
        </button>
      </div>
    </nav>

    <!-- subpage-hero, subpage-catalog-section — identical to test-subpage.html lines 60-90 -->
```

Note: Inside `products/`, all sub-nav hrefs are bare siblings (`grains.html`, not `products/grains.html`).

**Main content pattern** (`test-subpage.html` lines 59–90 — copy verbatim):
```html
    <section class="subpage-hero">
      <div class="container">
        <h1></h1>
        <p class="subpage-hero-desc"></p>
        <button type="button" class="subpage-hero-toggle">Read more</button>
        <div class="subpage-hero-full"></div>
      </div>
    </section>

    <section class="subpage-catalog-section">
      <div class="container">
        <div class="subpage-toolbar">
          <input type="text" id="subpage-search" placeholder="Search..." aria-label="Search">
          <select id="subpage-sort" aria-label="Sort">
            <option value="stock-first">In Stock First</option>
            <option value="name-asc">Name (A-Z)</option>
            <option value="name-desc">Name (Z-A)</option>
            <option value="price-asc">Price: Low to High</option>
            <option value="price-desc">Price: High to Low</option>
          </select>
          <div class="subpage-view-toggle" role="group" aria-label="View mode">
            <button type="button" class="view-toggle-btn active" data-view="grid" aria-label="Grid view">Grid</button>
            <button type="button" class="view-toggle-btn" data-view="list" aria-label="List view">List</button>
          </div>
          <div id="subpage-filter-row"></div>
        </div>
        <div id="subpage-catalog" class="subpage-catalog-section" aria-live="polite">
        </div>
      </div>
    </section>
  </main>
```

**Cart drawer pattern** (`test-subpage.html` lines 92–110 — copy verbatim, outside `<main>`):
```html
  <!-- Cart drawer and FAB outside <main> to avoid transform containing block -->
  <div class="cart-drawer-backdrop" id="cart-drawer-backdrop"></div>
  <div class="cart-drawer" id="cart-drawer">
    <div class="cart-drawer-header">
      <h3 id="cart-drawer-title">Your Cart</h3>
      <button type="button" class="cart-drawer-close" id="cart-drawer-close" aria-label="Close cart">&times;</button>
    </div>
    <div class="cart-drawer-items" id="cart-drawer-items">
      <p class="cart-sidebar-empty">Your cart is empty.</p>
    </div>
    <div class="cart-drawer-footer" id="cart-drawer-footer">
      <div class="cart-drawer-subtotal">
        <span>Subtotal</span>
        <span id="cart-drawer-total">$0.00</span>
      </div>
      <a href="../reservation.html" class="btn cart-drawer-checkout" id="cart-drawer-checkout">Checkout</a>
      <button type="button" class="btn-secondary cart-drawer-clear" id="cart-drawer-clear">Clear Cart</button>
    </div>
  </div>
```

Note: `reservation.html` link gets `../` prefix for pages inside `products/`.

**Footer pattern** (`test-subpage.html` lines 112–135 — copy verbatim, update image/link paths to `../`):
- `../images/SV_Logo_PrimaryCircle_offwhite.svg`
- `../images/SV_Logo_Wordmark_green.svg`

**Script block + SUBPAGE_CONFIG pattern** (`test-subpage.html` lines 137–156):
```html
  <script>
  window.SUBPAGE_CONFIG = {
    categorySlug: 'grains',
    categoryName: 'Grains',
    heroDescription: 'Base malts, specialty grains, and malt extracts for brewing.',
    heroDescriptionFull: 'Browse our selection of brewing grains in Squamish, BC. ...',
    accentColor: '#8b6f3a',
    subcategories: ['Grain', 'Malt Extract'],
    types: [],
    filterGroups: [],
    catalogContainerId: 'subpage-catalog'
  };
  </script>
  <script src="../js/sheets-config.js?v=dev"></script>
  <script src="../js/main.min.js?v=STAMP" defer></script>
  <script src="../js/modules/16-catalog-subpage.min.js?v=STAMP" defer></script>
```

SUBPAGE_CONFIG per category (from RESEARCH.md Code Examples):

| Page | categorySlug | accentColor | subcategories | types |
|---|---|---|---|---|
| grains.html | grains | #8b6f3a | ['Grain', 'Malt Extract'] | [] |
| yeast.html | yeast | #c4a035 | ['Yeast', 'Yeast Nutrient'] | [] |
| additives.html | additives | #6b5a9e | ['Additive', 'Flavoring', 'Fruit', 'Oak'] | [] |
| packaging.html | packaging | #4a7fa8 | ['Bottle', 'Bag'] | ['Packaging'] |
| equipment.html | equipment | #5a7a6a | ['Fermenter', 'Hose/Tubing'] | ['Equipment'] |

WARNING: subcategory values for yeast, additives, packaging, equipment are ASSUMED — verify against live `/api/ingredients` before finalizing (see RESEARCH.md Assumptions A1–A4).

---

### `products/ingredients-supplies.html` (page, full rebuild — file currently empty)

**Analog:** `ingredients.html` (root) lines 1–272 for full page content. Path adjustments and sub-nav must be applied.

This page is the "All" tab of the ingredient sub-nav. Decision D-10 says "existing code" — replicate `ingredients.html` with:
1. All asset paths changed from root-relative to `../` prefix
2. Sub-nav fragment injected immediately after `<main id="main">`
3. `data-page="ingredients"` on `<body>` (already present in `ingredients.html` at line 78 — keep as-is, drives sub-nav active state)
4. Nav dropdown updated to Phase 22 expanded format

**Head pattern** (`ingredients.html` lines 1–77 — copy, updating paths):
- `href="images/..."` → `href="../images/..."`
- `href="css/styles.min.css?v=..."` → `href="../css/styles.min.css?v=STAMP"`
- GTM snippet from `ingredients.html` lines 7–12 — keep
- CSP meta from `ingredients.html` line 22 — keep (same policy)

**Body opening** (`ingredients.html` line 78):
```html
<body data-page="ingredients">
```

**Sub-nav fragment** — inject immediately after `<main id="main">` (before `.page-header`):
```html
  <main id="main">
    <nav class="ingredient-subnav" aria-label="Ingredient categories">
      <div class="container">
        <div class="subnav-pills">
          <a href="ingredients-supplies.html"  class="subnav-pill" data-subnav="all">All</a>
          <a href="hops.html"                  class="subnav-pill" data-subnav="hops">Hops</a>
          <a href="grains.html"                class="subnav-pill" data-subnav="grains">Grains</a>
          <a href="yeast.html"                 class="subnav-pill" data-subnav="yeast">Yeast</a>
          <a href="additives.html"             class="subnav-pill" data-subnav="additives">Additives</a>
          <a href="packaging.html"             class="subnav-pill" data-subnav="packaging">Packaging</a>
          <a href="equipment.html"             class="subnav-pill" data-subnav="equipment">Equipment</a>
        </div>
        <button type="button" class="subnav-search-btn" aria-label="Search ingredients (coming soon)" disabled>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
        </button>
      </div>
    </nav>
    <!-- .page-header section follows -->
```

**Main content** (`ingredients.html` lines 104–241 — copy verbatim, adjust paths):
- `reservation.html` → `../reservation.html` (inside cart drawer and checkout link)
- `images/Icon_green.svg` → `../images/Icon_green.svg`

**Scripts** (`ingredients.html` lines 268–270):
```html
  <script src="../js/sheets-config.js" defer></script>
  <script src="../js/main.min.js?v=STAMP" defer></script>
```

No standalone module script needed — `08-catalog-ingredients.js` is already bundled into `main.min.js`.

---

### `products/hops.html` (moved from root — path updates + sub-nav add)

**Analog:** `hops.html` (root) lines 1–250 — this IS the source file. Only changes:
1. All root-relative paths get `../` prefix
2. Sub-nav fragment injected at the top of `<main id="main">`
3. Nav dropdown updated to Phase 22 expanded format

**Specific path changes** (from RESEARCH.md Pattern 5):
- `css/styles.min.css` → `../css/styles.min.css`
- `css/hops.min.css` → `../css/hops.min.css`
- `images/Icon_green.svg` → `../images/Icon_green.svg`
- `images/SV_Logo_Wordmark_green.svg` → `../images/SV_Logo_Wordmark_green.svg`
- `images/SV_Logo_PrimaryCircle_offwhite.svg` → `../images/SV_Logo_PrimaryCircle_offwhite.svg`
- `images/apple-touch-icon.png` → `../images/apple-touch-icon.png`
- `manifest.json` → `../manifest.json`
- `js/vendor/sentry.min.js` → `../js/vendor/sentry.min.js`
- `js/sentry-init.js` → `../js/sentry-init.js`
- `js/sheets-config.js` → `../js/sheets-config.js`
- `js/main.min.js` → `../js/main.min.js`
- `js/modules/15-hops.min.js` → `../js/modules/15-hops.min.js`
- `index.html` → `../index.html`
- `about.html` → `../about.html`
- `contact.html` → `../contact.html`
- `reservation.html` → `../reservation.html`

Nav dropdown paths (`hops.html` lines 131–139 — current root-relative, must become `products/`-relative):
- `products/ferment-in-store.html` → `ferment-in-store.html`
- `products/ingredients-supplies.html` → `ingredients-supplies.html`
- `hops.html` → `hops.html` (sibling — no change needed)
- `custom-labels.html` → `../custom-labels.html`

Hops sub-nav fragment path note: all sub-nav hrefs are bare siblings (`grains.html`, not `products/grains.html`).

**Sub-nav inject point** (`hops.html` line 145 — after `<main id="main">`, before `.hops-hero`):
```html
  <main id="main">
    <nav class="ingredient-subnav" aria-label="Ingredient categories">
      <!-- same sub-nav fragment as other products/ pages -->
    </nav>

    <section class="hops-hero">
```

The hops-specific `.hops-cart-fab` button (`hops.html` lines 214–217) stays — it is managed by `15-hops.js`, not the generic cart drawer.

---

### `css/catalog-subpage.css` (stylesheet addition — sub-nav + dropdown divider)

**Analog:** Existing `css/catalog-subpage.css` (538 lines, read in full). Append new rules at the end of the file.

**Existing file end** (line 538): file ends after `@media (max-width: 480px)` block.

**Append after line 538:**
```css
/* ===== Ingredient Sub-nav (Phase 22) ===== */

.ingredient-subnav {
  position: sticky;
  top: var(--header-height, 80px);
  z-index: 190; /* below header z-index:200, above page content */
  background: var(--color-cream);
  border-bottom: 1px solid rgba(74, 111, 75, 0.2);
  padding: 0.5rem 0;
}

.ingredient-subnav .container {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.subnav-pills {
  display: flex;
  align-items: center;
  gap: 6px;
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
  scrollbar-width: none;
  padding-bottom: 2px;
}

.subnav-pills::-webkit-scrollbar { display: none; }

.subnav-pill {
  display: inline-flex;
  align-items: center;
  padding: 6px 14px;
  min-height: 36px;
  border-radius: 20px;
  border: 1px solid var(--color-green);
  background: transparent;
  color: var(--color-green);
  font-family: var(--font-body);
  font-size: 0.8125rem;
  font-weight: 700;
  white-space: nowrap;
  text-decoration: none;
  transition: background 0.15s, color 0.15s;
}

.subnav-pill:hover {
  background: rgba(74, 111, 75, 0.08);
}

.subnav-pill:focus-visible {
  outline: 2px solid var(--color-green);
  outline-offset: 2px;
}

/* CSS-only active state — no JS needed (body[data-page] set per page) */
body[data-page="ingredients"] .subnav-pill[data-subnav="all"],
body[data-page="hops"]        .subnav-pill[data-subnav="hops"],
body[data-page="grains"]      .subnav-pill[data-subnav="grains"],
body[data-page="yeast"]       .subnav-pill[data-subnav="yeast"],
body[data-page="additives"]   .subnav-pill[data-subnav="additives"],
body[data-page="packaging"]   .subnav-pill[data-subnav="packaging"],
body[data-page="equipment"]   .subnav-pill[data-subnav="equipment"] {
  background: var(--color-green);
  color: var(--color-cream);
}

.subnav-search-btn {
  flex-shrink: 0;
  margin-left: auto;
  background: none;
  border: none;
  padding: 6px;
  min-height: 36px;
  min-width: 36px;
  cursor: not-allowed;
  color: var(--color-muted, #5f5f5f);
  opacity: 0.5;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
}

/* ===== Nav Dropdown Divider (Phase 22) ===== */

.nav-dropdown-divider {
  border-top: 1px solid rgba(74, 111, 75, 0.2);
  margin: 4px 0;
  pointer-events: none;
}

/* Widen dropdown to fit 7+ items without text wrapping */
.nav-dropdown-menu {
  min-width: 200px;
}
```

Note: The `.nav-dropdown-menu { min-width: 200px }` override is safe — it widens the existing `min-width: 180px` from `css/styles.css` line 470.

---

### `package.json` — `stamp:pages` list update

**Analog:** `package.json` line 15 — `stamp:pages` script with hardcoded file array.

**Current array** (from line 15):
```
['products.html','ingredients.html','reservation.html','about.html','contact.html',
 'products/ferment-in-store.html','products/ingredients-supplies.html','custom-labels.html',
 'hops.html','test-subpage.html']
```

**Required change:**
- Remove: `'hops.html'` (file moves to `products/hops.html`)
- Add: `'products/hops.html'`, `'products/grains.html'`, `'products/yeast.html'`, `'products/additives.html'`, `'products/packaging.html'`, `'products/equipment.html'`

**Resulting array:**
```javascript
['products.html','ingredients.html','reservation.html','about.html','contact.html',
 'products/ferment-in-store.html','products/ingredients-supplies.html','custom-labels.html',
 'test-subpage.html','products/hops.html','products/grains.html','products/yeast.html',
 'products/additives.html','products/packaging.html','products/equipment.html']
```

The `stamp:pages` regex replacements already cover `catalog-subpage.min.css` and `16-catalog-subpage.min.js` — no new regex needed. The new pages use those assets with `../` prefix but the regex `/catalog-subpage\.min\.css\?v=[^\"]+/g` matches regardless of directory prefix.

---

### 9 Existing Pages — Nav Dropdown Update Only

**Pattern:** Replace `.nav-dropdown-menu` `<ul>` contents with the Phase 22 expanded format.

**Root-level pages** (`index.html`, `about.html`, `contact.html`, `custom-labels.html`, `products.html`, `reservation.html`, `test-subpage.html`, `ingredients.html`):

Current pattern (`index.html` lines 138–143):
```html
<ul class="nav-dropdown-menu">
  <li><a href="products/ferment-in-store.html">Ferment in Store</a></li>
  <li><a href="products/ingredients-supplies.html">Ingredients &amp; Supplies</a></li>
  <li><a href="hops.html">Hops</a></li>
  <li><a href="custom-labels.html">Custom Labels</a></li>
</ul>
```

Replace with (root-level path prefix):
```html
<ul class="nav-dropdown-menu">
  <li><a href="products/ferment-in-store.html">Ferment in Store</a></li>
  <li><a href="custom-labels.html">Custom Labels</a></li>
  <li role="separator" class="nav-dropdown-divider"></li>
  <li><a href="products/ingredients-supplies.html">All Ingredients</a></li>
  <li><a href="products/hops.html">Hops</a></li>
  <li><a href="products/grains.html">Grains</a></li>
  <li><a href="products/yeast.html">Yeast</a></li>
  <li><a href="products/additives.html">Additives</a></li>
  <li><a href="products/packaging.html">Packaging</a></li>
  <li><a href="products/equipment.html">Equipment</a></li>
</ul>
```

**`products/ferment-in-store.html`** (the only existing `products/` page receiving nav update):

Current pattern (`products/ferment-in-store.html` lines 94–99):
```html
<ul class="nav-dropdown-menu">
  <li><a href="ferment-in-store.html">Ferment in Store</a></li>
  <li><a href="ingredients-supplies.html">Ingredients &amp; Supplies</a></li>
  <li><a href="../hops.html">Hops</a></li>
  <li><a href="../custom-labels.html">Custom Labels</a></li>
</ul>
```

Replace with (`products/`-relative path prefix):
```html
<ul class="nav-dropdown-menu">
  <li><a href="ferment-in-store.html">Ferment in Store</a></li>
  <li><a href="../custom-labels.html">Custom Labels</a></li>
  <li role="separator" class="nav-dropdown-divider"></li>
  <li><a href="ingredients-supplies.html">All Ingredients</a></li>
  <li><a href="hops.html">Hops</a></li>
  <li><a href="grains.html">Grains</a></li>
  <li><a href="yeast.html">Yeast</a></li>
  <li><a href="additives.html">Additives</a></li>
  <li><a href="packaging.html">Packaging</a></li>
  <li><a href="equipment.html">Equipment</a></li>
</ul>
```

---

## Shared Patterns

### GTM Snippet
**Source:** `hops.html` lines 4–10 (head) and lines 106–108 (body noscript)
**Apply to:** All 5 new subpages and `products/ingredients-supplies.html`
**Note:** `test-subpage.html` omits GTM — new production pages must include it.
```html
<!-- Google Tag Manager (head snippet) -->
<script>(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':
new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],
j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=
'https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);
})(window,document,'script','dataLayer','GTM-NHRCGLC5');</script>
<!-- End Google Tag Manager -->

<!-- Google Tag Manager (noscript, immediately after <body> open) -->
<noscript><iframe src="https://www.googletagmanager.com/ns.html?id=GTM-NHRCGLC5"
height="0" width="0" style="display:none;visibility:hidden"></iframe></noscript>
```

### CSP Meta Tag
**Source:** `hops.html` line 19 / `test-subpage.html` line 12
**Apply to:** All new and rebuilt pages
```html
<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' 'unsafe-inline' https://www.googletagmanager.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https://www.googletagmanager.com https://www.google-analytics.com; connect-src 'self' https://docs.google.com https://*.googleusercontent.com https://script.google.com https://sheets.googleapis.com https://www.googleapis.com https://svmiddleware-production.up.railway.app https://o4511012754358272.ingest.de.sentry.io https://www.google-analytics.com https://www.googletagmanager.com https://*.analytics.google.com; frame-src 'self' https://www.googletagmanager.com https://www.google.com">
```

### Footer Block
**Source:** `test-subpage.html` lines 112–135 (or `hops.html` lines 219–242)
**Apply to:** All 5 new subpages and `products/hops.html`
**Path adjustment:** All `images/` and `href` attributes get `../` prefix for `products/` pages.

### Skip-to-content Link
**Source:** `test-subpage.html` line 23
**Apply to:** All new pages
```html
<a href="#main" class="skip-to-content">Skip to content</a>
```

### Header Block
**Source:** `test-subpage.html` lines 25–57 (for new subpages in `products/`)
**Apply to:** All 5 new subpages
All `href` values in the header pointing to root-level pages get `../` prefix. Logo `href="../index.html"`.

### Sticky Sub-nav Z-index Rule
**Source:** `css/styles.css` line 241 (header `z-index: 200`) and line 471 (dropdown `z-index: 210`)
**Constraint:** Sub-nav must use `z-index: 190` — below header (200) and below dropdown (210).
**Dynamic top:** `top: var(--header-height, 80px)` — the CSS variable is set by `13-init.js` via ResizeObserver. The 80px fallback covers initial render before JS runs.

---

## No Analog Found

All files in scope have clear analogs. No entries in this section.

---

## Path Prefix Reference

| Page location | Asset prefix | Sibling nav prefix | Root nav prefix |
|---|---|---|---|
| Root (`index.html`, etc.) | `css/`, `js/`, `images/` | n/a | `products/filename.html` |
| `products/` (new subpages, hops, ingredients-supplies) | `../css/`, `../js/`, `../images/` | `filename.html` | `../filename.html` |

---

## Metadata

**Analog search scope:** project root, `products/`, `css/`, `js/modules/`
**Files scanned:** `test-subpage.html`, `hops.html`, `ingredients.html`, `products/ferment-in-store.html`, `products/ingredients-supplies.html` (empty), `css/catalog-subpage.css`, `css/styles.css` (nav + z-index sections), `index.html` (nav section), `package.json`
**Pattern extraction date:** 2026-05-29
