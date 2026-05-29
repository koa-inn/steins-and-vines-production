# Phase 22: Category Subpages & Navigation - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-29
**Phase:** 22-category-subpages-navigation
**Areas discussed:** Sub-nav bar design, URL & page structure, Products dropdown, Existing pages impact

---

## Sub-nav Bar Design

### Style

| Option | Description | Selected |
|--------|-------------|----------|
| Pill tabs | Horizontal row of rounded pill buttons. Active tab gets filled/accent background. Scrollable on mobile. | ✓ |
| Underline tabs | Text-only links with underline indicator on active tab. More minimal. | |
| You decide | Let Claude pick what works best. | |

**User's choice:** Pill tabs

### Sticky behavior

| Option | Description | Selected |
|--------|-------------|----------|
| Sticky below header | Sub-nav sticks below site header when scrolling past it. Always visible. | ✓ |
| Static (scrolls away) | Part of page flow between hero and grid. User scrolls back to switch. | |
| You decide | Let Claude pick based on page length and UX. | |

**User's choice:** Sticky below header

### Mobile handling

| Option | Description | Selected |
|--------|-------------|----------|
| Horizontal scroll | All tabs in a single scrollable row. Active tab auto-scrolls into view. | |
| Two-row wrap | Tabs wrap to second row on narrow screens. All visible but more vertical space. | |
| You decide | Let Claude pick best mobile approach. | ✓ |

**User's choice:** You decide

### Search icon

| Option | Description | Selected |
|--------|-------------|----------|
| Yes, add search icon | Magnifying glass at right end of sub-nav. Non-functional until Phase 23. | ✓ |
| No, keep it clean | Sub-nav is just category tabs. Search added in Phase 23 separately. | |

**User's choice:** Yes, add search icon

---

## URL & Page Structure

### File location

| Option | Description | Selected |
|--------|-------------|----------|
| products/ subfolder | e.g. products/grains.html. Consistent with existing products/ pages. | ✓ |
| Root directory | e.g. grains.html at root level like hops.html. Simpler but crowded. | |
| You decide | Let Claude pick. | |

**User's choice:** products/ subfolder

### Config placement

| Option | Description | Selected |
|--------|-------------|----------|
| Inline in each HTML | Each subpage defines its own SUBPAGE_CONFIG in a script block. | |
| Shared config JS file | Single subpage-configs.js with all configs. | |
| You decide | Let Claude pick cleanest approach. | ✓ |

**User's choice:** You decide

### Hops page location

| Option | Description | Selected |
|--------|-------------|----------|
| Leave at root | Already live and indexed. Sub-nav can link to /hops.html. | |
| Move to products/hops.html | Consistent URL hierarchy. Needs link updates. | ✓ |

**User's choice:** Move to products/hops.html

### Hops redirect

| Option | Description | Selected |
|--------|-------------|----------|
| Yes, redirect old URL | Meta refresh or JS redirect preserving SEO equity and bookmarks. | |
| No, just move it | Delete old file, update internal links, accept temporary 404s. | ✓ |

**User's choice:** No redirect

---

## Products Dropdown

### Structure

| Option | Description | Selected |
|--------|-------------|----------|
| Grouped with divider | Current items as top group, divider, then ingredient categories below. | ✓ |
| Flat list | All items listed alphabetically or logically. 9+ items. | |
| Nested sub-menu | "Ingredients" becomes a flyout containing categories. Tricky on mobile. | |

**User's choice:** Grouped with divider

### Ingredients & Supplies link behavior

| Option | Description | Selected |
|--------|-------------|----------|
| Keep as link to All | Remains clickable, points to All Ingredients page. | |
| Replace with section header | Non-clickable label with category links below. | |
| You decide | Let Claude pick based on dropdown UX. | ✓ |

**User's choice:** You decide

---

## Existing Pages Impact

### ingredients-supplies.html fate

| Option | Description | Selected |
|--------|-------------|----------|
| Becomes the All tab | Keeps existing page, adds sub-nav. "All" tab links here. | ✓ |
| Replace with new All page | Create new page using shared template. Retire old page. | |
| You decide | Let Claude determine best approach. | |

**User's choice:** Becomes the All tab

### Hops module approach

| Option | Description | Selected |
|--------|-------------|----------|
| Keep 15-hops.js | Hops has unique features (radar charts). Just move file, add sub-nav. | ✓ |
| Convert to shared template | Rewrite hops to use 16-catalog-subpage.js. Risk breaking features. | |
| You decide | Let Claude assess. | |

**User's choice:** Keep 15-hops.js

### Products.html ingredients tab

| Option | Description | Selected |
|--------|-------------|----------|
| Remove ingredients tab | products.html becomes Kits + Services only. | |
| Keep as teaser | Truncated grid with "View All" link. | |
| You decide | Let Claude pick best transition. | ✓ |

**User's choice:** You decide

### Sub-nav scope

| Option | Description | Selected |
|--------|-------------|----------|
| All ingredient pages | Sub-nav on all 7 pages (All, Hops, 5 new). Consistent per NAV-01. | ✓ |
| New subpages only | Sub-nav only on 5 new pages. Less work but inconsistent. | |

**User's choice:** All ingredient pages

---

## Claude's Discretion

- Mobile sub-nav behavior (horizontal scroll vs. two-row wrap)
- SUBPAGE_CONFIG placement (inline vs. shared file)
- Ingredients & Supplies dropdown link behavior (clickable vs. section header)
- Products.html ingredients tab fate (remove vs. teaser)
- Sub-nav pill styling details (colors, spacing, animation)
- Dropdown divider styling

## Deferred Ideas

- Hop comparison mode feature (existing todo: `2026-05-20-hop-compare-mode.md`)
- Cross-category search wiring (Phase 23)
- Per-subpage SEO meta (Phase 24)
