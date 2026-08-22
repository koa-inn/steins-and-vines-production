# Phase 72: Beer & Cider Launch Announcement Pages — Pattern Map

**Mapped:** 2026-08-22
**Files analyzed:** 2 new pages + site-wide nav edit + `index.html` cards + `sitemap.xml` + `package.json` build list
**Analogs found:** 6 / 6 (every artifact has a concrete in-repo analog; one partial — see "No Analog Found")

> **Prime directive for this phase:** these pages must be *visually indistinguishable* from the existing
> site and invent **zero** new design primitives. Every block below already exists in `about.html`,
> `hops.html`, or `index.html` — copy verbatim, swap text. Do NOT rebuild the booking flow.

---

## File Classification

| New / Modified artifact | Role | Data Flow | Closest Analog | Match Quality |
|-------------------------|------|-----------|----------------|---------------|
| `beer.html` (new) | static content/marketing page | request-response (static) | `about.html` (shell) + `index.html` sections | exact (composite) |
| `cider.html` (new) | static content/marketing page | static | same as `beer.html` | exact (composite) |
| Nav links (Beer+Cider) — edit **all public pages** | shared partial (inline-duplicated) | n/a | `index.html` nav block (lines 134-157) | exact |
| `index.html` feature cards | homepage section | static | `index.html` `.beer-banner` (222-235) + `.promo-grid` (190-207) | role-match |
| Booking CTA (button) | link into existing flow | request-response | `index.html` hero CTA (172) → `products/ferment-in-store.html` | exact |
| Placeholder images | asset ref | file-I/O | `about.html` `<picture>` (180-187) | exact |
| `sitemap.xml` entries | config | n/a | existing `<url>` entries | exact |
| `package.json` `stamp:pages` list | build config | n/a | line 17 hardcoded array | exact |

---

## Pattern Assignments

### `beer.html` / `cider.html` (static content pages)

These are **composite** pages: take the **page shell from `about.html`** (it is the cleanest non-catalog
content page — no cart/catalog JS baggage that `hops.html` carries) and **fill the `<main>` with section
primitives lifted from `index.html`**.

#### 1. `<head>` boilerplate — copy VERBATIM from `about.html` lines 1-76, change only text fields

Copy exactly, editing only the marked lines:
- **GTM script** (`about.html` 4-10) — identical on every page, copy as-is.
- **meta/apple/manifest/theme-color** (11-18) — identical, copy as-is.
- **CSP `<meta>` (line 19)** — copy **VERBATIM**. Use the `about.html`/`hops.html` CSP, **NOT**
  `reservation.html`'s (that one adds Helcim payment + `www.gstatic.com` origins the announcement pages
  don't need). The correct string to copy:

  ```html
  <meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' 'unsafe-inline' https://www.googletagmanager.com https://tracker.metricool.com https://connect.facebook.net https://www.googleadservices.com https://googleads.g.doubleclick.net; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https://www.googletagmanager.com https://www.google-analytics.com https://www.facebook.com https://www.google.com https://www.google.ca https://googleads.g.doubleclick.net https://*.google-analytics.com; connect-src 'self' https://docs.google.com https://*.googleusercontent.com https://script.google.com https://sheets.googleapis.com https://www.googleapis.com https://svmiddleware-production.up.railway.app https://svmiddleware-staging.up.railway.app https://o4511012754358272.ingest.de.sentry.io https://www.google-analytics.com https://www.googletagmanager.com https://*.analytics.google.com https://tracker.metricool.com https://www.facebook.com https://www.google.com https://googleads.g.doubleclick.net https://www.googleadservices.com https://*.google-analytics.com; frame-src 'self' https://www.googletagmanager.com https://www.google.com https://td.doubleclick.net">
  ```

  This CSP **already whitelists the middleware** (`svmiddleware-production…` and `…-staging…` in
  `connect-src`) so a booking CTA that fetches the middleware needs **no CSP change**. Because the
  announcement pages themselves only *link* to the booking flow (they don't embed the timeslot picker),
  no payment/Helcim origins are needed either.
- **`facebook-domain-verification`** (20) — copy as-is.
- **CHANGE per page:** `meta description` (21), `og:title` (22), `og:description` (23), `og:url` (25),
  `canonical` (29), `<title>` (30). Follow the exact wording style — note the site uses **clean URLs**
  (`og:url`/`canonical` = `https://steinsandvines.ca/beer`, no `.html`; GitHub Pages serves `beer.html`
  at `/beer`).
- **JSON-LD LocalBusiness block** (31-66) — identical on every page, copy as-is.
- **font preconnect/preload + favicon** (67-73) — copy as-is.
- **Stylesheets (74-76):** announcement pages need **ONLY** `css/styles.min.css` (all primitives below live
  there — verified: `.hero`, `.intro`, `.content`, `.page-header`, `.beer-banner*`, `.how-it-works-steps`,
  `.faq-list`, `.btn`, `.btn-secondary` all present in `css/styles.css`). Do **not** pull
  `search-overlay`, `hops`, or `catalog-subpage` CSS. So:
  ```html
  <link rel="stylesheet" href="css/styles.min.css?v=PLACEHOLDER">
  ```
  (The `?v=` stamp is filled by `npm run build` — see Shared Patterns → Build.)

#### 2. Header + nav — copy VERBATIM from `index.html` lines 112-159 (the CURRENT canonical nav)

Use `index.html`'s header/nav as the source of truth (it has the newest nav: Products mega-dropdown +
`nav-search-item`). Set `data-page="beer"` / `data-page="cider"` on `<body>`. Add the Beer/Cider links per
**Nav change** below. Set the active page's own link/`<li>` to `class="active"`.

#### 3. `<main>` content — assemble from `index.html` primitives (spec §"Page structure" 1-7)

| Spec section | Use this existing primitive | Source (copy + swap text) |
|---|---|---|
| 1. Hero / announcement banner | `.beer-banner .beer-banner--green` with `.beer-banner-badge` + `h2` + `p` | `index.html` 222-235 — **best analog for "now available" announcement**; drop the waitlist `<form>`, keep badge ("Now Available") + headline + subhead |
| (alt hero) | `.hero` + `.hero-ctas` | `index.html` 162-176 — if a full-width hero is wanted instead of the banner |
| 2. What it is | `<section class="intro"><div class="container"><h2><p>` | `index.html` 211-216 / 241-246 |
| 3. Availability & dates | `.how-it-works-steps` / `.how-it-works-step` OR a simple `<dl>`/table inside `.content` | `index.html` 256-277 for the stepped/scannable block. **No dedicated price/availability table primitive exists — see "No Analog Found".** |
| 4. Price | `.intro` paragraph, mirror existing price copy voice ("Wine kits start at $190…") | `index.html` 255 / 288 |
| 5. Primary CTA | `.btn` link → `products/ferment-in-store.html`; secondary `.btn-secondary` or `tel:` fallback | `index.html` 172-173 (hero CTA), `about.html` 164 (`.btn` + directions) |
| 6. Short FAQ (optional) | `.faq-list` container (about.html renders it via JS, but a static FAQ can use plain `<h3>/<p>` inside `.content`) | `about.html` 145-147 (`faq-list`); static Q&A → `.content` |
| 7. Cross-link | `.btn` links to the sibling page + `index.html` | pattern: `index.html` 172; use plain `.btn`/`.btn-secondary` |

> **Section rhythm:** the site separates content sections with a decorative divider
> `<div class="section-icon"><img src="images/Icon_wine.svg" alt="" aria-hidden="true" loading="lazy"></div>`
> (`index.html` 218-220, 237-239, …). Interleave these between sections for on-brand spacing. Consider
> `images/Icon_green.svg` (used in `about.html` 150-152) as an alternate.

#### 4. Footer — copy VERBATIM from `about.html` lines 287-310 (identical to `hops.html`/`index.html`)

Includes social SVGs, footer logo, address, `#footer-hours`, land acknowledgement, copyright. No changes.

#### 5. Scripts — copy the MINIMAL set from `about.html` 312-315 (drop the search-overlay lines)

Announcement pages need nav toggle / header status / footer hours behaviour from `main.min.js` only:
```html
<script src="js/vendor/sentry.min.js"></script>
<script src="js/sentry-init.js"></script>
<script src="js/sheets-config.js" defer></script>
<script src="js/main.min.js?v=PLACEHOLDER" defer></script>
```
Do **not** add page-specific `js/modules/*` bundles (no catalog/cart/search on these pages). Because you
add **no new JS module**, `npm run build`'s module-concatenation step is not strictly required for
behaviour — but you still must run `build` to stamp `?v=` (see Build). **Never hand-edit the `?v=` value.**

---

## Nav change (add Beer + Cider) — inline-duplicated, currently INCONSISTENT

**Critical finding:** the nav is **hand-duplicated inline in every HTML file** — there is **no JS/partial
include or build-time nav injection**. Worse, it has drifted: pages carry *different* nav versions.

- **Canonical (newest) nav** = `index.html` lines 134-157 and `about.html` 98-121 — has the Products
  mega-dropdown (Ferment / Custom Labels / divider / All Ingredients + indented sub-items) **and** the
  `nav-search-item` search button.
- **Stale/older nav** (missing `nav-search-item`, simpler dropdown): `hops.html` (126-142),
  `ingredients.html`, `products.html`, `404.html`.

**Edit pattern:** add two `<li>` entries to the `.nav-list` on every **public** page. Simplest on-brand
placement is two top-level links between Products and About:
```html
<li><a href="beer.html">Beer</a></li>
<li><a href="cider.html">Cider</a></li>
```
(Alternatively nest them under the Products dropdown — but top-level matches their "launch" prominence.)
Set `class="active"` on the matching link within `beer.html`/`cider.html` themselves.

**Files that MUST change (public nav — keep them consistent):**
`index.html`, `about.html`, `contact.html`, `custom-labels.html`, `hops.html`, `ingredients.html`,
`products.html`, `reservation.html`, `404.html`, and all of `products/*.html`
(`ferment-in-store`, `ingredients-supplies`, `hops`, `grains`, `yeast`, `additives`, `packaging`,
`equipment`).

**Out of scope (staff/app pages, different or no public nav):** `admin.html`, `kiosk.html`,
`brewpad.html`, `batch.html`.

**Precedent for a same-edit-across-all-pages change:** commit `43d49378`
("feat(catalog): hide out-of-stock items across all shop surfaces") touched `about.html`, `admin.html`,
`brewpad.html`, `contact.html`, `custom-labels.html`, `index.html`, `ingredients.html` together in one
commit — same mechanical multi-file edit shape the executor should follow here.

> **Recommendation to flag to planner:** the nav drift is a real smell (identical markup copy-pasted 15+
> times, already out of sync). Out of scope for this phase, but worth a follow-up to extract nav into a
> single JS-injected partial. For now: match the **`index.html` canonical nav** on every page you touch.

---

## `index.html` feature cards (homepage discovery)

Spec asks for "a launch feature/banner or two on-brand cards on `index.html` pointing to the new pages."

**Best analog:** the existing **`.beer-banner`** section (`index.html` 222-235) is *literally* a
launch-announcement banner already living on the homepage (currently "Beer Is Coming / Coming Soon /
waitlist"). Two clean options, both zero-new-CSS:

1. **Repurpose / add banners:** clone the `.beer-banner .beer-banner--green` block for Beer and add a
   second banner for Cider. Swap the "Coming Soon" badge → "Now Available", drop the waitlist `<form>`
   (lines 228-232), and replace it with a `.btn` linking to `beer.html` / `cider.html`. Note the
   `beer-banner--green` **modifier** exists (`css/styles.css` 1450-1462) — check for other colour
   modifiers to differentiate the two cards (e.g. give Cider a different accent if a modifier exists;
   otherwise both green is fine).
2. **Card grid:** the nearest card-grid primitive is `.promo-grid` (`index.html` 190-207). Less on-theme
   for an announcement than the banner; prefer option 1.

> **Note:** the current homepage "Beer Is Coming" waitlist banner is now factually stale once beer
> launches. Flag to owner: either convert it to the live "Now Available" Beer banner, or remove the
> waitlist. Do not silently leave a "Coming Soon" beer banner next to a live `beer.html`.

---

## Booking-flow CTA — REUSE, do not rebuild

**How booking actually works in this repo (so the executor doesn't reinvent it):**
- There is **no standalone booking page or embeddable booking widget**. The ferment-session booking
  (timeslot selection) is **Step 2 of the reservation checkout**: `reservation.html` `#timeslot-picker`
  (lines 190-197), driven by **`js/modules/12c-checkout-scheduling.js`**, which calls
  `MIDDLEWARE_URL + '/api/bookings/availability'` (line 92-93) and `+ '/api/bookings/slots?date=…'`
  (120-121). The booking is created in **`js/modules/12-checkout.js`** via
  `fetch(mw + '/api/bookings', {…})` (line 1510). Cal.com sits behind the middleware — not touched from
  the frontend.
- The **user-facing entry point** into that flow, used site-wide, is the **"Reserve Your Kit"** CTA →
  `products/ferment-in-store.html` (`index.html` hero, line 172). Choosing a kit there starts the
  reservation → timeslot booking.

**Therefore the announcement-page CTA is a plain link, matching the hero CTA exactly:**
```html
<a href="products/ferment-in-store.html" class="btn" data-content="beer-cta">Reserve Your Kit</a>
```
(Exact CTA label is a locked placeholder — see spec "Placeholders to fill.") Add a one-line fallback next
to it, e.g. `<a href="tel:+16045674565" class="btn-secondary">or call (604) 567-4565</a>` (phone pattern
from `about.html` 162 / header 129).

**Do NOT** embed the timeslot picker, add `/api/bookings*` fetches, or import module 12/12c into the new
pages. `MIDDLEWARE_URL` is already hostname-aware in `js/sheets-config.js` (65-75, staging vs prod,
fail-safe to prod) — nothing to configure. **No middleware changes in this phase** (spec-confirmed).

---

## Images — existing convention

**Analog:** `about.html` 179-198 and `index.html` 289-298 use responsive `<picture>`:
```html
<figure class="facility-photo">
  <picture>
    <source type="image/webp" srcset="images/facility/interior-800w.webp 800w, images/facility/interior-1600w.webp 1600w" sizes="(max-width: 800px) 100vw, 800px">
    <img src="images/facility/interior-1600w.jpg" alt="…descriptive…" loading="lazy" width="2880" height="1920" class="facility-photo-img">
  </picture>
</figure>
```
Convention: webp `<source>` with `srcset` (800w/1600w) + `sizes`, jpg `<img>` fallback, explicit
`width`/`height`, `loading="lazy"`, meaningful `alt`. Optimizer script exists at
`scripts/optimize-images.js`. Store new photos under `images/facility/` (existing folder) or a new
`images/launch/` subfolder. **Per spec, use flagged placeholders** — reference not-yet-existing filenames
(e.g. `images/launch/beer-1600w.jpg`) and list them in the "placeholders to fill" handoff, or reuse an
existing on-brand asset (e.g. `images/Icon_wine.svg`, `images/cheers.jpg`) as an interim. Never commit
multi-MB images.

---

## Shared Patterns

### CSP
**Source:** `about.html` line 19 (identical in `hops.html`, `index.html`, `contact.html`).
**Apply to:** both new pages. Copy verbatim; **do not** use `reservation.html`'s payment-augmented CSP.
Middleware origins already whitelisted → no edits needed for the booking CTA.

### ES5-only
**Source:** `eslint.config.js` — `ecmaVersion: 5`, `sourceType: 'script'`, applies to `js/**/*.js`
(rules: `eqeqeq: warn`, `no-console: warn`). Any inline `<script>` or new module must be ES5:
**no `let`/`const`, no arrow functions, no template literals, no `class`.** The new pages should ship
**no new inline JS** at all (all behaviour comes from existing `main.min.js`), which sidesteps this
entirely. `.min.js` and `js/main.js` are lint-ignored (they're build artifacts).

### Build / cache-stamp (`?v=`)
**Source:** `package.json` scripts `stamp:pages` (line 17) + `build` (line 18).
- The `?v=` cache-bust token on CSS/JS is written by `npm run build`, which runs `stamp:pages` — and
  **`stamp:pages` iterates a HARDCODED page array**. **`beer.html` and `cider.html` MUST be added to that
  array** (line 17) or their `?v=` will never update and CSP/asset caching will drift. This is a required
  build-config edit, not optional.
- Because the pages introduce **no new `js/modules/*`**, the module-concatenation into `main.js`/
  `main.min.js` is unchanged — but still run `npm run build` once so the two new pages get stamped and to
  keep artifacts consistent (`scripts/check-artifact-drift.sh` guards against drift).

### SEO / discovery config
- **`sitemap.xml`:** add `<url><loc>https://steinsandvines.ca/beer</loc>…</url>` and `/cider` entries,
  matching the existing clean-URL entries (`/about`, `/hops`, no `.html`). Copy an existing `<url>` block
  for `changefreq`/`priority` shape.
- **`robots.txt`** (161 B) and **`manifest.json`**: no change needed for content pages (manifest is the
  PWA app manifest, not a page list).

### Error/empty handling
n/a — these are static content pages with no data fetching. (If a future dynamic price feed is added it
would follow `js/modules/09-catalog-services.js` MIDDLEWARE_URL fetch shape, but that is out of scope.)

---

## No Analog Found

| Need | Nearest fit | Note |
|------|-------------|------|
| A dedicated **price / availability table or definition-list** primitive | `.how-it-works-steps` cards (`index.html` 256-277) or a hand-rolled `<dl>`/`<table>` inside `.content` | The site shows prices only as **inline prose** ("Wine kits start at $190…", `index.html` 255/288) — there is **no reusable pricing-table/card component**. Recommend the stepped `.how-it-works-step` cards for the scannable availability block, and inline prose for price, to stay on-pattern. If a small table is used, style it with existing `.content` typography only (no new CSS). |
| A generic **announcement/landing "hero" distinct from the wine homepage hero** | `.beer-banner` (`index.html` 222-235) | Good enough — it *is* an announcement banner. No new primitive required. |

Everything else maps cleanly to existing markup.

---

## Metadata

**Analog search scope:** repo root `*.html`, `products/*.html`, `css/styles.css`, `js/modules/`,
`js/sheets-config.js`, `eslint.config.js`, `package.json`, `sitemap.xml`.
**Primary analogs read in full:** `about.html`, `hops.html`, `js/sheets-config.js`; targeted reads of
`index.html`, `reservation.html`, `package.json`.
**Pattern extraction date:** 2026-08-22
