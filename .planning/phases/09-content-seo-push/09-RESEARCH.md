# Phase 9: Content & SEO Push - Research

**Researched:** 2026-05-04
**Domain:** Static HTML content integration, CSS component design, SEO copywriting placement
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** Full landing page copy is provided in a content document. Two pages: "Ferment on Premise / U-Vin Winemaking" and "Homebrew Ingredients & Supplies". Copy is compliance-reviewed against BC FOP licence, CRTC code, and BC Liquor Regulation.
- **D-02:** Copy targets 3-5 primary keywords per page (u-vin squamish, homebrew supplies squamish, etc.) with 400-500 words each.
- **D-03:** The "[Insert address, hours, phone number]" placeholders in the copy should be omitted — that info is already in the header, footer, and about page site-wide.
- **D-04:** Professional facility/process photos are ready and will be provided by dropping files into the `images/` directory.
- **D-05:** Photos appear on three locations: the landing pages (ferment-in-store.html, ingredients-supplies.html), the homepage, and the about page. Not on the product grid page.
- **D-06:** Reviews are manually curated — hand-picked by the user and stored in a content JSON file (text, reviewer first name, star rating, link to Google Business Profile).
- **D-07:** 3 reviews displayed.
- **D-08:** Reviews appear on the homepage only.
- **D-09:** Each review card links to the Google Business Profile reviews page (not individual reviews, which Google doesn't support).
- **D-10:** Static cards row — three side-by-side cards that stack on mobile. Star rating, quote text, reviewer name, and "View on Google" link per card.
- **D-11:** Section heading only (e.g., "What Our Customers Say") — no Google logo or aggregate rating badge.
- **D-12:** Positioned after the "Why Make Your Own Wine?" section on the homepage.

### Claude's Discretion

- Where copy lives technically (inline HTML vs content JSON) — pick approach that best balances SEO crawlability and maintainability
- Copy placement on products.html in addition to landing pages (condensed intro vs landing pages only)
- Photo sizing, format, and optimization (WebP vs JPEG, responsive srcset or not)
- Whether review data lives in `content/home.json` or a separate `content/reviews.json`
- Testimonial card styling details (shadows, borders, font sizes) — match existing site design patterns
- Photo layout/placement within each page — break up text naturally

### Deferred Ideas (OUT OF SCOPE)

None — discussion stayed within phase scope.
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| SEO-01 | Ferment-in-store and ingredients/supplies product pages have unique landing page copy with SEO-targeted content | Landing page copy is inline HTML in the `<main>` before the catalog section; content loader not used for copy (SEO crawlability requires server-rendered HTML) |
| SEO-02 | Professional facility/process photos are added to key pages (homepage, product pages) | Photos land in `images/facility/`; placed inline with `<img loading="lazy">` in the relevant sections of ferment-in-store.html, ingredients-supplies.html, index.html, about.html |
| SEO-03 | Google Review testimonials displayed on the site with links back to original reviews for authenticity | Three review cards rendered via the content loader from review data stored in `content/home.json`; static HTML fallback included in index.html |
</phase_requirements>

---

## Summary

Phase 9 is a content integration phase with no new backend work and no middleware changes. All three requirements are fulfilled through HTML, CSS, and JSON file edits — exactly the kind of work this project has done before in the Apr 14 SEO overhaul and homepage polish sprints.

The primary decision Claude must make is the technical placement of SEO copy. The verdict: **inline HTML** in the landing pages, not the content loader. SEO copy must be present in the raw HTML served by GitHub Pages so Googlebot crawls it without executing JavaScript. The content loader uses `fetch()` and `innerHTML` — dynamically injected content is indexable in theory, but Google recommends serving critical SEO text in the initial HTML response to guarantee crawlability. [VERIFIED: codebase inspection of 13-init.js content loader pattern]

For review data storage, separate `content/reviews.json` is preferred over adding more arrays to `home.json`. The `home.json` file is already used by the promo banner and featured products loader; adding a third async dependency increases risk of key collisions and makes the file harder to maintain independently.

**Primary recommendation:** Write landing page copy as inline HTML sections inserted between `.page-header` and `.catalog-section` in each landing page. Add a `.testimonials` section to `index.html` populated by the content loader reading `content/reviews.json`. Place facility photos inline with `<img>` tags using `loading="lazy"` and organize them under `images/facility/`.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| SEO landing copy | Static HTML (GitHub Pages) | — | Must be in initial server response for guaranteed Googlebot indexing; content loader is JS-dependent |
| Review card rendering | Browser (content loader JS) | Static HTML fallback | Review data is non-critical for SEO; dynamic rendering from JSON is acceptable |
| Facility photo display | Static HTML (`<img>` tags) | — | Images are served statically; no JS needed |
| Photo optimization | Build/pre-commit | — | `scripts/optimize-images.js` exists; run before commit |
| CSS for testimonial cards | Static CSS (`styles.css`) | — | New `.testimonial-*` classes follow existing `.owner-card` / `.how-it-works-step` patterns |

---

## Standard Stack

### Core (all verified by codebase inspection)

| Library/Tool | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Vanilla JS (ES5) | — | All JS | Project-wide requirement; no framework |
| CSS custom properties | — | Theming | Colors, fonts, spacing defined in `:root` in `styles.css` |
| `content/{page}.json` + content loader | — | Dynamic copy | Established pattern for homepage and about page copy |
| `npm run build` | — | CSS/JS minification + cache-busting | Runs stamp:pages, minify:css, concat:js, terser |

[VERIFIED: codebase inspection of package.json, js/modules/13-init.js, css/styles.css]

### Supporting Tools

| Tool | Purpose | When to Use |
|------|---------|-------------|
| `scripts/optimize-images.js` | WebP/JPEG compression | Before committing facility photos |
| `npm run build` | Minify CSS, concatenate JS modules, cache-bust | After any CSS change (new `.testimonial-*` rules in styles.css require rebuild) |
| `loading="lazy"` attribute | Deferred image loading | All facility photos — below the fold |

[VERIFIED: codebase inspection — `scripts/optimize-images.js` exists]

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Inline HTML for copy | Content JSON + loader | JSON is easier to update without HTML knowledge, but Googlebot cannot guarantee indexing of JS-injected text; inline HTML is safer for SEO-critical pages |
| Separate `reviews.json` | Add reviews array to `home.json` | `home.json` already has promo-banner, promo-news, promo-featured-skus, and all homepage copy keys — adding reviews risks key sprawl; separate file is more maintainable |
| `<picture>` + WebP srcset | Plain `<img>` JPEG | WebP srcset is ideal for performance but adds HTML complexity and requires pre-built WebP variants; existing project pattern uses plain `<img loading="lazy">` consistently |

---

## Architecture Patterns

### System Architecture Diagram

```
User request (Googlebot or browser)
        |
        v
GitHub Pages (static file serving)
        |
        |-- Serves ferment-in-store.html with landing copy in HTML
        |-- Serves ingredients-supplies.html with landing copy in HTML
        |-- Serves index.html with testimonials placeholder div
        |-- Serves about.html with facility photo placeholders
        |
        v (browser only — not Googlebot)
content loader in 13-init.js (DOMContentLoaded)
        |
        |-- fetch('content/reviews.json')
        |-- fetch('content/shared.json')
        |-- Injects review cards into #testimonials-container
        |
        v
Visitor sees fully rendered page
```

### Recommended File/Folder Additions

```
images/
  facility/          # New subfolder for facility/process photos
    facility-01.jpg  # Individual numbered photos (names TBD by user)
    facility-02.jpg

content/
  reviews.json       # New file: 3 curated Google Review objects

css/
  styles.css         # New .testimonial-* classes appended to Section 12 or as new Section 45

products/
  ferment-in-store.html   # Landing copy added as new <section> before .catalog-section
  ingredients-supplies.html  # Same pattern
index.html           # New .testimonials section after .why-wine section
about.html           # Facility photos added to "Our Story" or new facility section
```

### Pattern 1: Inline Landing Copy in Landing Page HTML

**What:** A new `<section class="landing-copy">` inserted between `<section class="page-header">` and `<section class="catalog-section">` in each landing page.

**When to use:** Required for SEO-critical copy — must be in the initial HTML response.

**Example:**
```html
<!-- Source: verified pattern from existing .intro sections in index.html -->
<section class="landing-copy">
  <div class="container">
    <h2>Make Your Own Wine in Squamish</h2>
    <p><!-- SEO copy paragraph 1 --></p>

    <figure class="landing-photo">
      <img src="../images/facility/facility-01.jpg"
           alt="Wine fermentation tanks at Steins &amp; Vines, Squamish"
           loading="lazy"
           width="1200" height="800">
    </figure>

    <h3>What You Get</h3>
    <p><!-- SEO copy paragraph 2 --></p>
    <!-- ... remaining copy sections ... -->

    <a href="#product-catalog" class="btn">Browse Wine Kits</a>
  </div>
</section>
```

[VERIFIED: codebase inspection of ferment-in-store.html, index.html structure and existing `.intro` CSS pattern]

### Pattern 2: Review Cards via Content Loader

**What:** A `<section class="testimonials">` div in `index.html` containing a placeholder container. The content loader fetches `content/reviews.json` and injects card HTML.

**When to use:** For review data that the user will update independently — JSON is easier to edit than HTML.

**Example (index.html):**
```html
<!-- Source: adapted from existing content loader pattern in 13-init.js -->
<section class="testimonials">
  <div class="container">
    <h2>What Our Customers Say</h2>
    <div class="testimonials-grid" id="testimonials-grid">
      <!-- Populated by content loader from content/reviews.json -->
    </div>
  </div>
</section>
```

**Example (content/reviews.json):**
```json
{
  "reviews": [
    {
      "name": "Sarah M.",
      "rating": 5,
      "text": "Incredible experience making our wedding wine here...",
      "url": "https://g.page/r/XXXXX/review"
    }
  ]
}
```

**Example (13-init.js additions):**
```javascript
// Source: follows existing fetch+render pattern in loadFeaturedProducts()
if (page === 'home') {
  // ... existing calls ...
  loadTestimonials(); // new function
}

function loadTestimonials() {
  var container = document.getElementById('testimonials-grid');
  if (!container) return;
  fetch('content/reviews.json')
    .then(function(r) { return r.ok ? r.json() : {}; })
    .then(function(data) {
      var reviews = data.reviews;
      if (!reviews || !reviews.length) return;
      var html = '';
      reviews.forEach(function(r) {
        var stars = '';
        for (var i = 0; i < 5; i++) {
          stars += i < r.rating ? '&#9733;' : '&#9734;';
        }
        html += '<div class="testimonial-card">'
          + '<div class="testimonial-stars" aria-label="' + r.rating + ' out of 5 stars">' + stars + '</div>'
          + '<blockquote class="testimonial-text">' + escapeHTML(r.text) + '</blockquote>'
          + '<cite class="testimonial-name">' + escapeHTML(r.name) + '</cite>'
          + '<a href="' + escapeHTML(r.url) + '" class="testimonial-link" target="_blank" rel="noopener">View on Google</a>'
          + '</div>';
      });
      container.innerHTML = html;
    })
    .catch(function() { /* silently fail */ });
}
```

[VERIFIED: codebase inspection of 13-init.js — loadFeaturedProducts and loadFAQ follow identical fetch+render+escapeHTML pattern. `escapeHTML` is globally available from js/lib/utils.js, concatenated into main.js.]

### Pattern 3: Facility Photos

**What:** `<img>` tags with `loading="lazy"`, descriptive `alt` text, and explicit `width`/`height` to prevent layout shift.

**When to use:** Any facility/process photo on landing pages, homepage, about page.

**Example:**
```html
<!-- Source: existing pattern from about.html story-image, owner-photo -->
<figure class="facility-photo">
  <img src="../images/facility/facility-01.jpg"
       alt="Steins &amp; Vines wine fermentation facility in Squamish, BC"
       loading="lazy"
       width="1200" height="800"
       class="facility-photo-img">
</figure>
```

[VERIFIED: codebase inspection — about.html uses `<img class="story-image" loading="lazy">` and `.story-image { border: 8px solid var(--color-brown); border-radius: var(--radius-sm); }` in styles.css]

### Pattern 4: CSS for New Components

**What:** New CSS classes added to `styles.css` following existing naming conventions. New section appended or integrated into existing Section 12 (Owner Grid + Credits).

**Testimonial cards pattern — mirrors `.how-it-works-step` grid and `.owner-card` styles:**

```css
/* Source: adapted from how-it-works-steps (line 271) and owner-card (line 2063) patterns */
.testimonials {
  padding: 3rem 0;
  text-align: center;
}

.testimonials h2 {
  color: var(--color-green);
  margin-bottom: 2rem;
}

.testimonials-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 1.5rem;
  margin-top: 1rem;
}

.testimonial-card {
  background: white;
  border: 1px solid rgba(74, 111, 75, 0.2);
  border-radius: var(--radius-sm);
  padding: 1.5rem;
  text-align: left;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  box-shadow: 0 2px 8px rgba(0,0,0,0.08);
}

.testimonial-stars {
  color: var(--color-brown);
  font-size: 1.1rem;
  letter-spacing: 0.05em;
}

.testimonial-text {
  font-style: italic;
  font-size: 0.95rem;
  line-height: 1.6;
  color: var(--color-text);
  flex: 1;
}

.testimonial-name {
  font-weight: 700;
  font-style: normal;
  font-size: 0.875rem;
  color: var(--color-green);
}

.testimonial-link {
  font-size: 0.8rem;
  color: var(--color-burgundy);
  text-decoration: underline;
  align-self: flex-start;
}

/* Mobile: stack to single column */
@media (max-width: 768px) {
  .testimonials-grid {
    grid-template-columns: 1fr;
  }
}
```

[VERIFIED: codebase inspection — CSS custom properties confirmed: `--color-green: #4a6f4b`, `--color-brown: #77462d`, `--color-burgundy: #370e13`, `--color-cream: #e5dec1`, `--color-text: #2c2c2c`, `--font-body: 'Lato'`, `--font-display: 'Playfair Display'`, `--radius-sm` used by `.owner-photo` and `.story-image`]

### Anti-Patterns to Avoid

- **Putting SEO copy in the content loader only:** Google can render JavaScript, but Google's official guidance favors initial-HTML delivery for guaranteed indexing. The landing pages are the SEO anchors — their copy must be in raw HTML. [CITED: Google Search Central documentation pattern — confirmed by industry standard; ASSUMED for exact current advice]
- **Editing `js/main.js` directly:** It is a build artifact. The `loadTestimonials` function must be added to `js/modules/13-init.js`, then `npm run build` regenerates `main.js` and `main.min.js`. [VERIFIED: CLAUDE.md, package.json]
- **Forgetting to run `npm run build` after CSS changes:** New `.testimonial-*` classes are in `styles.css`; `styles.min.css` is what the pages load. Build is required. [VERIFIED: package.json build script, all HTML pages link `styles.min.css`]
- **Photos without explicit `width`/`height`:** Without these attributes, the browser cannot reserve layout space before the image loads, causing cumulative layout shift (CLS), which hurts Core Web Vitals. [ASSUMED — standard web performance best practice]
- **Using non-`escapeHTML` string interpolation for user-supplied review text:** The content comes from `reviews.json` which is maintained by the user. Even though it is not user input in the traditional sense, `escapeHTML` should be applied — consistent with the existing `loadFAQ` and other render functions. [VERIFIED: codebase inspection — `loadFAQ` calls `escapeHTML(faq.question)` and `escapeHTML(faq.answer)`]
- **Linking to individual Google reviews:** Google does not provide stable deep links to individual reviews. The correct target is the Google Business Profile reviews tab URL. [VERIFIED: confirmed in DISCUSSION-LOG.md based on user's research]
- **Adding photos to products.html (the product grid page):** D-05 explicitly excludes the product grid page. Photos go on landing pages, homepage, and about page only.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Image optimization | Custom compress script | `npm run optimize-images` (`scripts/optimize-images.js`) | Already exists in project |
| HTML escaping | String replace or regex | `escapeHTML()` from `js/lib/utils.js` (global in `main.js`) | Already handles `<`, `>`, `&`, `"`, `'` |
| Content injection | New fetch+render system | Existing content loader pattern in `13-init.js` | `fetch('content/{file}.json')` → `el.innerHTML` is the established pattern |
| Lazy loading | Intersection Observer JS | Native `loading="lazy"` attribute | Supported by all modern browsers; no polyfill needed |

---

## Runtime State Inventory

Step 2.5 SKIPPED — this is not a rename/refactor/migration phase. No runtime state is renamed or migrated.

---

## Environment Availability

Step 2.6: Checking dependencies.

| Dependency | Required By | Available | Notes |
|------------|------------|-----------|-------|
| `npm run build` | CSS/JS minification | Yes | Confirmed by package.json |
| `scripts/optimize-images.js` | Photo optimization | Yes (file exists) | Run before committing photos |
| `node` | Build scripts | Yes (Darwin platform) | Used throughout project |

No external services required. All changes are static files served via GitHub Pages.

**Image files (facility photos):** The user will provide these by dropping them into `images/`. The planner should include a task that waits for the user to provide photos before the photo-placement task executes, or structure the plan so photo tasks are clearly marked as "requires user-provided files."

---

## Common Pitfalls

### Pitfall 1: Copy in Content JSON Breaks SEO Guarantee

**What goes wrong:** Landing page copy is placed in `content/ferment-in-store.json` and loaded via the content loader. Googlebot may or may not execute the JavaScript — Google's recommendation is to deliver critical ranking content in the initial HTML.

**Why it happens:** The content loader is a convenient pattern already used on the site, so it feels like the right tool.

**How to avoid:** Put SEO copy inline in the HTML of `ferment-in-store.html` and `ingredients-supplies.html`. Reserve the content loader for supplementary homepage content (reviews, promo banners) where dynamic loading is acceptable.

**Warning signs:** Check by viewing page source (Ctrl+U / Cmd+U) — if the copy is not visible in raw HTML, Googlebot may not see it.

### Pitfall 2: `npm run build` Not Run After CSS Changes

**What goes wrong:** New `.testimonial-*` and `.landing-copy` classes are added to `styles.css` but `styles.min.css` is not regenerated. Pages load the minified file, so new styles are invisible.

**Why it happens:** Developer edits `styles.css` and tests in a browser with the CDN-cached minified file.

**How to avoid:** Always run `npm run build` after any CSS edit. Confirm the build updated `styles.min.css` by checking its modified timestamp.

**Warning signs:** Styles appear to do nothing in the browser despite correct class names.

### Pitfall 3: Service Worker Caches Old CSS/JS After Deploy

**What goes wrong:** Visitor or QA tester sees old layout/styles after deploying to staging or production because the service worker (`sw.js`) aggressively caches `styles.min.css` and `main.min.js`.

**Why it happens:** `sw.js` uses a cache-first strategy. The `CACHE_VERSION` is only updated by `npm run stamp:sw`.

**How to avoid:** After deploy, hard-refresh (Cmd+Shift+R / Ctrl+Shift+R) during QA. The `npm run build` process runs `stamp:pages` and `stamp:index` which update the `?v=` query string on CSS/JS references — this causes the service worker to invalidate on next navigation.

**Warning signs:** Copy or card styles are not visible after deploy despite successful git push.

### Pitfall 4: Photos Missing `alt` Text or Dimension Attributes

**What goes wrong:** Facility photos have empty `alt=""` or missing `width`/`height` attributes. This hurts accessibility (WCAG 1.1.1) and Core Web Vitals (CLS).

**Why it happens:** Photos are added quickly without filling in attributes.

**How to avoid:** Every `<img>` for a facility photo must have a descriptive `alt` (e.g., "Wine fermentation tanks at Steins & Vines in Squamish, BC"), explicit `width`, and `height` matching the actual image dimensions.

**Warning signs:** Chrome DevTools Lighthouse flags missing alt text; layout shifts visible in Performance tab.

### Pitfall 5: CSP Blocks Locally Hosted Images on Landing Pages

**What goes wrong:** The landing pages (`products/ferment-in-store.html`, `products/ingredients-supplies.html`) do NOT have a `Content-Security-Policy` meta tag. The homepage (`index.html`) and about page (`about.html`) DO have CSPs. Facility photos are served from the same origin (`self`) — this is not a CSP problem for images. However, if any external CDN URL is accidentally used for photos, it will be blocked.

**Why it happens:** Photos are `<img src="../images/facility/...">` — same-origin, no CSP issue. The risk is only if someone links to an external image URL.

**How to avoid:** Always use relative paths for facility photos: `../images/facility/filename.jpg` on landing pages, `images/facility/filename.jpg` on root-level pages.

**Warning signs:** Image fails to load and DevTools console shows CSP violation error.

### Pitfall 6: `blockquote` / `cite` Semantic Misuse

**What goes wrong:** Review quote text is wrapped in a `<blockquote>` but the `<cite>` element is used incorrectly (cite is for titles of creative works, not person names in modern HTML).

**Why it happens:** `<cite>` is commonly (mis)used for attribution in testimonials.

**How to avoid:** Use `<blockquote>` for the quote text and `<p class="testimonial-name">` or `<footer>` inside the blockquote for the attribution. This is the semantically safer approach.

```html
<div class="testimonial-card">
  <div class="testimonial-stars" aria-label="5 out of 5 stars">&#9733;&#9733;&#9733;&#9733;&#9733;</div>
  <blockquote class="testimonial-text">
    <p>Great experience making wine here...</p>
    <footer class="testimonial-name">— Sarah M.</footer>
  </blockquote>
  <a href="..." class="testimonial-link" target="_blank" rel="noopener">View on Google</a>
</div>
```

[ASSUMED — HTML semantics guidance, not verified against a spec in this session]

---

## Code Examples

### How the Content Loader Works (verified from codebase)

```javascript
// Source: js/modules/13-init.js lines 166-197
var page = document.body.getAttribute('data-page');
if (page) {
  var sharedFetch = fetch('content/shared.json').then(...);
  var pageFetch = fetch('content/' + page + '.json').then(...);

  Promise.all([sharedFetch, pageFetch]).then(function(results) {
    var data = merge(results[0], results[1]);  // page-specific overrides shared
    document.querySelectorAll('[data-content]').forEach(function(el) {
      var k = el.getAttribute('data-content');
      if (data[k] !== undefined) el.innerHTML = data[k];
    });
  });
}
```

The content loader runs on `DOMContentLoaded` for ALL pages that have `data-page` on `<body>`. Pages `ferment-in-store` and `ingredients-supplies` already have `data-page` set and already fetch their page JSON. Adding `content/ferment-in-store.json` or `content/ingredients-supplies.json` would work for non-SEO content — but NOT for SEO copy.

### How `loadFeaturedProducts` Renders Cards (reference pattern)

```javascript
// Source: js/modules/06-featured.js — used as pattern reference for loadTestimonials
// Key takeaway: always use escapeHTML, always null-check containers, always catch errors
fetch('content/home.json')
  .then(function(r) { return r.ok ? r.json() : {}; })
  .then(function(data) {
    var items = data['promo-news'];
    if (!items) return;
    var html = items.map(function(item) {
      return '<div class="news-item"><h3>' + escapeHTML(item.title) + '</h3>...</div>';
    }).join('');
    container.innerHTML = html;
  })
  .catch(function() {});
```

### Existing `.intro` Section Pattern (HTML — from index.html)

```html
<!-- Source: index.html lines 261-266 — the "Why Make Your Own Wine?" section -->
<section class="intro">
  <div class="container">
    <h2 data-content="why-title">Why Make Your Own Wine?</h2>
    <p data-content="why-text">...</p>
  </div>
</section>

<div class="section-icon">
  <img src="images/Icon_wine.svg" alt="" aria-hidden="true" loading="lazy">
</div>
```

The testimonials section should follow this same container/section-icon rhythm.

### Build Command

```bash
# Run after editing styles.css or js/modules/13-init.js
npm run build
```

---

## State of the Art

| Old Approach | Current Approach | Notes |
|--------------|------------------|-------|
| Dynamically load ALL page copy from JSON | Inline HTML for SEO copy; JSON for supplementary/editable content | SEO copy goes inline; reviews/promo stay in JSON |
| Single `products.html` page | Separate `products/ferment-in-store.html` and `products/ingredients-supplies.html` | Both landing pages already exist with full boilerplate |

**Existing infrastructure already in place:**
- Both landing pages have canonical URLs, JSON-LD LocalBusiness schema, GTM, meta descriptions, og: tags [VERIFIED: file inspection]
- `sitemap.xml` and `robots.txt` exist at project root [VERIFIED: CONTEXT.md reference, confirmed in codebase]
- Content loader in `13-init.js` is the established pattern for all page-specific dynamic content

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Google guarantees indexing of initial-HTML copy but not JS-injected copy for landing pages | Common Pitfalls, Architecture Patterns | Low risk: inline HTML is always the safer choice regardless of current Googlebot JS capabilities |
| A2 | `--radius-sm` CSS variable exists and is used by `.owner-photo` and `.story-image` | Code Examples (CSS) | Minor: if it doesn't exist, use a literal value like `4px` |
| A3 | `<blockquote>/<footer>` is semantically preferred over `<cite>` for testimonial attribution in modern HTML | Common Pitfall 6 | Low risk: either approach is widely used; no functional difference |

---

## Open Questions

1. **Photo file names and actual photo count**
   - What we know: User will drop photos into `images/`. Subfolder `images/facility/` is the recommended convention.
   - What's unclear: File names are unknown until user provides photos. The planner cannot specify exact `src` attributes.
   - Recommendation: Plan should include a task "User provides facility photos" as a prerequisite gate, or plan tasks to accept placeholder filenames that the user fills in.

2. **Exact review content (text, names, URLs)**
   - What we know: Reviews are manually curated, 3 reviews, stored in a JSON file, user provides the content.
   - What's unclear: The actual review text and Google Business Profile URL are not known until the user provides them.
   - Recommendation: Plan should create the `content/reviews.json` with placeholder content and instruct the user to fill in the actual review data before the testimonials section goes live.

3. **Exact landing page copy text**
   - What we know: The full copy was provided in the discussion session and is in the DISCUSSION-LOG.md.
   - What's unclear: The DISCUSSION-LOG.md is marked "Audit trail only — do not use as input to planning." The copy itself is not in a file the executor can reference directly.
   - Recommendation: The plan should instruct the executor to read the DISCUSSION-LOG.md for the verbatim copy content, or the user should provide the copy as a file drop before the copy-writing task runs.

---

## Security Domain

`security_enforcement: true` in config. Phase involves static HTML/CSS/JSON only — no new endpoints, no authentication, no user input handling. Security considerations are minimal but documented.

### Applicable ASVS Categories (ASVS Level 1)

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | No | No new auth flows |
| V3 Session Management | No | No new session handling |
| V4 Access Control | No | Static content, no access control |
| V5 Input Validation | Partial | Review text in JSON is injected via `escapeHTML()` — required |
| V6 Cryptography | No | No new crypto |

### Known Threat Patterns for This Phase

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| XSS via review text injection | Tampering/Spoofing | `escapeHTML()` on all review fields before `innerHTML` injection |
| External link abuse (rel=noopener) | Tampering | All `target="_blank"` links must have `rel="noopener"` — prevents tab-nabbing |
| Google Business Profile URL validity | Spoofing | URL in `reviews.json` should be a `maps.google.com` or `g.page` URL, not arbitrary — validate visually before publish |

[VERIFIED: codebase inspection — `loadFAQ` uses `escapeHTML`; all external links in HTML use `rel="noopener"`]

---

## Sources

### Primary (HIGH confidence — codebase inspection)
- `products/ferment-in-store.html` — full page structure, no existing copy section
- `products/ingredients-supplies.html` — full page structure, same pattern
- `index.html` — homepage sections, `.intro` pattern, section-icon dividers
- `about.html` — owner-card, story-image patterns, facility photo reference
- `css/styles.css` — all CSS custom properties, `.intro`, `.owner-card`, `.how-it-works-step`, `.story-image` patterns
- `js/modules/13-init.js` — content loader implementation, `loadFAQ`, `loadFeaturedProducts` render patterns
- `content/home.json` — existing home page content structure
- `content/shared.json` — shared content across pages
- `package.json` — build scripts, `stamp:pages` list, concat:js order

### Secondary (MEDIUM confidence)
- CONTEXT.md decisions D-01 through D-12 — all user-locked decisions verified by reading the file
- DISCUSSION-LOG.md — confirms compliance-reviewed copy exists (not yet available as a named file)

### Tertiary (LOW confidence — not verified in this session)
- Google Search Central recommendation on JS-rendered vs. initial-HTML content for SEO (A1)
- HTML semantics for blockquote/cite usage (A3)

---

## Metadata

**Confidence breakdown:**
- Landing page copy placement (inline HTML): HIGH — based on existing page structure; decision is unambiguous
- Content loader for testimonials: HIGH — pattern verified from codebase
- CSS patterns: HIGH — all custom properties verified from styles.css
- SEO impact of inline-vs-JSON: MEDIUM — technically correct recommendation based on industry standard, exact current Google behavior is ASSUMED
- Photo optimization approach: MEDIUM — `scripts/optimize-images.js` exists, its exact API not inspected

**Research date:** 2026-05-04
**Valid until:** 2026-06-04 (stable project; no external APIs, no npm packages)
