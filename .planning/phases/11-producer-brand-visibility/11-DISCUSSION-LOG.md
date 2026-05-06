# Phase 11: Producer & Brand Visibility - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-06
**Phase:** 11-producer-brand-visibility
**Areas discussed:** Display format, Manufacturer data source, Where it shows, Fallback behavior

---

## Display Format

### Q1: How should producer + brand + product name appear on kit cards?

| Option | Description | Selected |
|--------|-------------|----------|
| Producer as new line above brand | Add a smaller "producer" line above the existing brand element. Keeps existing layout intact. | ✓ |
| Combined single string | Merge into one formatted name. Simpler but loses visual hierarchy. | |
| You decide | Let Claude pick. | |

**User's choice:** Producer as new line above brand
**Notes:** Mirrors how wine bottles show vineyard above label name.

### Q2: Font treatment for producer line?

| Option | Description | Selected |
|--------|-------------|----------|
| Smaller + muted | Smaller font size and lighter color than brand. Clear hierarchy. | ✓ |
| Match brand styling | Same size/weight as brand. | |
| You decide | Let Claude pick. | |

**User's choice:** Smaller + muted

### Q3: Non-label card and table display?

| Option | Description | Selected |
|--------|-------------|----------|
| Separate line everywhere | Producer is always its own element. | |
| Separate on cards, inline in tables | Cards get separate line; tables/sidebar show "Producer — Name" inline. | ✓ |
| You decide | Let Claude pick per-surface. | |

**User's choice:** Separate on cards, inline in tables

### Q4: Inline separator?

| Option | Description | Selected |
|--------|-------------|----------|
| Em dash: Producer — Name | Clear visual break. | |
| Pipe: Producer \| Name | Lighter weight. | |
| You decide | Let Claude pick. | ✓ |

**User's choice:** You decide

---

## Manufacturer Data Source

### Q1: Where is producer data stored in Zoho?

| Option | Description | Selected |
|--------|-------------|----------|
| Standard manufacturer_name field | Zoho's built-in Manufacturer field on items. | ✓ |
| Custom field | Stored in a custom field. | |
| Not sure — need to check | Need to look at actual Zoho data. | |

**User's choice:** Standard manufacturer_name field

### Q2: Enrichment pattern?

| Option | Description | Selected |
|--------|-------------|----------|
| Same pattern as brand | Add manufacturer alongside brand in all enrichment paths. | ✓ |
| Derive from name parsing | Parse producer from product name string. | |
| You decide | Let Claude determine. | |

**User's choice:** Same pattern as brand

### Q3: Data completeness?

| Option | Description | Selected |
|--------|-------------|----------|
| Already populated | All kits have manufacturer in Zoho. | |
| Mostly populated, some gaps | Most kits have it, some missing. | ✓ |
| Not yet — need data entry first | Manufacturer field isn't widely used. | |

**User's choice:** Mostly populated, some gaps
**Notes:** Feature ships with fallback handling rather than blocking on data cleanup.

---

## Where It Shows

### Q1: Which surfaces are must-have?

| Option | Description | Selected |
|--------|-------------|----------|
| All surfaces | Cards, checkout, cart, kiosk, admin. Full consistency. | ✓ |
| Cards + checkout only | Main customer-facing views only. | |
| Cards only | Minimum: just product cards. | |

**User's choice:** All surfaces

### Q2: Ingredients too?

| Option | Description | Selected |
|--------|-------------|----------|
| Kit-only for now | Producer visibility is about kit brands. | ✓ |
| Kits and ingredients both | Show manufacturer on everything. | |
| You decide | Let Claude determine. | |

**User's choice:** Kit-only for now

### Q3: Producer filter on catalog page?

| Option | Description | Selected |
|--------|-------------|----------|
| No new filter — brand filter is enough | Customers think in brand lines, not producers. | |
| Add producer filter | New dropdown to filter by manufacturer. | ✓ |
| You decide | Let Claude decide. | |

**User's choice:** Add producer filter

---

## Fallback Behavior

### Q1: What to show when manufacturer is blank?

| Option | Description | Selected |
|--------|-------------|----------|
| Hide the producer line entirely | Card looks like today. No visual noise. | ✓ |
| Show placeholder text | Show "Producer TBD" or default. | |
| Show brand as producer fallback | Promote brand to producer position. | |

**User's choice:** Hide producer section, but still include brand if it exists

### Q2: Admin indicator for missing data?

| Option | Description | Selected |
|--------|-------------|----------|
| Yes — visual indicator in admin | Highlight kits missing manufacturer. | |
| No — manage in Zoho directly | Zoho already shows the field. | ✓ |

**User's choice:** No — manage in Zoho directly

### Q3: Inline format fallback?

| Option | Description | Selected |
|--------|-------------|----------|
| Yes — graceful degradation | If no manufacturer, show just name without prefix. | ✓ |
| Always require manufacturer for inline | Only use inline format when manufacturer present. | |

**User's choice:** Yes — graceful degradation

---

## Claude's Discretion

- Inline separator choice (em dash, pipe, or other)
- Exact CSS for producer line (font-size, color, letter-spacing)
- Producer line position relative to ornament/gold-rule decorative elements
- Producer filter position relative to existing filters
- Test file organization
- Kiosk grid vs list view producer display differences

## Deferred Ideas

None — discussion stayed within phase scope.
