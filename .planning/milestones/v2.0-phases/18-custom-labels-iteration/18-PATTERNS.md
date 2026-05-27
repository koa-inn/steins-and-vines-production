# Phase 18: Custom Labels Iteration - Pattern Map

**Mapped:** 2026-05-18
**Files analyzed:** 5 (3 modified JS/CSS/HTML + 2 new image assets)
**Analogs found:** 3 / 3 (image files have no code analog — static assets only)

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `js/modules/14-labels.js` | utility/module | transform (canvas compositing) | `js/modules/14-labels.js` itself (extend) | self — extend in place |
| `css/labels.css` | config (styles) | n/a | `css/labels.css` itself (extend) | self — extend in place |
| `custom-labels.html` | view | request-response (static) | `custom-labels.html` itself (extend) | self — extend in place |
| `images/labels/can-photo.jpg` | asset | n/a | `images/labels/can-template.svg` | asset sibling — no code pattern |
| `images/labels/bottle-photo.jpg` | asset | n/a | `images/labels/bottle-template.svg` | asset sibling — no code pattern |

---

## Pattern Assignments

### `js/modules/14-labels.js` (utility/module, canvas transform)

**Analog:** `js/modules/14-labels.js` (lines 1–293 — full file already read)
**Secondary analog for data-constant pattern:** `js/lib/constants.js` (lines 1–50)
**Secondary analog for forEach-innerHTML table building:** `js/modules/13-init.js` (lines 654–701)

---

#### IIFE wrapper and 'use strict' (lines 1–3)

```javascript
// ===== Labels Mockup Tool =====
(function () {
  'use strict';
```

All module code lives inside this self-executing function. Nothing is attached to `window`. The CJS export block at the bottom is the only public surface.

---

#### LABEL_DATA constant pattern

Copy the style from `js/lib/constants.js` lines 11–41 — named ALL_CAPS var, array or object literal, plain `var`, one entry per line, comment block above explaining source:

```javascript
// js/lib/constants.js lines 1–6 (header comment pattern)
// ===== Steins & Vines — Shared Constants =====
// Canonical identifiers used across frontend modules.

// js/lib/constants.js lines 11–15 (named constant declaration)
var CART_KEYS = {
  FERMENT:             'sv-cart-ferment',
  INGREDIENTS:         'sv-cart-ingredients',
  LEGACY_RESERVATION:  'sv-reservation'
};
```

Apply to LABEL_DATA as an array of objects (from RESEARCH.md Pattern 1). Place it at the top of the IIFE body, before any function definitions, with a source comment:

```javascript
// Source: COGS - Labels.csv (verified 2026-05-18)
// D-07: JS constant — no server-side data needed
// D-08: SKUs 11013-c4000 and 11034-c4000 excluded (Used for packaging)
var LABEL_DATA = [
  { sku: '814051', name: '4x3 Satin BOPP',    w: 4,   h: 3,   material: 'bopp',  price: 0.45, containers: 'both',   uses: '355mL Beer Bottle, 750mL Wine Bottle, 355mL Can' },
  // ... (full list in RESEARCH.md Pattern 1)
];
```

---

#### Module state variables (lines 22–30)

All module state lives as `var` declarations at the top of the IIFE. Extend by adding three canvas/ctx pairs alongside the existing `_canvas`/`_ctx`. Use the same underscore-prefix convention:

```javascript
// js/modules/14-labels.js lines 22–30
var _canvas = null;
var _ctx = null;
var _currentTemplate = 'bottle';
var _templateImages = {};
var _placeholderImg = null;
var _userImage = null;
var _fileInput = null;
var _resetBtn = null;
```

New additions follow this exact pattern:
```javascript
var _canvasFlat = null;   var _ctxFlat = null;
var _canvasCan  = null;   var _ctxCan  = null;
var _canvasBottle = null; var _ctxBottle = null;
var _currentLabelType = null; // selected LABEL_DATA entry
```

---

#### roundedRect helper (lines 33–45)

Reuse this verbatim for all 3 canvas clip paths. Do not duplicate it — it is called from multiple render paths:

```javascript
// js/modules/14-labels.js lines 33–45
function roundedRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}
```

---

#### Cover-fit image scaling (lines 116–134)

This is the critical pattern to copy into all three render functions (flat, can, bottle). Do not rewrite it — copy it exactly into the new `renderPreview` helper:

```javascript
// js/modules/14-labels.js lines 116–134
var imgAspect = labelImg.naturalWidth / labelImg.naturalHeight;
var regionAspect = region.w / region.h;
var drawW, drawH, drawX, drawY;

if (imgAspect > regionAspect) {
  // Image is wider — fit to height, crop sides
  drawH = region.h;
  drawW = region.h * imgAspect;
  drawX = region.x - (drawW - region.w) / 2;
  drawY = region.y;
} else {
  // Image is taller — fit to width, crop top/bottom
  drawW = region.w;
  drawH = region.w / imgAspect;
  drawX = region.x;
  drawY = region.y - (drawH - region.h) / 2;
}

_ctx.drawImage(labelImg, drawX, drawY, drawW, drawH);
```

---

#### drawFallbackTemplate (lines 48–83)

Keep this function. Extend it with a third branch (or keep bottle/can as-is) — the function is the safety net for when photo JPEGs fail to load. No changes needed to the function signature; it references `_currentTemplate` and the global ctx. After Phase 18 refactor, it will need to accept a `ctx` and `type` parameter to work with 3 separate canvases:

```javascript
// js/modules/14-labels.js lines 48–83
function drawFallbackTemplate() {
  _ctx.fillStyle = '#e8e4d8';
  _ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
  if (_currentTemplate === 'bottle') { /* ... */ } else { /* ... */ }
}
```

Refactored signature for Phase 18: `function drawFallbackTemplate(ctx, type, w, h)` — same logic, parameterized.

---

#### File upload handler — validation pattern (lines 196–231)

The `validTypes` array and FileReader pattern must carry forward unchanged. The only change is that the final `render()` call becomes three calls (one per canvas):

```javascript
// js/modules/14-labels.js lines 196–231
function handleFileUpload(e) {
  var file = e.target.files && e.target.files[0];
  if (!file) return;

  if (file.size > MAX_FILE_SIZE) {
    alert('File is too large. Maximum size is 5 MB.');
    e.target.value = '';
    return;
  }

  var validTypes = ['image/png', 'image/jpeg', 'image/webp'];
  if (validTypes.indexOf(file.type) === -1) {
    alert('Invalid file type. Please upload a PNG, JPG, or WEBP image.');
    e.target.value = '';
    return;
  }

  var reader = new FileReader();
  reader.onload = function (loadEvent) {
    var img = new Image();
    img.onload = function () {
      _userImage = img;
      if (_resetBtn) { _resetBtn.disabled = false; }
      render();  // Phase 18: becomes renderAll()
    };
    img.onerror = function () {
      alert('Could not load image. Please try a different file.');
    };
    img.src = loadEvent.target.result;
  };
  reader.readAsDataURL(file);
}
```

---

#### Image preloading pattern (lines 149–174)

Use the same `onload`/`onerror` counter pattern. Phase 18 adds `canPhoto` and `bottlePhoto` to the preload set — extend `total` count from 3 to 5:

```javascript
// js/modules/14-labels.js lines 149–174
function preloadImages(callback) {
  var loaded = 0;
  var total = 3; // Phase 18: increase to 5 (bottle SVG, can SVG, placeholder, can-photo, bottle-photo)

  function onLoad() {
    loaded++;
    if (loaded >= total && callback) { callback(); }
  }

  _templateImages.bottle = new Image();
  _templateImages.bottle.onload = onLoad;
  _templateImages.bottle.onerror = onLoad; // proceed even on error
  _templateImages.bottle.src = TEMPLATE_PATHS.bottle;
  // ... etc
}
```

---

#### CJS export block (lines 282–292)

Update this block whenever function names change in the refactor. The pattern is: export every function that tests need to call. Phase 18 will rename `_render` and add `_buildPricingTable`, `_renderFlat`, `_renderCan`, `_renderBottle`:

```javascript
// js/modules/14-labels.js lines 282–292
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    LABEL_REGIONS: LABEL_REGIONS,
    MAX_FILE_SIZE: MAX_FILE_SIZE,
    _init: init,
    _render: render,
    _handleReset: handleReset,
    _handleTemplateSwitch: handleTemplateSwitch,
    _handleFileUpload: handleFileUpload
  };
}
```

---

#### Pricing table HTML generation pattern

Copy from `js/modules/13-init.js` lines 654–701 (loadTestimonials / loadFAQ). The exact pattern used in this project for data-driven innerHTML:

```javascript
// js/modules/13-init.js lines 664–679 (forEach + html string concat + innerHTML)
var html = '';
reviews.forEach(function (r) {
  html += '<div class="testimonial-card">'
    + '<div class="testimonial-stars">' + stars + '</div>'
    + '<blockquote>' + escapeHTML(r.text) + '</blockquote>'
    + '</div>';
});
container.innerHTML = html;
```

Apply to `buildPricingTable()` in 14-labels.js: loop `LABEL_DATA` filtered by `material`, concatenate HTML strings, set `tableWrap.innerHTML = html`. Since LABEL_DATA is a hardcoded constant (no user input), escapeHTML is not required — but use it for the `uses` field as a defensive habit to match project conventions.

---

#### init function / DOMContentLoaded pattern (lines 246–279)

The guard pattern `if (!_canvas) return;` is the page-detection idiom. Phase 18 replaces it with a check against the first of the three new canvas IDs:

```javascript
// js/modules/14-labels.js lines 246–250
function init() {
  _canvas = document.getElementById('labels-canvas');
  if (!_canvas) return; // Not on the labels page — exit silently

  _ctx = _canvas.getContext('2d');
  _canvas.width = CANVAS_WIDTH;
  _canvas.height = CANVAS_HEIGHT;
```

Phase 18 pattern:
```javascript
function init() {
  _canvasFlat = document.getElementById('labels-canvas-flat');
  if (!_canvasFlat) return; // Not on the labels page — exit silently
  // ... initialize all three canvases
}
```

---

### `css/labels.css` (config/styles, n/a)

**Analog:** `css/labels.css` itself (lines 1–331 — full file already read)
**Secondary analog:** `.labels-steps` flex layout (lines 36–48) — same flex pattern to replicate for 3-preview columns

---

#### 3-preview column flex pattern

Copy the `.labels-steps` flex layout (lines 36–48) as the base for `.labels-previews`:

```css
/* css/labels.css lines 36–48 — source for 3-column flex layout */
.labels-steps {
  display: flex;
  gap: 2rem;
  justify-content: center;
  flex-wrap: wrap;
}

.labels-step {
  flex: 1;
  min-width: 200px;
  max-width: 300px;
  padding: 1.5rem;
}
```

Adapt to:
```css
/* New: .labels-previews — same flex pattern, tighter max-width for canvases */
.labels-previews {
  display: flex;
  gap: 1.5rem;
  justify-content: center;
  align-items: flex-start;
  flex-wrap: wrap;
}

.labels-preview-col {
  flex: 1;
  min-width: 180px;
  max-width: 280px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
}
```

---

#### Canvas element styling pattern

Copy from the existing `#labels-canvas` rule (lines 214–220):

```css
/* css/labels.css lines 214–220 */
#labels-canvas {
  max-width: 100%;
  height: auto;
  border: 1px solid #ddd;
  border-radius: 8px;
  background-color: #fafafa;
}
```

Apply as a class rule on `.labels-preview-col canvas` so all three canvases share the style without per-ID rules.

---

#### Responsive breakpoint pattern

Copy the existing `@media (max-width: 768px)` block structure (lines 304–331). New preview-column breakpoint rules go inside this same media query block — do not create a second `@media (max-width: 768px)` declaration:

```css
/* css/labels.css lines 304–331 — existing responsive block */
@media (max-width: 768px) {
  .labels-hero { padding: 3rem 0; }
  .labels-steps { flex-direction: column; align-items: center; }
  .labels-step  { max-width: 100%; }
  #labels-canvas { max-width: 100%; }
  .labels-mockup-controls { flex-direction: column; }
  /* ... */
}
```

Add new rules inside this same block:
```css
  .labels-previews { flex-direction: column; align-items: center; }
  .labels-preview-col { max-width: 320px; width: 100%; }
```

---

#### CSS variable usage

All colour and font references must use the existing CSS custom properties, never hardcoded values. The established token set (from `css/styles.css`):

```css
/* Established tokens — always use these, never hardcode */
var(--color-green)      /* #4a6f4b — primary brand green */
var(--color-cream)      /* off-white background */
var(--color-burgundy)   /* table headers, h3 */
var(--color-muted)      /* muted text — use for .labels-preview-label */
var(--font-display)     /* Playfair Display */
var(--font-body)        /* Lato */
```

The `.labels-preview-label` caption (e.g. "Flat View", "On a Can") should use `var(--font-body)` at `0.85rem` with `color: var(--color-muted)` — matching the existing `.labels-pricing-note` style (line 128–133).

---

#### Pricing group title — new rules needed

The existing `.labels-pricing-table th` uses `var(--color-burgundy)` (line 122). New `.labels-pricing-group-title` headings (h3 within the pricing section) should inherit from:

```css
/* css/labels.css lines 121–126 — table header color pattern */
.labels-pricing-table th {
  font-family: var(--font-display);
  font-weight: 600;
  color: var(--color-burgundy);
  border-bottom: 2px solid var(--color-burgundy);
}
```

Apply the same `var(--font-display)` and `var(--color-burgundy)` to `.labels-pricing-group-title`.

---

### `custom-labels.html` (view, static)

**Analog:** `custom-labels.html` itself (lines 1–268 — full file already read)

---

#### Head block — preserve exactly (lines 1–75)

The entire `<head>` block must be preserved without structural changes. The only permitted edits are:
- `<meta name="description">` (line 20) — broaden from homebrew-only copy per D-09/D-11
- `<meta property="og:description">` (line 22) — matching update

Do NOT touch: CSP (line 19), canonical (line 28), JSON-LD (lines 30–65), stylesheet links (lines 73–74), font loading (lines 70–71).

The CSP `img-src 'self' data:` on line 19 confirms that `can-photo.jpg` and `bottle-photo.jpg` must be served locally from `images/labels/` — not hotlinked.

---

#### Nav/header/footer — preserve exactly (lines 83–114, 237–260)

No changes. The active nav link `custom-labels.html` is already correctly set (line 106). The footer hours block and land acknowledgement are untouched.

---

#### Section structure pattern

The page uses a consistent section pattern — copy this structure for all content sections:

```html
<!-- custom-labels.html lines 117–122 — section pattern -->
<section class="labels-hero">
  <div class="container">
    <h1>Custom Label Printing</h1>
    <p>Make your homebrew look as good as it tastes...</p>
  </div>
</section>
```

All new/modified content sections must follow this `<section class="labels-*"><div class="container">...</div></section>` wrapper pattern.

---

#### Mockup section — full replacement (lines 176–196)

The current single-canvas block (lines 176–196) is replaced with the 3-canvas structure from RESEARCH.md Pattern 2. Key IDs that must match what `14-labels.js` looks for:

- Old: `id="labels-canvas"` — **remove**
- New: `id="labels-canvas-flat"`, `id="labels-canvas-can"`, `id="labels-canvas-bottle"`
- Existing IDs to keep: `id="labels-upload"`, `id="labels-reset"` — these are wired in the JS upload/reset handlers (lines 254–256 of 14-labels.js)

New `id="labels-type-selector"` — populated by JS from `LABEL_DATA` (drives D-06 container show/hide).

```html
<!-- Replacement structure per RESEARCH.md Pattern 2 -->
<div class="labels-upload-controls">
  <label for="labels-upload" class="btn labels-upload-btn">Upload Your Design</label>
  <input type="file" id="labels-upload" accept=".png,.jpg,.jpeg,.webp" hidden>
  <button type="button" class="btn-secondary labels-reset-btn" id="labels-reset" disabled>Reset</button>
</div>
<div class="labels-type-selector" id="labels-type-selector">
  <!-- Rendered by JS from LABEL_DATA -->
</div>
<div class="labels-previews" id="labels-previews">
  <div class="labels-preview-col labels-preview-flat">
    <div class="labels-preview-label">Flat View</div>
    <canvas id="labels-canvas-flat"></canvas>
  </div>
  <div class="labels-preview-col labels-preview-can" id="preview-can-wrap">
    <div class="labels-preview-label">On a Can</div>
    <canvas id="labels-canvas-can"></canvas>
  </div>
  <div class="labels-preview-col labels-preview-bottle" id="preview-bottle-wrap">
    <div class="labels-preview-label">On a Bottle</div>
    <canvas id="labels-canvas-bottle"></canvas>
  </div>
</div>
```

---

#### Pricing table section — partial replacement (lines 147–174)

The `<div class="labels-pricing-table-wrap">` (line 153) becomes the JS target. Replace the inner static `<table>` with an empty wrapper that JS populates:

```html
<!-- current: lines 153–172 -->
<div class="labels-pricing-table-wrap">
  <table class="labels-pricing-table" id="labels-pricing-table">
    <thead>...</thead>
    <tbody>
      <tr><td>Wine Bottle — Front</td>...</tr>
      <!-- 4 more hardcoded rows -->
    </tbody>
  </table>
</div>

<!-- replacement: JS-populated wrapper -->
<div class="labels-pricing-table-wrap" id="labels-pricing-table-wrap">
  <!-- Populated by buildPricingTable() in 14-labels.js -->
</div>
```

Note: The old `id="labels-pricing-table"` on the `<table>` is no longer needed. The new target id is on the wrapper div: `id="labels-pricing-table-wrap"`.

---

#### Design Guidelines section — partial update (lines 198–226)

The `.labels-guideline` card for "Label Dimensions" (lines 215–223) has hardcoded sizes that conflict with the new LABEL_DATA-driven approach. Replace the `<ul>` list with a short note per D-15:

```html
<!-- Replace lines 215–223 with: -->
<div class="labels-guideline">
  <h3>Label Dimensions</h3>
  <p>See the pricing table above for all available sizes. Max print width: 4.25&quot;. Contact us if you need a custom size.</p>
</div>
```

The other three guideline cards (File Format, Bleed, Colour Mode) remain unchanged.

---

#### Hero copy — update (line 120)

Current: `<p>Make your homebrew look as good as it tastes. Professional-quality labels designed by you, printed by us.</p>`

Replace per D-09/D-10/D-11 with broader-audience copy. Warm tone, inclusive. Example:
`<p>From homebrew bottles to wedding favours &mdash; we print labels for anything. Your design, your bottle, your occasion.</p>`

Exact copy is Claude's discretion. Warm &amp; approachable tone. Must not be corporate.

---

#### "Anyone Can" messaging — add callout (D-11)

Add a new `<p>` or small callout block inside the `.labels-how-it-works` section or just before the pricing section. Pattern: inline `<p>` with `class="labels-open-note"` (new utility class in labels.css):

```html
<p class="labels-open-note">
  <strong>Not a Steins &amp; Vines member?</strong> No problem &mdash; bring any bottle or can and we&rsquo;ll print labels for it.
</p>
```

---

#### Script tags — preserve exactly (lines 262–267)

No changes needed to the script loading block:
```html
<script src="js/vendor/sentry.min.js"></script>
<script src="js/sentry-init.js"></script>
<script src="js/sheets-config.js" defer></script>
<script src="js/main.min.js?v=mpbavawb" defer></script>
<script src="js/modules/14-labels.min.js?v=mpbavawb" defer></script>
```

The `?v=` cache-buster values will be regenerated by `npm run build` (stamp:pages). Do not manually edit them.

---

### `images/labels/can-photo.jpg` (asset, n/a)

**Analog:** `images/labels/can-template.svg` — sibling asset in the same directory. No code pattern.

**Requirements:**
- Source: Pexels #8066771 (Mediamodifier — free commercial use)
- Must be downloaded locally; cannot be hotlinked (CSP restricts `img-src` to `'self' data:`)
- Save as `images/labels/can-photo.jpg` at full Pexels resolution, then optionally resize to ~800px wide for web

**Download command:**
```bash
curl -L "https://images.pexels.com/photos/8066771/pexels-photo-8066771.jpeg?auto=compress&cs=tinysrgb&w=1260&h=750&dpr=2" \
  -o "images/labels/can-photo.jpg"
```

---

### `images/labels/bottle-photo.jpg` (asset, n/a)

**Analog:** `images/labels/bottle-template.svg` — sibling asset. No code pattern.

**Requirements:**
- Free stock photo of a dark green / dark unlabeled wine bottle on clean/white background
- User will replace with their own photo — any clean placeholder is acceptable
- Save as `images/labels/bottle-photo.jpg`
- Suggested Pexels search: `https://www.pexels.com/search/wine%20bottle%20blank/`

---

## Shared Patterns

### ES5 Syntax Constraint
**Source:** `CLAUDE.md` + `js/modules/14-labels.js` (entire file)
**Apply to:** `14-labels.js` only (CSS and HTML are unaffected)

- `var` only — no `let`, `const`
- No arrow functions — use `function` keyword always
- No template literals — use string concatenation with `+`
- No `Array.from`, `Object.assign`, `Promise` from ES6+ — use `for` loops, `forEach`, etc.
- ESLint will catch violations: run `npm run lint` before every commit

```javascript
// CORRECT: ES5 forEach
rows.forEach(function (l) {
  html += '<tr><td>' + l.name + '</td></tr>';
});

// WRONG: ES6
rows.forEach(l => { html += `<tr><td>${l.name}</td></tr>`; });
```

---

### CSS Variable Token Usage
**Source:** `css/labels.css` lines 13, 22, 57–62, 84–85, 122–126
**Apply to:** All new CSS rules in `labels.css`

Never hardcode colours or font names. Always use:
- `var(--color-green)` for primary green
- `var(--color-cream)` for off-white
- `var(--color-burgundy)` for headings/table headers
- `var(--font-display)` for Playfair Display headings
- `var(--font-body)` for Lato body text

---

### Guard Pattern — Page Detection
**Source:** `js/modules/14-labels.js` lines 247–249
**Apply to:** `init()` function in `14-labels.js`

```javascript
// Guard: exit silently if not on the labels page
_canvasFlat = document.getElementById('labels-canvas-flat');
if (!_canvasFlat) return;
```

This prevents errors when `14-labels.min.js` is accidentally loaded on other pages.

---

### forEach/innerHTML Table Building
**Source:** `js/modules/13-init.js` lines 664–679 (loadTestimonials), lines 694–701 (loadFAQ)
**Apply to:** `buildPricingTable()` in `14-labels.js`

```javascript
// 13-init.js lines 664–679 — the canonical in-project pattern
var html = '';
reviews.forEach(function (r) {
  html += '<div class="testimonial-card">' + escapeHTML(r.text) + '</div>';
});
container.innerHTML = html;
```

Pricing table follows the same shape: build `html` string in a `forEach` loop, assign once to `container.innerHTML`. Do not call `appendChild` per row (the string concat approach is used consistently in this codebase).

---

### Image onerror Fallback
**Source:** `js/modules/14-labels.js` lines 161–173
**Apply to:** All new `Image()` preloads in `14-labels.js` (can-photo.jpg, bottle-photo.jpg)

```javascript
// 14-labels.js lines 161–163 — always pair onload with onerror
_templateImages.bottle = new Image();
_templateImages.bottle.onload = onLoad;
_templateImages.bottle.onerror = onLoad; // proceed even on error
_templateImages.bottle.src = TEMPLATE_PATHS.bottle;
```

The `onerror = onLoad` trick ensures the counter still increments even when a photo fails to load — `drawFallbackTemplate()` then draws the SVG shape instead.

---

### Build Artifacts — Never Edit Directly
**Source:** `CLAUDE.md`
**Apply to:** All file edits in this phase

- Edit `js/modules/14-labels.js` — never `js/modules/14-labels.min.js`
- Edit `css/labels.css` — never `css/labels.min.css`
- Run `npm run build` after any JS or CSS change to regenerate minified files
- The `?v=` cache-busters in HTML are auto-stamped by `npm run build` — do not manually edit them

---

### CJS Export Block Update Requirement
**Source:** `js/modules/14-labels.js` lines 282–292
**Apply to:** End of `14-labels.js`

After any function rename or addition, the export block must be updated. Planner must allocate an explicit step for this:

```javascript
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    LABEL_DATA: LABEL_DATA,          // NEW — expose for test assertions
    MAX_FILE_SIZE: MAX_FILE_SIZE,
    _init: init,
    _renderFlat: renderFlat,         // RENAMED from _render
    _renderCan: renderCan,           // NEW
    _renderBottle: renderBottle,     // NEW
    _buildPricingTable: buildPricingTable, // NEW
    _handleReset: handleReset,
    _handleFileUpload: handleFileUpload
    // _handleTemplateSwitch: removed — template switching replaced by label-type selector
  };
}
```

---

## No Analog Found

All files have close analogs in the codebase. No files require falling back to RESEARCH.md patterns exclusively.

| File | Role | Reason |
|------|------|---------|
| `images/labels/can-photo.jpg` | asset | Static image file — no code pattern; download from Pexels #8066771 |
| `images/labels/bottle-photo.jpg` | asset | Static image file — no code pattern; source from Pexels free license |

---

## Metadata

**Analog search scope:** `js/modules/`, `js/lib/`, `css/`, root HTML files
**Files read:** 5 source files (14-labels.js, labels.css, custom-labels.html, 01-config.js, constants.js) + 13-init.js excerpt
**Pattern extraction date:** 2026-05-18
