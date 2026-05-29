# Phase 21: Shared Template & Build Infrastructure - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-28
**Phase:** 21-shared-template-build-infrastructure
**Areas discussed:** Card design & layout, Hero & accent colors, Sort & filter controls, Data loading strategy

---

## Card Design & Layout

| Option | Description | Selected |
|--------|-------------|----------|
| Simple product cards | Name, price, stock badge, add-to-cart button. Compact and fast. | |
| Expandable detail cards | Click to expand showing description, weight options, stock count. | ✓ |
| You decide | Claude picks based on data richness per category. | |

**User's choice:** Expandable detail cards
**Notes:** None

| Option | Description | Selected |
|--------|-------------|----------|
| 3 columns (like hops) | More room per card for expanded detail panel. | |
| 4 columns (like ingredients tab) | More items visible at once. | |
| Responsive: 4 default, 3 when expanded | Adapts based on state. | |

**User's choice:** Responsive auto-fill up to max 4 columns based on window width
**Notes:** User asked "Could it depend on how wide the window is to a max of 4 columns?" — confirmed this is standard CSS grid auto-fill behavior.

| Option | Description | Selected |
|--------|-------------|----------|
| Expand inline (push cards down) | Card grows taller in place. | |
| Full-width detail row below | Opens detail panel below the grid row. | |
| You decide | Claude picks based on hops page pattern. | |

**User's choice:** Full-width detail row with ghost placeholder
**Notes:** User explicitly dislikes how hops expanded view covers other cards. Wants expanded card to lift into its own row, leaving a transparent/ghost spot in the grid. Other cards remain visible.

| Option | Description | Selected |
|--------|-------------|----------|
| Compact table rows | Name, Price, Stock, Add to Cart — dense, scannable. | ✓ |
| Horizontal card rows | Horizontal card with elements side by side. | |
| You decide | Claude picks based on existing patterns. | |

**User's choice:** Compact table rows
**Notes:** None

---

## Hero & Accent Colors

| Option | Description | Selected |
|--------|-------------|----------|
| Minimal banner | Thin colored strip with category name. | |
| Medium hero | ~150px with name, description, item count. | ✓ |
| No hero, just a heading | Plain h1 with colored accent. | |

**User's choice:** Medium hero with expandable SEO description
**Notes:** User wants a "Read more" toggle that expands a longer SEO-keyword-rich paragraph.

| Option | Description | Selected |
|--------|-------------|----------|
| Derive from existing palette | Use green/brown/amber tones with shade variations. | ✓ |
| Distinct per category | Each category gets its own distinct color. | |
| You decide | Claude picks colors fitting the dark green aesthetic. | |

**User's choice:** Derive from existing palette with unique undertone/accent colors
**Notes:** Each page should have a unique feel while still maintaining the brand look.

---

## Sort & Filter Controls

| Option | Description | Selected |
|--------|-------------|----------|
| Name + Price only | A-Z, Z-A, Price low-high, Price high-low. | |
| Name + Price + In Stock first | Above plus in-stock items prioritized. | ✓ |
| You decide | Claude picks sensible defaults per category. | |

**User's choice:** Name + Price + In Stock first
**Notes:** None

| Option | Description | Selected |
|--------|-------------|----------|
| No sub-filters for v1 | One page per category, sort only. | |
| Basic sub-filters where data exists | Filter pills only where natural groupings exist. | ✓ |

**User's choice:** Basic sub-filters where data exists
**Notes:** None

---

## Data Loading Strategy

| Option | Description | Selected |
|--------|-------------|----------|
| Single fetch, client-side filter | Fetch /api/ingredients, filter in JS, cache in localStorage. | ✓ |
| Per-category API endpoints | New server-side filtered endpoints. | |
| Snapshot JSON fallback | Load static JSON first, hydrate with live data. | |

**User's choice:** Single fetch, client-side filter (recommended option)
**Notes:** None

| Option | Description | Selected |
|--------|-------------|----------|
| SUBPAGE_CONFIG defines the filter | Config lists which cf_subcategory and cf_type values to include. | |
| You decide | Claude designs mapping logic based on Phase 20 data findings. | ✓ |

**User's choice:** You decide
**Notes:** Claude to design the exact category mapping data structure using cf_subcategory + cf_type fallback from Phase 20.

## Claude's Discretion

- Category-to-filter mapping logic (SUBPAGE_CONFIG data structure for cf_subcategory + cf_type)
- Specific accent color hex values per category
- Build pipeline integration details
- Out-of-stock indicator design
- Empty category message wording

## Deferred Ideas

None
