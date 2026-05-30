# Phase 23: Cross-Category Search - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-30
**Phase:** 23-cross-category-search
**Areas discussed:** Overlay Appearance, Result Display, Edge Cases

---

## Overlay Appearance

### Q1: How should the search overlay appear?

| Option | Description | Selected |
|--------|-------------|----------|
| Dropdown panel | Panel slides down from sub-nav, pushing content below. Lightweight and contextual. | |
| Full-screen overlay | Dark-backdrop overlay covers whole viewport. More dramatic but heavier. | |
| Inline expansion | Search input replaces sub-nav pills. Minimal but limited space. | |

**User's choice:** Hybrid — dropdown panel on desktop (>=768px), full-screen overlay on mobile (<768px).
**Notes:** User clarified before selecting that they wanted responsive behavior: desktop gets the dropdown, phone gets full-screen.

### Q2: Should the panel have a backdrop?

| Option | Description | Selected |
|--------|-------------|----------|
| Light backdrop | Semi-transparent dark overlay behind the panel. Draws focus to results. | ✓ |
| No backdrop | Panel floats below sub-nav with shadow. Page content stays visible. | |

**User's choice:** Light backdrop
**Notes:** None

### Q3: How should results be grouped?

| Option | Description | Selected |
|--------|-------------|----------|
| Category headers | Results grouped under bold category headers with match count. Categories sorted by matches. | ✓ |
| Flat list | All results in one list sorted by relevance with category tag/badge per item. | |
| You decide | Claude picks. | |

**User's choice:** Category headers
**Notes:** None

---

## Result Display

### Q4: What info per result row?

| Option | Description | Selected |
|--------|-------------|----------|
| Name + price + stock | Product name, price with unit, in-stock/out-of-stock badge. | ✓ |
| Name + price only | Cleaner rows, user checks stock after clicking through. | |
| Name only | Minimal — search is just for navigation. | |

**User's choice:** Name + price + stock
**Notes:** None

### Q5: Max number of results?

| Option | Description | Selected |
|--------|-------------|----------|
| Cap at ~5 per category | Top 5 per group with "View all" link. | |
| Show all matches | Every matching item appears. | |
| You decide | Claude picks. | |

**User's choice:** Dynamic cap — ~5 per category when many categories match, ~10 per category when only 1–2 categories match.
**Notes:** User proposed the hybrid approach: "Could we do 1 but also have it show more if there is only a few categories represented"

### Q6: Should out-of-stock items appear?

| Option | Description | Selected |
|--------|-------------|----------|
| Show but dimmed | Out-of-stock items appear with reduced opacity, no cart controls. | ✓ |
| Hide out-of-stock | Only show items currently in stock. | |
| You decide | Claude picks. | |

**User's choice:** Show but dimmed
**Notes:** None

### Q7: Click action on result rows?

| Option | Description | Selected |
|--------|-------------|----------|
| Navigate to item | Clicking navigates to category subpage with ?item=SKU deep-link. | |
| Add to cart inline | Each result row has a quick-add button right in the overlay. | ✓ |

**User's choice:** Add to cart inline
**Notes:** Departing from original success criteria. Discussed dual interaction.

### Q8: Dual interaction design?

| Option | Description | Selected |
|--------|-------------|----------|
| Name navigates + cart button | Clicking name navigates to subpage. Small cart/+ button does inline add. Both per row. | ✓ |
| Cart button only | Row click adds to cart. Small link icon navigates to subpage. | |
| You decide | Claude picks. | |

**User's choice:** Name navigates + cart button
**Notes:** None

---

## Edge Cases

### Q9: No-results state?

| Option | Description | Selected |
|--------|-------------|----------|
| Friendly message + suggestions | "No ingredients found" with category links for browsing. | |
| Simple message | Just "No results found" with nothing else. | ✓ |
| You decide | Claude picks. | |

**User's choice:** Simple message
**Notes:** None

### Q10: Which pages get search?

| Option | Description | Selected |
|--------|-------------|----------|
| All 7 ingredient pages | Wire up every .subnav-search-btn. Consistent experience. | ✓ |
| Subpages only (6 pages) | Skip All Ingredients page since it has its own inline search. | |

**User's choice:** All 7 ingredient pages
**Notes:** None

---

## Claude's Discretion

- Overlay open/close animation style
- ESC key and backdrop-click to close
- Auto-focus on search input
- Search input placeholder text
- Category group header and result row styling
- "View all" link behavior (navigate vs expand)
- Cart button design
- Weight-based item handling in inline cart
- Debounce timing

## Deferred Ideas

None — discussion stayed within phase scope
