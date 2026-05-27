# Phase 18: Custom Labels Iteration — Research

**Researched:** 2026-05-18
**Domain:** HTML5 Canvas compositing, perspective/cylindrical warp, vanilla JS (ES5), CSS layout, copy/UX
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

#### 3-Preview Mockup Layout
- D-01: Three previews displayed side by side (flat | can | bottle), all visible at once. Stacks vertically on mobile.
- D-02: Single upload button — user uploads once, all 3 previews update simultaneously.
- D-03: Flat view shows exact-dimensions rectangle at the label's actual aspect ratio with dimension labels (e.g. 4"x3") overlaid.
- D-04: Can and bottle previews use perspective warp/curve transform to simulate label wrapping around the cylinder. More realistic than simple overlay.
- D-05: Default state (no upload) shows placeholder "Your Design Here" composited onto all visible previews.
- D-06: Label types have a container compatibility field (bottle, can, or both). Only matching container preview(s) are shown — if a label fits only bottles, the can preview hides and vice versa. Flat view always shows.

#### Label Data Source
- D-07: Label types, dimensions, prices, and container compatibility defined as a JS object constant in 14-labels.js (or a new config section). No server-side data source needed. Data comes from the COGS spreadsheet.
- D-08: Exclude labels marked "Used for packaging" from the public page (SKUs 11013-c4000 and 11034-c4000: 3x2 High Gloss Paper, 2.5x1.5 High Gloss Paper).

#### Copy & Positioning
- D-09: Broaden copy beyond homebrewers — target audiences include homebrewers, events/gifts (weddings, birthdays, corporate), and small businesses (kombucha, hot sauce, farmers market vendors).
- D-10: Warm & approachable tone matching existing Steins & Vines voice — not corporate/stiff.
- D-11: Explicitly state that anyone can get labels printed, even if they didn't buy/brew at Steins & Vines.

#### Pricing Table
- D-12: Use real prices from the COGS spreadsheet (Sale Price/Label column). $10 setup fee per design.
- D-13: Group labels by material type in 3 sections: Satin/Matte BOPP (waterproof), Matte Poly (durable), High Gloss Paper (budget).
- D-14: Include a "Best For" / "Fits" column showing container compatibility from the Uses field.

#### Design Guidelines
- D-15: Show practical customer-facing specs: file format (PNG/JPG), 300 DPI recommended, max print width 4.25", CMYK preferred (RGB accepted). Mention waterproof BOPP material for credibility. Don't name-drop the printer model.

#### Photo Assets
- D-16: Can photo: Pexels #8066771 (blank silver can on white, by Mediamodifier, free commercial use). Use as-is.
- D-17: Bottle photo: Use a free stock photo as temporary placeholder until user provides their own photo.
- D-18: Photos stored in images/labels/ directory (replacing or alongside existing SVGs).

### Claude's Discretion
- Hero subheadline copy (warm, inclusive of all audiences)
- Exact wording for the "anyone can get labels" messaging
- Which stock bottle photo to use as placeholder
- How to render the dimension labels on the flat preview
- Exact perspective warp parameters for can/bottle compositing
- Responsive breakpoint behavior for the 3-column layout
- Whether to keep the existing SVG fallbacks alongside the new photo-based previews

### Deferred Ideas (OUT OF SCOPE)
- Server-side file upload or order processing
- Payment integration for labels
- Full 3D rotating model
- Print-ready PDF generation from uploaded image
- Design service tiers (DIY, template, bespoke)
- Wedding/corporate package pricing
- BC LCRB label-content compliance research
- Customer gallery / Instagram tie-in
- Pull pricing dynamically from Google Sheet
</user_constraints>

---

## Summary

Phase 18 upgrades the existing `custom-labels.html` page (built in Phase 17) with three significant improvements: (1) the single-canvas mockup tool becomes a 3-preview layout (flat + can photo + bottle photo) with all three updating from a single upload, (2) the pricing table is replaced with real data from the COGS spreadsheet grouped by material type, and (3) the copy is broadened from homebrew-only to any customer.

All work is purely front-end. The existing `14-labels.js` IIFE is extended (not rewritten), and `css/labels.css` gains new CSS for the 3-column preview layout. No new pages, no server-side changes, and no new build pipeline entries are needed.

The biggest implementation challenge is D-04: the perspective/cylindrical warp for can and bottle previews. Canvas `drawImage` is flat; simulating label wrap requires a scanline-based approach drawing many thin horizontal slices with progressively scaled widths, or using the mathematical approach from perspective-transform libraries. The project's ES5 constraint means any helper must be hand-rolled inline in the IIFE rather than imported as an npm package.

**Primary recommendation:** Use a scanline-based horizontal-slice warp (30–50 scanlines, cosine-scaled widths) for both can and bottle previews — it is achievable in ES5, performs well in all browsers, and produces a believable cylindrical appearance without external dependencies.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| 3-preview mockup rendering | Browser / Client (Canvas 2D) | — | All rendering is client-side; no server involved |
| File upload + validation | Browser / Client | — | FileReader API, no upload to server |
| Label data constant (LABEL_DATA) | Browser / Client (JS constant) | — | D-07 locks this as a JS object; no API needed |
| Pricing table rendering | Browser / Client (JS-driven HTML) | — | JS loops over LABEL_DATA to build table rows |
| Photo assets (can, bottle) | CDN / Static (GitHub Pages) | — | Images served as static files alongside SVGs |
| CSS layout (3-column previews) | Browser / Client (CSS) | — | Pure CSS flexbox/grid, no JS layout logic |

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| HTML5 Canvas 2D API | Browser native | Compositing uploaded image onto mockup previews | Already used in Phase 17; no dependency |
| Vanilla JS ES5 | Project standard | All module logic | CLAUDE.md + Phase 17 D-14 lock ES5 throughout |
| CSS Flexbox | Browser native | 3-column preview layout | Already used in labels.css for responsive layout |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| FileReader API | Browser native | Convert uploaded file to Image object | Already wired in Phase 17; extend for multi-canvas |
| CSS custom properties | Browser native | Colour/font tokens from styles.css | All `--color-*` and `--font-*` values from the existing theme |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Scanline warp (hand-rolled ES5) | perspective.js npm package | Package can't be imported (no bundler, ES5 constraint); hand-rolled scanline is ~40 lines and sufficient for the preview quality needed |
| 3 separate `<canvas>` elements | Single canvas with CSS transforms | 3 canvases map cleanly to the 3 preview columns and allow independent show/hide for D-06 container compatibility |

**No installation needed** — all capabilities are browser-native or already in the codebase.

---

## Architecture Patterns

### System Architecture Diagram

```
User uploads PNG/JPG/WEBP
         |
         v
   FileReader API
   (validate type, size)
         |
         v
  Image object loaded
         |
    +----+----+----+
    |    |         |
    v    v         v
  Flat  Can       Bottle
 Canvas Canvas   Canvas
  (D-03) (D-04)  (D-04)
    |      |         |
   rect  scanline  scanline
   draw  warp      warp
    |      |         |
    +----+----+----+
         |
    All 3 update simultaneously (D-02)
```

D-06 container compatibility: on label-type change, can/bottle canvas wrapper divs are toggled hidden via `style.display` depending on label's `containers` field.

### Recommended Project Structure

No new directories. Changes are isolated to:

```
js/modules/
└── 14-labels.js         # Extend: add LABEL_DATA constant, 3-canvas rendering, warp logic, pricing render

css/
└── labels.css           # Extend: add 3-column preview layout CSS, dimension label overlay

images/labels/
├── can-photo.jpg        # NEW: Pexels #8066771 download
├── bottle-photo.jpg     # NEW: placeholder stock photo
├── can-template.svg     # KEEP: existing fallback
└── bottle-template.svg  # KEEP: existing fallback

custom-labels.html       # Modify: replace single canvas with 3-canvas section, update pricing table structure, update copy
```

### Pattern 1: LABEL_DATA JS Constant

Define all label types as a single object array in 14-labels.js, above the IIFE:

```javascript
// Source: COGS - Labels.csv (verified from file, 2026-05-18)
// D-07: JS constant, no server-side data needed
// D-08: SKUs 11013-c4000 and 11034-c4000 excluded (Used for packaging)
var LABEL_DATA = [
  // BOPP (Waterproof)
  { sku: '814051', name: '4x3 Satin BOPP',    w: 4,   h: 3,   material: 'bopp',  price: 0.45, containers: 'both',   uses: '355mL Beer Bottle, 750mL Wine Bottle, 355mL Can' },
  { sku: '814022', name: '4x6 Matte BOPP',    w: 4,   h: 6,   material: 'bopp',  price: 1.15, containers: 'bottle', uses: '750mL Wine Bottle' },
  { sku: '814021', name: '4x4 Matte BOPP',    w: 4,   h: 4,   material: 'bopp',  price: 0.75, containers: 'both',   uses: '' },
  { sku: '814053', name: '2.5" Circle Satin BOPP', w: 2.5, h: 2.5, material: 'bopp', price: 0.30, containers: 'both', uses: '' },
  { sku: '814042', name: '4x100 Continuous Satin BOPP', w: 4, h: 100, material: 'bopp', price: 0.15, containers: 'both', uses: 'price per inch' },
  // Matte Poly (Durable)
  { sku: '14024-c4000', name: '3x5 Matte Poly', w: 3, h: 5, material: 'poly', price: 0.70, containers: 'both', uses: '' },
  { sku: '14018-c4000', name: '4x3 Matte Poly', w: 4, h: 3, material: 'poly', price: 0.50, containers: 'both', uses: '' },
  { sku: '14037-c4000', name: '2" Circle Matte Poly', w: 2, h: 2, material: 'poly', price: 0.25, containers: 'both', uses: '' },
  // High Gloss Paper (Budget) — packaging SKUs excluded per D-08
  { sku: '11029-c4000', name: '3x3 High Gloss Paper', w: 3, h: 3, material: 'paper', price: 0.30, containers: 'both', uses: '' },
  { sku: '11016-c4000', name: '4x2 High Gloss Paper', w: 4, h: 2, material: 'paper', price: 0.25, containers: 'both', uses: '' },
  { sku: '11025-c4000', name: '3x6 High Gloss Paper', w: 3, h: 6, material: 'paper', price: 0.65, containers: 'both', uses: '' },
  { sku: '11019-c4000', name: '4x4 High Gloss Paper', w: 4, h: 4, material: 'paper', price: 0.50, containers: 'both', uses: '' },
  { sku: '11024-c4000', name: '3x5 High Gloss Paper', w: 3, h: 5, material: 'paper', price: 0.55, containers: 'both', uses: '' },
  { sku: '11039-c4000', name: '3" Circle High Gloss Paper', w: 3, h: 3, material: 'paper', price: 0.30, containers: 'both', uses: '' },
  { sku: '11037-c4000', name: '2" Circle High Gloss Paper', w: 2, h: 2, material: 'paper', price: 0.15, containers: 'both', uses: '' }
];
```

[VERIFIED: COGS - Labels.csv at /Users/koa/Downloads/COGS - Labels.csv, read 2026-05-18]

### Pattern 2: 3-Canvas HTML Structure (D-01 / D-02 / D-06)

Replace the single `<canvas id="labels-canvas">` section in custom-labels.html with:

```html
<!-- Single upload button per D-02 -->
<div class="labels-upload-controls">
  <label for="labels-upload" class="btn labels-upload-btn">Upload Your Design</label>
  <input type="file" id="labels-upload" accept=".png,.jpg,.jpeg,.webp" hidden>
  <button type="button" class="btn-secondary labels-reset-btn" id="labels-reset" disabled>Reset</button>
</div>

<!-- Label type selector — drives D-06 container show/hide -->
<div class="labels-type-selector" id="labels-type-selector">
  <!-- Rendered by JS from LABEL_DATA -->
</div>

<!-- 3-preview panel (D-01) -->
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

Note: The existing `#labels-canvas` id is removed. Any tests referencing it will need updating.
[VERIFIED: custom-labels.html line 192 — existing canvas id is `labels-canvas`]

### Pattern 3: Scanline Cylindrical Warp (ES5, D-04)

True perspective warp requires drawing many thin horizontal slices of the source image, each scaled to simulate foreshortening. This is achievable in ES5 without any library:

```javascript
// Source: [ASSUMED] — standard scanline cylinder approximation technique
// For a cylinder of radius R at viewing distance D, each row's horizontal
// scale factor is: scale = cos(angle) where angle = (y - cy) / R mapped to -PI/2..PI/2
// In practice: cosine-curve the width of each drawn row.

function drawCylindrical(ctx, img, dstX, dstY, dstW, dstH, numSlices) {
  numSlices = numSlices || 40;
  var sliceH = dstH / numSlices;
  for (var i = 0; i < numSlices; i++) {
    // Source slice
    var srcY = (i / numSlices) * img.naturalHeight;
    var srcH = img.naturalHeight / numSlices;
    // Cosine curve: slices near top/bottom appear narrower
    var t = (i / (numSlices - 1)) * Math.PI - Math.PI / 2; // -PI/2 to PI/2
    var scale = Math.cos(t) * 0.3 + 0.7; // scale from 0.7 to 1.0 to 0.7
    var sliceW = dstW * scale;
    var sliceX = dstX + (dstW - sliceW) / 2;
    ctx.drawImage(
      img,
      0, srcY, img.naturalWidth, srcH,   // source
      sliceX, dstY + i * sliceH, sliceW, sliceH  // destination
    );
  }
}
```

The cosine scale factor `0.3 + 0.7` ensures the center row is full width (scale=1.0) and top/bottom rows are at 70% width. Tuning `0.3` adjusts the warp intensity. More slices = smoother but no perceptible quality gain past ~40 for a 300px-high region.

[ASSUMED] — this is a well-known technique; exact parameters require visual tuning during implementation.

### Pattern 4: Flat Preview with Dimension Labels (D-03)

The flat canvas renders a rectangle scaled to the label's actual aspect ratio, with the dimension text overlaid:

```javascript
// Source: [ASSUMED] — standard canvas text overlay
function renderFlat(ctx, labelImg, labelType) {
  var W = ctx.canvas.width;
  var H = ctx.canvas.height;
  ctx.clearRect(0, 0, W, H);

  // Compute rectangle at label's actual aspect ratio, centered, padded
  var pad = 40;
  var labelAspect = labelType.w / labelType.h;
  var available_w = W - pad * 2;
  var available_h = H - pad * 2 - 30; // reserve 30px for dimension label
  var drawW, drawH;
  if (labelAspect > available_w / available_h) {
    drawW = available_w; drawH = drawW / labelAspect;
  } else {
    drawH = available_h; drawW = drawH * labelAspect;
  }
  var drawX = (W - drawW) / 2;
  var drawY = (H - drawH) / 2 - 15;

  // Draw label image into rectangle
  ctx.save();
  ctx.beginPath();
  ctx.rect(drawX, drawY, drawW, drawH);
  ctx.clip();
  ctx.drawImage(labelImg, drawX, drawY, drawW, drawH);
  ctx.restore();

  // Border
  ctx.strokeStyle = 'rgba(0,0,0,0.2)';
  ctx.lineWidth = 1;
  ctx.strokeRect(drawX, drawY, drawW, drawH);

  // Dimension text (e.g. "4\" × 3\"")
  var dimText = labelType.w + '" × ' + labelType.h + '"';
  ctx.fillStyle = '#555';
  ctx.font = '13px Lato, Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(dimText, W / 2, drawY + drawH + 20);
}
```

[ASSUMED] — canvas text rendering approach; exact fonts/sizes require visual tuning.

### Pattern 5: Pricing Table from JS Constant (D-12 / D-13 / D-14)

Build the pricing table HTML from `LABEL_DATA` rather than hard-coding rows in the HTML. This keeps data in one place:

```javascript
// Source: [ASSUMED] — standard pattern for JS-driven table generation
function buildPricingTable() {
  var tableWrap = document.getElementById('labels-pricing-table-wrap');
  if (!tableWrap) return;

  var groups = [
    { key: 'bopp',  label: 'Satin / Matte BOPP',     subtitle: 'Waterproof — best for bottles & cans in wet environments' },
    { key: 'poly',  label: 'Matte Poly',              subtitle: 'Durable matte finish' },
    { key: 'paper', label: 'High Gloss Paper',        subtitle: 'Budget-friendly, vibrant colours' }
  ];

  var html = '';
  groups.forEach(function (group) {
    var rows = LABEL_DATA.filter(function (l) { return l.material === group.key; });
    if (!rows.length) return;
    html += '<h3 class="labels-pricing-group-title">' + group.label + '</h3>';
    html += '<p class="labels-pricing-group-subtitle">' + group.subtitle + '</p>';
    html += '<table class="labels-pricing-table"><thead><tr>';
    html += '<th>Label</th><th>Size</th><th>Price/Label</th><th>Best For</th>';
    html += '</tr></thead><tbody>';
    rows.forEach(function (l) {
      var sizeStr = l.w === l.h ? l.w + '" circle' : l.w + '" × ' + l.h + '"';
      var fits = l.uses || (l.containers === 'bottle' ? 'Bottles' : l.containers === 'can' ? 'Cans' : 'Bottles &amp; Cans');
      html += '<tr><td>' + l.name.replace(/ (Satin |Matte |High Gloss )?(BOPP|Poly|Paper)$/,'') + '</td>';
      html += '<td>' + sizeStr + '</td>';
      html += '<td>$' + l.price.toFixed(2) + '</td>';
      html += '<td>' + fits + '</td></tr>';
    });
    html += '</tbody></table>';
  });
  tableWrap.innerHTML = html;
}
```

[ASSUMED] — exact table HTML structure; adjust based on final CSS design.

### Anti-Patterns to Avoid

- **Rewriting 14-labels.js from scratch:** The existing IIFE already has FileReader validation, rounded-rect clipping, fallback template drawing, and CJS exports. All Phase 18 work extends the existing structure. [VERIFIED: 14-labels.js, 2026-05-18]
- **Using `let`/`const`/arrow functions:** CLAUDE.md and Phase 17 D-14 enforce ES5 throughout. ESLint will fail.
- **Removing the SVG fallbacks:** The existing `can-template.svg` and `bottle-template.svg` should remain. The new photo images are primary; SVGs are the `onerror` fallback path. This preserves the `drawFallbackTemplate()` safety net.
- **Adding `#labels-canvas` directly to stamp:pages pattern:** `package.json` stamp:pages already covers `labels.min.css` and `14-labels.min.js`. If `#labels-canvas` is gone, no stamp-script change is needed — the existing pattern still runs fine.
- **Drawing dimension text with `document.fonts` check:** The font Lato may not be loaded at the moment `renderFlat()` first executes. Use a `document.fonts.ready.then(render)` guard or simply set a sans-serif fallback font in canvas `ctx.font` (which renders immediately without custom font dependency).

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Cylindrical warp | Full inverse texture mapping with bilinear filtering | 40-slice scanline cosine approach | Perceptually equivalent for 300–400px label regions; inverse mapping adds 200+ lines for imperceptible quality gain |
| Pricing table HTML | Server-side template | JS loop over LABEL_DATA constant | D-07 locks data as JS constant; no server needed |
| Image cover-fit logic | Custom scaling math per canvas | The existing `imgAspect / regionAspect` pattern from 14-labels.js | Already verified working; copy pattern to all 3 render functions |

**Key insight:** The project's no-bundler, ES5, GitHub Pages constraint means "don't hand-roll" actually inverts: do NOT reach for npm packages. Solve in-file with simple math.

---

## Pricing Data (Verified from COGS)

All prices verified directly from `/Users/koa/Downloads/COGS - Labels.csv` on 2026-05-18.
[VERIFIED: COGS - Labels.csv]

### Satin / Matte BOPP (Waterproof)
| SKU | Name | Size | Price/Label | Uses |
|-----|------|------|-------------|------|
| 814051 | 4x3 Satin BOPP | 4" x 3" | $0.45 | 355mL Beer Bottle, 750mL Wine Bottle, 355mL Can |
| 814022 | 4x6 Matte BOPP | 4" x 6" | $1.15 | 750mL Wine Bottle |
| 814021 | 4x4 Matte BOPP | 4" x 4" | $0.75 | (general) |
| 814053 | 2.5" Circle Satin BOPP | 2.5" circle | $0.30 | (general) |
| 814042 | 4x100 Continuous Satin BOPP | 4" x 100' | $0.15/inch | (general) |

### Matte Poly (Durable)
| SKU | Name | Size | Price/Label |
|-----|------|------|-------------|
| 14024-c4000 | 3x5 Matte Poly | 3" x 5" | $0.70 |
| 14018-c4000 | 4x3 Matte Poly | 4" x 3" | $0.50 |
| 14037-c4000 | 2" Circle Matte Poly | 2" circle | $0.25 |

### High Gloss Paper (Budget) — packaging SKUs excluded
| SKU | Name | Size | Price/Label |
|-----|------|------|-------------|
| 11029-c4000 | 3x3 High Gloss Paper | 3" x 3" | $0.30 |
| 11016-c4000 | 4x2 High Gloss Paper | 4" x 2" | $0.25 |
| 11025-c4000 | 3x6 High Gloss Paper | 3" x 6" | $0.65 |
| 11019-c4000 | 4x4 High Gloss Paper | 4" x 4" | $0.50 |
| 11024-c4000 | 3x5 High Gloss Paper | 3" x 5" | $0.55 |
| 11039-c4000 | 3" Circle High Gloss Paper | 3" circle | $0.30 |
| 11037-c4000 | 2" Circle High Gloss Paper | 2" circle | $0.15 |

**Excluded per D-08:**
- 11013-c4000: 3x2 High Gloss Paper — "Used for packaging"
- 11034-c4000: 2.5x1.5 High Gloss Paper — "Used for packaging"

**Setup fee:** $10 per design (confirmed in COGS spreadsheet footer)

---

## Photo Assets

### Can Photo (D-16)
- **Pexels ID:** 8066771
- **URL:** https://www.pexels.com/photo/silver-can-in-white-background-8066771/
- **Attribution:** Mediamodifier (Pexels Free License — free commercial use, no attribution required)
- **Description:** Blank silver can on white background — perfect for overlay compositing
- **Target path:** `images/labels/can-photo.jpg`
- **Note:** CSP on custom-labels.html allows `img-src 'self' data:` — the image must be downloaded locally, not served from pexels.com. [VERIFIED: custom-labels.html line 19 — CSP img-src does not include pexels.com]

### Bottle Photo (D-17)
- **Source:** Pexels free license or similar — a dark/green unlabeled wine bottle on clean background
- **Target path:** `images/labels/bottle-photo.jpg`
- **Suggested search:** Pexels "wine bottle blank label" or "empty wine bottle white background"
- **Note:** User will swap in their own photo later — any clean stock image is acceptable as placeholder.

### Label Region Coordinates for Photos
After downloading, the label composite region coordinates on each photo canvas must be measured/estimated. These will differ from the existing SVG `LABEL_REGIONS`. Planner should allocate a task for tuning these values after initial implementation.

[ASSUMED] — exact pixel coordinates depend on which photo is selected and its composition.

---

## Common Pitfalls

### Pitfall 1: Single Render Function Becomes Three
**What goes wrong:** The current `render()` function in 14-labels.js targets one canvas. Extending it naively creates a 300-line function with three sets of duplicate drawing code.
**Why it happens:** Copy-paste refactor without extracting shared logic.
**How to avoid:** Extract a `renderPreview(canvas, type, labelImg, labelType)` function that handles flat/can/bottle as a `type` switch. The upload handler calls `renderPreview` three times. 
**Warning signs:** Any canvas-specific drawing logic appearing more than once in the file.

### Pitfall 2: Container Compatibility Show/Hide Leaves Empty Space
**What goes wrong:** D-06 hides can or bottle preview for label types that don't fit that container. If `display:none` on the preview column collapses the space, the remaining 2 columns may look unbalanced.
**Why it happens:** Flexbox child removal changes layout.
**How to avoid:** Use `visibility:hidden` + `width:0; overflow:hidden; padding:0` or remove the column and let the remaining 2 fill the space naturally. The planner should decide which approach; both are valid. [ASSUMED]

### Pitfall 3: Canvas CORS / Tainted Canvas with Photo Assets
**What goes wrong:** If `can-photo.jpg` is ever served from a different origin (CDN, etc.), drawing it to canvas taints the canvas and blocks `toDataURL()`.
**Why it happens:** Canvas security restriction on cross-origin images.
**How to avoid:** All photo assets are in `images/labels/` served from the same GitHub Pages origin. Confirm images are local, not hotlinked from Pexels. [VERIFIED: CSP restricts img-src to self + data:]

### Pitfall 4: Font Not Loaded When Flat Preview Renders
**What goes wrong:** The dimension label text on the flat preview (D-03) renders in a generic fallback font because `DOMContentLoaded` fires before Lato is available.
**Why it happens:** Deferred font loading (Lato is loaded via Google Fonts with `media="print" onload="this.media='all'"` pattern).
**How to avoid:** Set canvas font to `'13px Lato, Arial, sans-serif'` — canvas always uses the fallback font if the primary isn't loaded. The visual result is acceptable since it's a small label. Alternatively defer initial render to `document.fonts.ready`. [VERIFIED: custom-labels.html line 71 — Lato uses print/onload lazy load]

### Pitfall 5: Existing Tests Reference `#labels-canvas`
**What goes wrong:** `tests/frontend/` may have tests checking for `document.getElementById('labels-canvas')`. Removing the old canvas id breaks these tests.
**Why it happens:** Phase 17 wired everything to a single canvas id.
**How to avoid:** Check for canvas references in tests before modifying HTML. The test `label-cards.test.js` tests `getTintClass` and `formatCurrency` (04-label-cards.js), NOT the labels mockup — no canvas test found. [VERIFIED: tests/frontend/label-cards.test.js — not related to 14-labels.js canvas]

Separately, `14-labels.js` exports `{ LABEL_REGIONS, MAX_FILE_SIZE, _init, _render, _handleReset, _handleTemplateSwitch, _handleFileUpload }`. These exports must be updated to reflect the new internal function names after refactor.

### Pitfall 6: `stamp:pages` Pattern Does Not Cover `labels.min.css` on `custom-labels.html`
**What goes wrong:** Actually not a pitfall — `stamp:pages` already covers `labels.min.css` and `14-labels.min.js` in `custom-labels.html`. [VERIFIED: package.json line 15]

### Pitfall 7: Pricing Table HTML Hardcoded in HTML File
**What goes wrong:** The current `<table class="labels-pricing-table">` in custom-labels.html has hardcoded rows from Phase 17 (placeholder prices). These must be replaced.
**Why it happens:** Phase 17 used static HTML for the table.
**How to avoid:** Replace `<tbody>` content with a JS-populated wrapper. The `buildPricingTable()` function targets an element id (e.g. `#labels-pricing-table-wrap`) and generates the full table. Remove old hardcoded rows from HTML. [VERIFIED: custom-labels.html lines 154–174 — static rows exist]

---

## Copy Research

### Target Audiences (D-09)
Based on CONTEXT.md decisions, the page must address:
1. **Homebrewers** — existing core audience; wine/beer/cider bottles and cans
2. **Events & gifts** — weddings, milestone birthdays, corporate gifting, anniversary bottles
3. **Small businesses** — kombucha brewers, hot sauce makers, jam/preserve producers, farmers market vendors
4. **General "anyone"** — D-11 explicitly states: bring any bottle or can, no Steins & Vines purchase required

### Hero Copy Direction (Claude's Discretion)
The current hero subheadline reads: "Make your homebrew look as good as it tastes."
New direction should broaden without losing warmth. Suggestions for planner:
- "From homebrew bottles to wedding favours — we print labels for anything."
- "Your design. Your bottle. We'll make it look amazing."
- "Labels for your homebrew, your small batch, your special occasion."

The exact line is Claude's discretion; planner should write one and note it is adjustable.

### "Anyone Can" Messaging (D-11)
Current page is silent on whether non-customers can use the service. Must add a clear statement such as:
- Under the "How It Works" section or a dedicated callout box
- Example: "Not a Steins & Vines member? No problem. Bring us any bottle or can and we'll print labels for it."

[ASSUMED] — exact copy; tone guidance is from CONTEXT.md.

### Design Guidelines Update (D-15)
Current guideline "Label Dimensions" section lists old placeholder dimensions. Replace with a note that dimensions vary by label type (see pricing table). Remove specific size list from guidelines since LABEL_DATA now drives the table.

Additions from D-15:
- Max print width: 4.25" — new, not currently in the guidelines
- Waterproof BOPP material mention — adds credibility
- Don't name the printer model (currently clean — no model name in Phase 17 output)

[VERIFIED: custom-labels.html lines 206–226 — current guidelines section checked]

---

## Existing Phase 17 Infrastructure to Preserve

All of these are verified present and must not be broken: [VERIFIED: 17-VERIFICATION.md]

| Item | Location | Status |
|------|----------|--------|
| IIFE structure | 14-labels.js | Extend — do not convert to module |
| ES5 throughout | 14-labels.js | Must pass ESLint (no let/const/=>) |
| CJS export block | 14-labels.js bottom | Update exports when function names change |
| `drawFallbackTemplate()` | 14-labels.js | Keep as SVG-load-error safety net |
| `roundedRect()` helper | 14-labels.js | Reuse in all 3 canvas renders |
| `css/labels.css` responsive | labels.css | Extend for 3-column, don't remove existing rules |
| `images/labels/*.svg` | images/labels/ | Keep — fallbacks for photo load errors |
| Build pipeline entries | package.json | No changes needed — stamp:pages + minify:js already cover all labels files |
| `custom-labels.html` nav/header/footer | custom-labels.html | No changes — only content sections change |
| SEO meta/JSON-LD | custom-labels.html head | Update meta description to reflect broader audience |

---

## CSS Layout for 3-Preview (New Rules Needed)

The existing `labels.css` has no 3-column layout. New CSS needed:

```css
/* 3-preview layout — D-01 */
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

.labels-preview-col canvas {
  max-width: 100%;
  height: auto;
  border: 1px solid #ddd;
  border-radius: 8px;
  background-color: #fafafa;
}

.labels-preview-label {
  font-family: var(--font-body);
  font-size: 0.85rem;
  color: var(--color-muted);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

/* D-06: hide incompatible container preview */
.labels-preview-col.hidden {
  display: none;
}

/* Mobile: stack vertically per D-01 */
@media (max-width: 768px) {
  .labels-previews {
    flex-direction: column;
    align-items: center;
  }
  .labels-preview-col {
    max-width: 320px;
    width: 100%;
  }
}
```

[ASSUMED] — specific pixel values; will need visual tuning. CSS variables are from verified styles.css.

---

## Canvas Sizing Strategy

Phase 17 used a single 600x800 canvas for both templates. With 3 side-by-side canvases, each canvas should be smaller:

- **Flat canvas:** ~300x300 or aspect-ratio-driven (label shape determines visible content)
- **Can canvas:** ~280x420 (portrait, matches can photo proportions)
- **Bottle canvas:** ~280x560 (taller portrait, matches bottle photo proportions)

The canvas `width`/`height` attributes control the internal resolution. CSS `max-width: 100%` scales the display size. Setting canvas dimensions in JS based on the loaded photo's natural dimensions (scaled to fit a max pixel budget) is cleaner than hardcoding. [ASSUMED] — exact sizing depends on photo dimensions.

---

## Environment Availability Audit

Step 2.6: No external tools required. This phase is purely static file changes (HTML, CSS, JS, JPEG images). The build tools (`cleancss`, `terser`, `npm run build`) are already in `package.json` and verified as present from Phase 17 execution. Image download from Pexels is a one-time manual step (or curl command), not a build dependency.

Skip condition met: no new runtime dependencies.

---

## Validation Architecture

`nyquist_validation: false` in `.planning/config.json` — validation architecture section is skipped per config. [VERIFIED: .planning/config.json]

---

## Security Domain

`security_enforcement: true` in `.planning/config.json`. Phase 18 has a minimal security footprint — it is a static page with no authentication, no API calls, and no server-side processing. The relevant ASVS checks:

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | No | No auth on public page |
| V3 Session Management | No | No session state |
| V4 Access Control | No | Public page, no protected resources |
| V5 Input Validation | Yes | File upload: type + size validation already in handleFileUpload (Phase 17); extend to 3-canvas path |
| V6 Cryptography | No | No secrets, no encryption |

### Known Threat Patterns

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Malicious file upload (XSS via SVG upload) | Tampering | Accept list: PNG/JPG/WEBP only (no SVG, no HTML). Already enforced in Phase 17 `validTypes` array. Must carry forward to Phase 18 upload handler. |
| Canvas fingerprinting | Information Disclosure | Not a concern for this use case; no cross-origin data |
| XSS via label name in pricing table | Tampering | Pricing table built from hardcoded `LABEL_DATA` constant — no user input involved |

The existing `validTypes = ['image/png', 'image/jpeg', 'image/webp']` check in `handleFileUpload` must remain in force. Do not add `image/svg+xml`. [VERIFIED: 14-labels.js line 209]

The CSP on `custom-labels.html` restricts `img-src` to `'self' data:` — the new can/bottle photos must be served from the same origin (local files in `images/labels/`), not hotlinked from Pexels. [VERIFIED: custom-labels.html line 19]

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Scanline cosine warp with scale factor `0.3 + 0.7` produces visually acceptable cylindrical curvature | Pattern 3, Canvas Sizing | Warp looks too flat or too distorted — tunable by adjusting the 0.3 coefficient during implementation |
| A2 | Flat preview canvas shows dimension text reliably with `'13px Lato, Arial, sans-serif'` font | Pattern 4 | Text renders in wrong font — cosmetic only, fallback Arial is acceptable |
| A3 | Container compatibility for unlisted SKUs defaults to 'both' | LABEL_DATA constant | Some labels may only work on one container type — planner should ask user to confirm containers for 4x4 BOPP, Matte Poly, and unlisted Paper sizes |
| A4 | Pexels #8066771 is still available for download | Photo Assets | Photo may be removed — alternative Pexels search or user-supplied photo needed |
| A5 | `display:none` on hidden preview column is sufficient for D-06; no width/layout weirdness | Pitfall 2 | 2-column layout may need CSS adjustment — acceptable risk, visual QA will catch it |
| A6 | Canvas sizing ~280px wide per preview provides sufficient detail for user preview | Canvas Sizing | Too small on large monitors — max-width CSS can always be increased |
| A7 | Label region coordinates on photo canvases will require empirical tuning after photo selection | Photo Assets | Initial values may not align to photo bottle/can shape — task for visual QA |

---

## Open Questions (RESOLVED)

1. **Continuous roll label (4x100) in pricing table**
   - What we know: SKU 814042, $0.15/inch, "4x100 Continuous Satin BOPP"
   - What's unclear: How to represent a continuous roll in the mockup tool (D-06 container compatibility; it has no fixed label height)
   - Recommendation: Show it in the pricing table as-is with a note "price per inch"; exclude it from the mockup label-type selector (no canvas preview for continuous roll)
   - **RESOLVED:** Implemented per recommendation. LABEL_DATA entry has `continuous: true` flag; `buildPricingTable()` shows it with "/inch" pricing; `renderFlat()` shows "Continuous roll -- no flat preview" message; `populateLabelTypeSelector()` includes it as an option but flat canvas handles the special case. Can/bottle previews still render (they use the width for warp).

2. **Container compatibility for unlisted SKUs**
   - What we know: COGS CSV "Uses" field is blank for most labels except 814051 (both) and 814022 (bottle)
   - What's unclear: Should unlabeled SKUs default to 'both', 'bottle', or 'can'?
   - Recommendation: Default to 'both' (show all previews) for unlisted SKUs — conservative choice that never hides a relevant preview
   - **RESOLVED:** Implemented per recommendation. All unlisted SKUs have `containers: 'both'` in LABEL_DATA. Only SKU 814022 (4x6 Matte BOPP) is `containers: 'bottle'`.

3. **Bottle placeholder photo selection**
   - What we know: User specified "source a free stock photo of a dark unlabeled wine bottle"
   - What's unclear: Which specific Pexels photo to use
   - Recommendation: Planner specifies a candidate Pexels URL (e.g. search "wine bottle blank dark green"); user will swap in their own photo later
   - **RESOLVED:** Plan 01 Task 1 downloads a Pexels free-license dark wine bottle photo to `images/labels/bottle-photo.jpg`. User confirmed they will swap in their own photo later (D-17).

4. **Label type selector UI**
   - What we know: D-06 requires label-type selection to drive container compatibility show/hide
   - What's unclear: Should this be a dropdown select, a scrollable list, or tabs? The CONTEXT.md doesn't specify.
   - Recommendation: A `<select>` dropdown is the simplest ES5 pattern; renders well on mobile. Planner can choose a styled list if preferred.
   - **RESOLVED:** Implemented as a `<select>` dropdown per recommendation. Plan 01 creates the HTML element (`<select id="labels-type-select">`); Plan 02 `populateLabelTypeSelector()` populates options from LABEL_DATA and `handleLabelTypeChange()` drives container show/hide.

---

## Sources

### Primary (HIGH confidence)
- `custom-labels.html` — current page structure, CSP, canvas elements [VERIFIED: read 2026-05-18]
- `css/labels.css` — existing responsive layout rules [VERIFIED: read 2026-05-18]
- `js/modules/14-labels.js` — IIFE structure, LABEL_REGIONS, upload handler [VERIFIED: read 2026-05-18]
- `COGS - Labels.csv` at /Users/koa/Downloads — all SKUs, prices, materials, uses [VERIFIED: read 2026-05-18]
- `package.json` — build pipeline (stamp:pages, minify:css, minify:js entries) [VERIFIED: read 2026-05-18]
- `.planning/config.json` — nyquist_validation: false, security_enforcement: true [VERIFIED: read 2026-05-18]
- `CLAUDE.md` — ES5 constraint, build rules, test requirements [VERIFIED: read 2026-05-18]
- `18-CONTEXT.md` — all D-01 through D-18 decisions [VERIFIED: read 2026-05-18]
- `17-VERIFICATION.md` — Phase 17 artifact inventory and wiring confirmation [VERIFIED: read 2026-05-18]

### Secondary (MEDIUM confidence)
- WebSearch: perspective.js, jlouthan/perspective-transform — existence of canvas perspective transform libraries confirmed; not usable due to ES5/no-bundler constraint [WebSearch 2026-05-18]
- WebSearch: scanline cylindrical warp technique — confirmed as standard approach in graphics literature [WebSearch 2026-05-18]

---

## Project Constraints (from CLAUDE.md)

All Phase 18 work must comply with:

1. **ES5 only** — `var`, no `let`/`const`, no arrow functions, no template literals. ESLint will fail if violated.
2. **Never edit `js/main.js` or `js/main.min.js` directly** — `14-labels.js` is separate from the concatenated bundle; edit the source only.
3. **Run `npm test` AND `cd zoho-middleware && npm test` before every commit** — no failing tests.
4. **Run `npm run lint` before every commit** — fix all ESLint errors.
5. **Run `npm run build` after any CSS/JS change** — regenerates minified artifacts.
6. **All changes to staging first** — `git push origin main` → verify at staging.steinsandvines.ca → only then production.
7. **Never commit `.env` files or API credentials.**

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all tools are browser-native or already in use; no new npm packages
- Architecture: HIGH — LABEL_DATA constant, 3-canvas structure, and pricing table pattern are all straightforward extensions of Phase 17 patterns
- Pitfalls: HIGH — all pitfalls identified from direct code inspection
- Warp technique: MEDIUM — scanline approach is well-established but exact parameters need visual tuning during implementation
- Copy: MEDIUM — direction from CONTEXT.md; exact text is Claude's discretion

**Research date:** 2026-05-18
**Valid until:** 2026-06-18 (stable domain — HTML Canvas API, vanilla JS, static files)
