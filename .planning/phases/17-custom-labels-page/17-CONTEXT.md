# Phase 17: custom-labels-page - Context

**Gathered:** 2026-05-18
**Status:** Ready for planning
**Source:** PRD Express Path (docs/spec-custom-labels-page.md)

<domain>
## Phase Boundary

A new public-facing page at `/custom-labels.html` showcasing the custom label printing service. Includes pricing table, label type options, and an interactive canvas-based mockup tool where customers upload artwork to preview on wine bottle or can templates. All client-side — no server upload or payment integration.

</domain>

<decisions>
## Implementation Decisions

### Page Structure
- D-01: Page must match existing site layout exactly — same head setup, sticky header, footer, `.container` wrapper (max-width: 1100px)
- D-02: Use existing CSS variables: `--color-cream`, `--color-green`, `--color-burgundy`, `--color-text`, `--font-display`, `--font-body`
- D-03: Add "Custom Labels" link to Products dropdown nav on all pages alongside "Ferment in Store" and "Ingredients & Supplies"

### Content Sections
- D-04: Hero section with green background matching existing hero pattern, headline "Custom Label Printing" in Playfair Display
- D-05: "How It Works" 3-step section (design, we print, you apply)
- D-06: Pricing table with $10 flat setup fee + per-label cost; use placeholder prices — structure data so prices are easy to update (JS object or data attributes)
- D-07: Design Guidelines section with recommended formats (PNG, 300 DPI), bleed/safe area dimensions, color mode info
- D-08: CTA section linking to contact page with turnaround time placeholder ("Labels ready in 5-7 business days")

### Mockup Tool
- D-09: Template selector with two buttons/tabs: "Wine Bottle" and "Can"
- D-10: Upload button accepting `.png`, `.jpg`, `.jpeg`, `.webp` — max 5 MB client-side validation — use FileReader API
- D-11: Canvas-based composite rendering — draw bottle/can base, scale/position uploaded image into label region, apply perspective/clipping effect
- D-12: Default state shows placeholder label ("Your Design Here") before upload
- D-13: Reset button clears uploaded image and returns to placeholder

### Technical Implementation
- D-14: Vanilla JS (ES5 compatible) — new module `js/modules/14-labels.js` as self-contained IIFE
- D-15: Page-specific CSS in `css/labels.css` imported after `styles.min.css`
- D-16: Template images in `img/labels/` directory (bottle-template.png, can-template.png, placeholder-label.png)
- D-17: Label region coordinates defined as constants in 14-labels.js for easy tweaking
- D-18: After creating module, run `npm run build` to regenerate main.js/main.min.js

### Claude's Discretion
- Specific hero subheadline copy
- How It Works icon/illustration approach (SVG icons, CSS shapes, or text-only)
- Exact placeholder prices for the pricing table
- Whether Design Guidelines uses accordion or simple list
- SVG vs PNG approach for bottle/can template images
- Exact canvas dimensions and label region coordinates
- SEO meta tags content (follow existing page patterns)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Spec
- `docs/spec-custom-labels-page.md` — Full feature specification with all requirements

### Existing Page Patterns
- `about.html` — Reference for page structure, header/footer, meta tags, GTM setup
- `products.html` — Reference for Products dropdown nav structure
- `css/styles.css` — Existing CSS variables and component patterns
- `js/modules/01-config.js` — Config pattern for any label-related constants
- `js/modules/13-init.js` — Content loader pattern (data-page, data-content)

</canonical_refs>

<specifics>
## Specific Ideas

### Pricing Table Data Structure
```
Label types: Wine Bottle Front (4"x5"), Wine Bottle Back (3"x4"), Wine Bottle Wrap (4"x10"), Can Standard 355ml (8.25"x3.5"), Can Tall 473ml (8.25"x4.75")
Setup fee: $10 one-time per design
```

### New Files
```
custom-labels.html, css/labels.css, js/modules/14-labels.js
img/labels/bottle-template.png, img/labels/can-template.png, img/labels/placeholder-label.png
```

### Files to Modify
```
All pages with nav (index.html, products.html, about.html, contact.html, etc.) — add Custom Labels to Products dropdown
js/modules/01-config.js — label-related config if needed
```

</specifics>

<deferred>
## Deferred Ideas

- Server-side file upload or order processing
- Payment integration for labels
- Full 3D rotating model (may revisit later)
- Print-ready PDF generation from uploaded image

</deferred>

---

*Phase: 17-custom-labels-page*
*Context gathered: 2026-05-18 via PRD Express Path*
