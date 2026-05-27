# Phase 18: Custom Labels Iteration - Context

**Gathered:** 2026-05-18
**Status:** Ready for planning

<domain>
## Phase Boundary

Upgrade the existing custom-labels.html page with a photo-realistic 3-preview mockup tool (flat label + real can photo + real bottle photo), broader copy positioning the label printing service for any customer (not just homebrewers), real pricing from the COGS spreadsheet, and accurate CW-C4000 printer specs in design guidelines. All changes are to the existing page and JS module — no new pages or server-side work.

</domain>

<decisions>
## Implementation Decisions

### 3-Preview Mockup Layout
- D-01: Three previews displayed side by side (flat | can | bottle), all visible at once. Stacks vertically on mobile.
- D-02: Single upload button — user uploads once, all 3 previews update simultaneously.
- D-03: Flat view shows exact-dimensions rectangle at the label's actual aspect ratio with dimension labels (e.g. 4"x3") overlaid.
- D-04: Can and bottle previews use perspective warp/curve transform to simulate label wrapping around the cylinder. More realistic than simple overlay.
- D-05: Default state (no upload) shows placeholder "Your Design Here" composited onto all visible previews.
- D-06: Label types have a container compatibility field (bottle, can, or both). Only matching container preview(s) are shown — if a label fits only bottles, the can preview hides and vice versa. Flat view always shows.

### Label Data Source
- D-07: Label types, dimensions, prices, and container compatibility defined as a JS object constant in 14-labels.js (or a new config section). No server-side data source needed. Data comes from the COGS spreadsheet (see Specific Ideas below).
- D-08: Exclude labels marked "Used for packaging" from the public page — those are internal Steins & Vines stock (SKUs 11013-c4000, 11034-c4000).

### Copy & Positioning
- D-09: Broaden copy beyond homebrewers — target audiences include homebrewers, events/gifts (weddings, birthdays, corporate), and small businesses (kombucha, hot sauce, farmers market vendors).
- D-10: Warm & approachable tone matching existing Steins & Vines voice — not corporate/stiff.
- D-11: Explicitly state that anyone can get labels printed, even if they didn't buy/brew at Steins & Vines. Example: "Bring any bottle or can — we'll print labels for it."

### Pricing Table
- D-12: Use real prices from the COGS spreadsheet (Sale Price/Label column). $10 setup fee per design.
- D-13: Group labels by material type in 3 sections: Satin/Matte BOPP (waterproof), Matte Poly (durable), High Gloss Paper (budget).
- D-14: Include a "Best For" / "Fits" column showing container compatibility from the Uses field.

### Design Guidelines
- D-15: Show practical customer-facing specs: file format (PNG/JPG), 300 DPI recommended, max print width 4.25", CMYK preferred (RGB accepted). Mention waterproof BOPP material for credibility. Don't name-drop the printer model.

### Photo Assets
- D-16: Can photo: Pexels #8066771 (blank silver can on white, by Mediamodifier, free commercial use). Use as-is.
- D-17: Bottle photo: Use a free stock photo as temporary placeholder until user provides their own photo of a real blank wine bottle. User will swap in their own photo later.
- D-18: Photos stored in images/labels/ directory (replacing or alongside existing SVGs).

### Claude's Discretion
- Hero subheadline copy (warm, inclusive of all audiences)
- Exact wording for the "anyone can get labels" messaging
- Which stock bottle photo to use as placeholder
- How to render the dimension labels on the flat preview
- Exact perspective warp parameters for can/bottle compositing
- Responsive breakpoint behavior for the 3-column layout
- Whether to keep the existing SVG fallbacks alongside the new photo-based previews

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Existing Page & Module (from Phase 17)
- `custom-labels.html` — Current page structure with all 6 content sections
- `css/labels.css` — Page-specific styles including mockup tool layout, responsive breakpoints
- `js/modules/14-labels.js` — Current canvas mockup IIFE (LABEL_REGIONS, template switching, upload, compositing, reset)
- `images/labels/bottle-template.svg` — Current SVG bottle template (may be replaced or supplemented)
- `images/labels/can-template.svg` — Current SVG can template (may be replaced or supplemented)
- `images/labels/placeholder-label.svg` — Current placeholder graphic

### Pricing Data
- `/Users/koa/Downloads/COGS - Labels.csv` — Full COGS spreadsheet with SKUs, materials, dimensions, costs, sale prices, uses, and suppliers. Source of truth for pricing table data.

### Existing Patterns
- `about.html` — Reference for page structure consistency
- `css/styles.css` — CSS variables (--color-cream, --color-green, --color-burgundy, etc.)
- `js/modules/01-config.js` — Config constant pattern
- `js/modules/13-init.js` — Content loader pattern

### Spec
- `docs/spec-custom-labels-page.md` — Original feature specification from Phase 17

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `14-labels.js` IIFE structure: Already has canvas init, template preloading, upload handling, FileReader validation, rounded-rect clipping, and CJS exports. Extend rather than rewrite.
- `LABEL_REGIONS` constant: Currently defines bottle/can regions. Will need expansion for 3-preview layout with different canvas sizes.
- `drawFallbackTemplate()`: Canvas-drawn fallback shapes if images fail to load. Keep as safety net.
- `css/labels.css`: Full responsive layout already exists. Extend for 3-column side-by-side.

### Established Patterns
- ES5 only (var, no arrow functions, no template literals) per D-14 from Phase 17
- Self-contained IIFE with DOMContentLoaded init
- CJS export block for testing
- CSS variables from styles.css for all colours/fonts

### Integration Points
- `custom-labels.html` section structure — mockup section needs new HTML for 3 canvases
- `package.json` build scripts — already include labels.css and 14-labels.js minification
- Pricing table HTML — currently hardcoded, will be replaced with data-driven rendering from JS constant

</code_context>

<specifics>
## Specific Ideas

### Pricing Data (from COGS spreadsheet)
```
BOPP (Waterproof):
  4x3 Satin BOPP — $0.45/label — 355mL Beer Bottle, 750mL Wine Bottle, 355mL Can
  4x6 Matte BOPP — $1.15/label — 750mL Wine Bottle
  4x4 Matte BOPP — $0.75/label
  2.5 Circle Satin BOPP — $0.30/label
  4x100 Continuous Satin BOPP — $0.15/inch

Matte Poly (Durable):
  3x5 Matte Poly — $0.70/label
  4x3 Matte Poly — $0.50/label
  2 Circle Matte Poly — $0.25/label

High Gloss Paper (Budget):
  3x3 High Gloss Paper — $0.30/label
  4x2 High Gloss Paper — $0.25/label
  3x6 High Gloss Paper — $0.65/label
  4x4 High Gloss Paper — $0.50/label
  3x5 High Gloss Paper — $0.55/label
  3 Circle High Gloss Paper — $0.30/label
  2 Circle High Gloss Paper — $0.15/label

Setup fee: $10 per design
```

### Can Photo
- Pexels photo #8066771 — download full resolution, save to images/labels/can-photo.jpg
- URL: https://www.pexels.com/photo/silver-can-in-white-background-8066771/

### Bottle Photo (temporary)
- Source a free stock photo of a dark unlabeled wine bottle on clean background
- Save to images/labels/bottle-photo.jpg
- User will replace with their own photo later

</specifics>

<deferred>
## Deferred Ideas

- Server-side file upload or order processing
- Payment integration for labels
- Full 3D rotating model
- Print-ready PDF generation from uploaded image
- Design service tiers (DIY, template, bespoke)
- Wedding/corporate package pricing
- BC LCRB label-content compliance research
- Customer gallery / Instagram tie-in
- Pull pricing dynamically from Google Sheet (currently hardcoded JS)

</deferred>

---

*Phase: 18-custom-labels-iteration*
*Context gathered: 2026-05-18*
