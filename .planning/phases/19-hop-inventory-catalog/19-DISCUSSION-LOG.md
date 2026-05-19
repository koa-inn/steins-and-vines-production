# Phase 19: Hop Inventory Catalog - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-18
**Phase:** 19-hop-inventory-catalog
**Areas discussed:** Data source & attributes, Card design & expand, Radar chart rendering, Page & navigation

---

## Data Source & Attributes

| Option | Description | Selected |
|--------|-------------|----------|
| Zoho Inventory | Pull from existing catalog — middleware API enriches with custom fields | ✓ |
| Google Sheet / CSV | Separate spreadsheet, loaded client-side or via Apps Script | |
| Hardcoded JS constant | Like LABEL_DATA — baked into JS | |

**User's choice:** Zoho Inventory
**Notes:** Same pipeline as kits and ingredients.

### Radar Chart Axes

| Option | Description | Selected |
|--------|-------------|----------|
| 6 axes | Citrus, Tropical, Floral, Spicy, Pine, Herbal | ✓ |
| 9 axes (Beer Maverick) | Adds Stone Fruit, Berry, Grassy | |
| You decide | Best balance for the catalog | |

**User's choice:** 6 axes
**Notes:** User initially asked to research what others do. Claude researched Beer Maverick (9 axes), Yakima Chief (sensory 0–5 scale), and Hop Union aroma wheel (11 classifications). User agreed 6 is the sweet spot. Alpha acid and origin shown as text specs, not chart axes.

### Additional Data Fields

**User's choice:** Include a brief notes field per hop — origin story, history, or notoriety. Not dry specs.

---

## Card Design & Expand

### Collapsed Card Face

| Option | Description | Selected |
|--------|-------------|----------|
| Name + mini radar + alpha acid | Small radar thumbnail on card face | |
| Name + top flavor tags | No chart collapsed, just flavor tags | |
| Name + price + alpha acid | Product-focused like ingredients cards | |

**User's choice:** Custom — Name + Price + Alpha Acid + 2–3 flavor note tags

### Expand Behavior

| Option | Description | Selected |
|--------|-------------|----------|
| Inline accordion | Card expands in place, pushing content down | ✓ |
| Slide-out panel | Panel slides in from right | |
| Modal overlay | Centered popup | |

**User's choice:** Inline accordion
**Notes:** User specifically requested reusing the wine card expand/contract infrastructure (`buildLabelNotesToggle`) to maintain site cohesion.

### Cart Integration

**User's choice:** Add to Cart — but each hop has two size variants (both in Zoho), so needs a size selector.

### Size Selector

| Option | Description | Selected |
|--------|-------------|----------|
| Toggle buttons on card | Two buttons (e.g. 1 oz / 4 oz), price updates | ✓ |
| Dropdown select | `<select>` with sizes and prices | |
| Separate cards per size | Each variant gets its own card | |

**User's choice:** Toggle buttons on the expanded card

---

## Radar Chart Rendering

### Technology

| Option | Description | Selected |
|--------|-------------|----------|
| Inline SVG | Built in JS, lightweight, scales perfectly | ✓ |
| Canvas | Reuse 14-labels.js pattern | |
| Chart.js library | Drop-in library, ~60KB | |

**User's choice:** Inline SVG

### Color Scheme

| Option | Description | Selected |
|--------|-------------|----------|
| Green fill (brand color) | Semi-transparent var(--color-green), all hops same | ✓ |
| Tinted by hop type | Different colors by category | |
| You decide | Best match with site palette | |

**User's choice:** Green fill (brand color)

---

## Page & Navigation

### Page Location

| Option | Description | Selected |
|--------|-------------|----------|
| New dedicated page | hops.html with own CSS, in Products dropdown | ✓ |
| Tab on ingredients page | Hops tab alongside ingredients catalog | |
| Section on ingredients page | Scroll-down section, no tabs | |

**User's choice:** Dedicated page
**Notes:** Claude recommended dedicated page for cleaner presentation, better SEO, and separation of concerns. Ingredients page keeps basic hop listings too.

### Filtering & Sorting

| Option | Description | Selected |
|--------|-------------|----------|
| Search + sort only | Search box and sort options | |
| Full filters like ingredients | Category filters, search, and sort | ✓ |
| No filtering needed | Just show all hops in a grid | |

**User's choice:** Full filters like ingredients

---

## Claude's Discretion

- Radar chart sizing and axis label positioning
- Grid vs list layout for hop cards
- Specific filter categories
- Mobile responsive breakpoints

## Deferred Ideas

None — discussion stayed within phase scope
