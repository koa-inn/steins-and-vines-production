# Phase 9: Content & SEO Push - Pattern Map

**Mapped:** 2026-05-04
**Files analyzed:** 7 new/modified files
**Analogs found:** 7 / 7

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `products/ferment-in-store.html` | template (landing page) | request-response | `products/ingredients-supplies.html` | exact |
| `products/ingredients-supplies.html` | template (landing page) | request-response | `products/ferment-in-store.html` | exact |
| `index.html` | template (homepage) | request-response + event-driven | `index.html` itself (existing sections) | self-analog |
| `about.html` | template (about page) | request-response | `about.html` itself (existing story section) | self-analog |
| `content/reviews.json` | config | transform | `content/home.json` | role-match |
| `css/styles.css` | stylesheet | transform | `css/styles.css` itself (`.how-it-works-step`, `.owner-card`) | self-analog |
| `js/modules/13-init.js` | utility (render function) | event-driven | `js/modules/13-init.js` `loadFAQ()` and `initPromoBanner()` | exact |

---

## Pattern Assignments

### `products/ferment-in-store.html` (landing page — inline SEO copy section)

**Analog:** `products/ingredients-supplies.html` (same structure), `index.html` `.intro` sections

**Insertion point:** Between `</section>` (`.page-header`) and `<section class="catalog-section">` (line 102–103 of ferment-in-store.html).

**Section structure pattern** (from `index.html` lines 261–288):
```html
<section class="intro">
  <div class="container">
    <h2>Make Your Own Wine in Squamish</h2>
    <p><!-- SEO paragraph --></p>
  </div>
</section>

<div class="section-icon">
  <img src="../images/Icon_wine.svg" alt="" aria-hidden="true" loading="lazy">
</div>

<section class="intro">
  <div class="container">
    <h2><!-- Next heading --></h2>
    <p><!-- Next paragraph --></p>
  </div>
</section>
```

**Facility photo pattern** (from `about.html` lines 156, 169):
```html
<img src="../images/facility/facility-01.jpg"
     alt="Wine fermentation tanks at Steins &amp; Vines, Squamish BC"
     class="story-image"
     loading="lazy"
     width="1200" height="800">
```
Note: use `../images/facility/` path prefix (landing pages are one level deep in `products/`). Reuse `.story-image` CSS — already styled with rustic brown border (`border: 8px solid var(--color-brown)`, `border-radius: var(--radius-sm)`, `box-shadow`).

**CTA button pattern** (from `about.html` line 140):
```html
<a href="#product-catalog" class="btn">Browse Wine Kits</a>
```

**No changes needed to:** head, meta tags, JSON-LD, GTM, nav, footer, or any JS — only the `<main>` content between `.page-header` and `.catalog-section` changes.

---

### `products/ingredients-supplies.html` (landing page — inline SEO copy section)

**Analog:** `products/ferment-in-store.html` (identical structure)

Same insertion point and patterns as ferment-in-store.html above. Photo path is `../images/facility/`. CTA links to `#product-catalog` and switches to the ingredients tab:
```html
<a href="#product-catalog" class="btn">Browse Ingredients &amp; Supplies</a>
```

---

### `index.html` (homepage — testimonials section)

**Analog:** Existing `.intro` sections (lines 261–288) and `.how-it-works-steps` grid (lines 230–255).

**Insertion point:** After the closing `</section>` of the "Why Make Your Own Wine?" section and its following `.section-icon` divider. The decision (D-12) says after "Why Make Your Own Wine?" — so the testimonials section goes before the "Homebrew Supplies in Squamish" `.intro` section.

**Section wrapper pattern** (matches existing `.intro` section rhythm):
```html
<section class="testimonials">
  <div class="container">
    <h2>What Our Customers Say</h2>
    <div class="testimonials-grid" id="testimonials-grid">
      <!-- Populated by content loader from content/reviews.json -->
    </div>
  </div>
</section>

<div class="section-icon">
  <img src="images/Icon_wine.svg" alt="" aria-hidden="true" loading="lazy">
</div>
```

Note: homepage image paths have no `../` prefix — files are at root level.

**Facility photo insertion point:** Inside one of the existing `.intro` sections (e.g., "Homebrew Supplies in Squamish"). Insert after the paragraph text, using the same `<img>` pattern as about.html but with path `images/facility/filename.jpg` (no `../`).

---

### `about.html` (about page — facility photo)

**Analog:** `about.html` lines 156 (existing `<img class="story-image">`)

**Insertion point:** Inside the "Our Story" tab panel (`#about-panel-story`), after the existing `cheers.jpg` image or within a new `.content` section. Follow the existing rhythm: `.content` section > `.container` > `<h2>` + `<img class="story-image">`.

**Existing pattern** (`about.html` lines 150–160):
```html
<div id="about-panel-story" class="hidden" role="tabpanel" ...>
  <section class="content">
    <div class="container">
      <h2 data-content="story-title">Our Story</h2>
      <p data-content="story-text"></p>
      <p data-content="story-text-2">...</p>
      <img src="images/cheers.jpg" alt="Cheers at Steins &amp; Vines"
           class="story-image" loading="lazy">
    </div>
  </section>

  <div class="section-icon">
    <img src="images/Icon_green.svg" alt="" aria-hidden="true" loading="lazy">
  </div>
  <!-- next section... -->
```

New facility photos follow the same `<img class="story-image" loading="lazy" width="..." height="...">` pattern with `images/facility/filename.jpg` paths (no `../` — about.html is at root level).

---

### `content/reviews.json` (new file — review data)

**Analog:** `content/home.json` structure (array values under a named key)

**Structure pattern** (mirrors `promo-news` array in `content/home.json` lines 27–38):
```json
{
  "reviews": [
    {
      "name": "Sarah M.",
      "rating": 5,
      "text": "Great experience making our wine here...",
      "url": "https://g.page/r/PLACEHOLDER/review"
    },
    {
      "name": "James T.",
      "rating": 5,
      "text": "...",
      "url": "https://g.page/r/PLACEHOLDER/review"
    },
    {
      "name": "Erin K.",
      "rating": 5,
      "text": "...",
      "url": "https://g.page/r/PLACEHOLDER/review"
    }
  ]
}
```

**Key rules:**
- Top-level key is `"reviews"` (array of 3 objects per D-07).
- `url` must be the Google Business Profile reviews page URL — not a deep link to an individual review (D-09).
- File is `content/reviews.json`, NOT added to `content/home.json` (separate file per RESEARCH.md recommendation).
- Placeholder content ships; user fills in actual review text and URL before going live.

---

### `css/styles.css` (new `.testimonial-*` and `.landing-copy` classes)

**Analog:** `.how-it-works-steps` grid (lines 271–330) and `.owner-card` / `.story-image` styles (lines 2063–2130).

**Append location:** After the last existing section in styles.css (end of file), or in a new `/* ===== Testimonials ===== */` block following the existing `/* ===== Credits ===== */` block at line 2132.

**Testimonial grid — mirrors `.how-it-works-steps` CSS** (lines 271–330):
```css
/* ===== Testimonials ===== */
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
  background: var(--color-white);
  border: 1px solid rgba(74, 111, 75, 0.2);
  border-radius: var(--radius-sm);
  padding: 1.5rem;
  text-align: left;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
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
  margin: 0;
  padding: 0;
}

.testimonial-text p {
  margin: 0;
}

.testimonial-name {
  font-weight: 700;
  font-size: 0.875rem;
  color: var(--color-green);
}

.testimonial-link {
  font-size: 0.8rem;
  color: var(--color-burgundy);
  text-decoration: underline;
}

@media (max-width: 768px) {
  .testimonials-grid {
    grid-template-columns: 1fr;
  }
}
```

**Landing copy section — mirrors `.intro` CSS** (lines 1155–1181):
```css
/* ===== Landing Copy (SEO sections on product landing pages) ===== */
.landing-copy {
  padding: 3rem 0;
  text-align: center;
}

.landing-copy h2,
.landing-copy h3 {
  color: var(--color-green);
  margin-bottom: 1rem;
}

.landing-copy p {
  margin-left: auto;
  margin-right: auto;
  max-width: 800px;
}

.landing-copy .btn {
  margin-top: 1.5rem;
}
```

**Custom properties used** (verified from `css/styles.css` lines 118–138):
- `--color-green: #4a6f4b`
- `--color-brown: #77462d`
- `--color-burgundy: #370e13`
- `--color-cream: #e5dec1`
- `--color-text: #2c2c2c`
- `--color-white: #fff`
- `--radius-sm: 4px`
- `--font-body: 'Lato', 'Helvetica Neue', Arial, sans-serif`
- `--font-display: 'Playfair Display', Georgia, serif`

**After any CSS edit:** Run `npm run build` to regenerate `styles.min.css` — all HTML pages load the minified file.

---

### `js/modules/13-init.js` (new `loadTestimonials()` function)

**Analog:** `loadFAQ()` (lines 611–641) and `initPromoBanner()` (lines 1–50) in `js/modules/13-init.js`.

**Insertion point:** Add `loadTestimonials()` call inside the `if (page === 'home')` block (line 296–301), alongside `loadFeaturedProducts()`. Define the function body in the same file, following `loadFAQ()` as the style reference.

**Call site pattern** (from `js/modules/13-init.js` lines 296–301):
```javascript
if (page === 'home') {
  loadFeaturedProducts();
  initCartDrawer();
  setupBeerWaitlistForm();
  initPromoBanner();
  loadTestimonials(); // ADD THIS LINE
}
```

**Function body — copy from `loadFAQ()` pattern** (lines 611–641):
```javascript
function loadTestimonials() {
  var container = document.getElementById('testimonials-grid');
  if (!container) return;

  fetch('content/reviews.json')
    .then(function (res) { return res.ok ? res.json() : {}; })
    .then(function (data) {
      var reviews = data.reviews;
      if (!reviews || !reviews.length) return;

      var html = '';
      reviews.forEach(function (r) {
        var stars = '';
        for (var i = 0; i < 5; i++) {
          stars += i < r.rating ? '&#9733;' : '&#9734;';
        }
        html += '<div class="testimonial-card">'
          + '<div class="testimonial-stars" aria-label="' + r.rating + ' out of 5 stars">' + stars + '</div>'
          + '<blockquote class="testimonial-text"><p>' + escapeHTML(r.text) + '</p>'
          + '<footer class="testimonial-name">&mdash; ' + escapeHTML(r.name) + '</footer>'
          + '</blockquote>'
          + '<a href="' + escapeHTML(r.url) + '" class="testimonial-link"'
          + ' target="_blank" rel="noopener">View on Google</a>'
          + '</div>';
      });
      container.innerHTML = html;
    })
    .catch(function () { /* silently fail — testimonials are non-critical */ });
}
```

**Key rules (derived from `loadFAQ` and `initPromoBanner` patterns):**
- Always null-check the container before fetch — `if (!container) return;`
- Use `escapeHTML()` on all user-supplied fields (text, name, url) — globally available from `js/lib/utils.js` concatenated into `main.js`.
- `.catch()` silently fails — testimonials are non-critical UI.
- Use `target="_blank" rel="noopener"` on the Google link — matches all external links in the project.
- Semantic HTML: `<blockquote>` wrapping quote text, `<footer>` inside it for attribution — avoids `<cite>` misuse (per RESEARCH.md Pitfall 6).
- ES5 style throughout: `var`, `function`, no arrow functions, no template literals.

**After any JS module change:** Run `npm run build` to regenerate `js/main.js` and `js/main.min.js`. Never edit `main.js` directly.

---

## Shared Patterns

### Section Divider Icon
**Source:** `index.html` lines 257–259, 268–270, 279–281, 290–292
**Apply to:** Between every content section on all modified pages
```html
<div class="section-icon">
  <img src="images/Icon_wine.svg" alt="" aria-hidden="true" loading="lazy">
</div>
```
Note: Use `../images/Icon_green.svg` on landing pages (one level deep), `images/Icon_wine.svg` on homepage, `images/Icon_green.svg` on about page (matches existing usage per file).

### Lazy-Loaded Images with Dimensions
**Source:** `about.html` line 156; `index.html` line 258
**Apply to:** All facility photos on all modified pages
```html
<img src="images/facility/filename.jpg"
     alt="Descriptive alt text — Steins &amp; Vines, Squamish BC"
     loading="lazy"
     width="1200" height="800">
```
Both `width` and `height` are required to prevent CLS (Core Web Vitals). Actual values must match the real image dimensions once user provides photos.

### Container Wrapper
**Source:** Every section in the project
**Apply to:** All new `<section>` elements
```html
<section class="intro"><!-- or .testimonials, .landing-copy -->
  <div class="container">
    <!-- content -->
  </div>
</section>
```

### External Link Safety
**Source:** `about.html` line 140; `index.html` social links
**Apply to:** "View on Google" links in testimonial cards; any link to Google Business Profile
```html
<a href="https://g.page/r/..." target="_blank" rel="noopener">View on Google</a>
```

### HTML Entity Encoding
**Source:** `index.html` lines 263, 275 (`&amp;`, `&ndash;`, `&mdash;`)
**Apply to:** All inline HTML content (ampersands, dashes, special chars)
- `&` → `&amp;`
- `–` → `&ndash;`
- `—` → `&mdash;`
- `'` → leave as is in HTML (straight apostrophe fine in content)

### Build After CSS/JS Changes
**Source:** `CLAUDE.md`, `package.json`
**Apply to:** Every task that modifies `css/styles.css` or `js/modules/13-init.js`
```bash
npm run build
```
Regenerates `styles.min.css`, `main.js`, and `main.min.js`. Required before committing.

---

## No Analog Found

All files have close analogs in the codebase. No files require falling back to RESEARCH.md patterns only.

---

## Metadata

**Analog search scope:** `products/`, `index.html`, `about.html`, `css/styles.css`, `js/modules/`, `content/`
**Files scanned:** 8 source files read directly
**Pattern extraction date:** 2026-05-04
