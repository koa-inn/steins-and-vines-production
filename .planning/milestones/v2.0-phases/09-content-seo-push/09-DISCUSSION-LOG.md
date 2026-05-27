# Phase 9: Content & SEO Push - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-04
**Phase:** 9-Content & SEO Push
**Areas discussed:** Landing page copy, Facility photos, Google Reviews, Testimonial display

---

## Landing Page Copy

### Q1: Where should the SEO landing copy live?

| Option | Description | Selected |
|--------|-------------|----------|
| Content JSON | Add rich copy to content/products.json — loaded dynamically, easy to update | |
| Inline HTML | Write copy directly into landing page HTML — better for SEO crawlability | |
| You decide | Claude picks the approach that best balances SEO and maintainability | ✓ |

**User's choice:** You decide
**Notes:** None

### Q2: How much content per page?

| Option | Description | Selected |
|--------|-------------|----------|
| Light (1-2 paragraphs) | Brief intro + value prop above the product grid | |
| Medium (3-5 sections) | Intro, what you get, how it works, FAQ or benefits | |
| Rich (full landing page) | Multiple sections with headings, standalone ranking page | |

**User's choice:** "I have a content doc for this"
**Notes:** User pasted a complete landing page copy document with two full pages of SEO-targeted content. Copy is compliance-reviewed against BC UBrew/UVin Licence Terms, CRTC Code for Broadcast Advertising of Alcoholic Beverages, and BC Liquor Control and Licensing Regulation. Includes target keywords, compliance notes, and items to watch. Copy should be used verbatim.

### Q3: Copy placement — landing pages only or also products.html?

| Option | Description | Selected |
|--------|-------------|----------|
| Landing pages only | Full copy in ferment-in-store.html and ingredients-supplies.html only | |
| Both places | Full copy on landing pages + condensed intro on products.html | |
| You decide | Claude picks for SEO + UX balance | ✓ |

**User's choice:** You decide
**Notes:** None

### Q4: Contact block at bottom of landing pages?

| Option | Description | Selected |
|--------|-------------|----------|
| Styled block | Visually distinct CTA section with address, hours, phone, and button | |
| Inline text | Plain text address/hours/phone at end of copy | |
| You decide | Claude picks based on conversion | |

**User's choice:** "Don't worry about this, we have that info in the footer/header and about page"
**Notes:** Skip the placeholder contact block entirely — info already accessible site-wide.

---

## Facility Photos

### Q1: Photo availability

| Option | Description | Selected |
|--------|-------------|----------|
| Photos ready | Actual photos available before phase ships | ✓ |
| Placeholder plan | Layout/slots now, swap real photos later | |
| Skip photos for now | Remove SEO-02, handle in future phase | |

**User's choice:** Photos ready
**Notes:** None

### Q2: Where should photos appear?

| Option | Description | Selected |
|--------|-------------|----------|
| Landing pages | Inline with SEO copy on landing pages | ✓ |
| Homepage | Replace/supplement existing hero/section imagery | ✓ |
| About page | Add facility/team photos to about.html | ✓ |
| Product grid area | Photos near product grid on products.html | |

**User's choice:** Landing pages, Homepage, About page (multi-select)
**Notes:** None

### Q3: How will photos be provided?

| Option | Description | Selected |
|--------|-------------|----------|
| Drop in images/ folder | Add files directly to images/ directory | ✓ |
| Google Drive link | Share Drive folder, Claude downloads/optimizes | |
| You decide | Claude picks convention, user drops files | |

**User's choice:** Drop in images/ folder
**Notes:** None

### Q4: Photo sizing/format preferences?

| Option | Description | Selected |
|--------|-------------|----------|
| You decide | Claude picks sizes, WebP/JPEG, responsive srcset | ✓ |
| Keep it simple | Optimized JPEGs at 1200px max, match existing pattern | |

**User's choice:** You decide
**Notes:** None

---

## Google Reviews

### Q1: How should reviews be sourced?

| Option | Description | Selected |
|--------|-------------|----------|
| Manual curation | Hand-pick reviews, store in content JSON | ✓ |
| Google Places API | Fetch dynamically, always up-to-date, 5 review limit | |
| Embed widget | Third-party widget, least dev work, external dependency | |

**User's choice:** Manual curation
**Notes:** None

### Q2: How many reviews?

| Option | Description | Selected |
|--------|-------------|----------|
| 3 reviews | Compact, fits single row of cards | ✓ |
| 5-6 reviews | Two rows or scrollable, more voices | |
| You decide | Claude picks for layout | |

**User's choice:** 3 reviews
**Notes:** None

### Q3: Where should reviews appear?

| Option | Description | Selected |
|--------|-------------|----------|
| Homepage | Testimonials section on homepage | ✓ |
| Ferment landing page | On ferment-in-store.html alongside SEO copy | |
| About page | Social proof with business story | |
| All public pages | Shared testimonial strip site-wide | |

**User's choice:** Homepage only
**Notes:** None

### Q4: Link back to original review?

| Option | Description | Selected |
|--------|-------------|----------|
| Link to Google profile | Each card links to Google Business Profile reviews page | ✓ |
| Screenshot proof | Link to profile + note reviewer name for verification | |
| You decide | Claude picks most trustworthy approach | |

**User's choice:** Link to Google profile
**Notes:** Google doesn't provide direct links to individual reviews, so linking to the reviews collection page is the standard approach.

---

## Testimonial Display

### Q1: Visual treatment?

| Option | Description | Selected |
|--------|-------------|----------|
| Static cards row | Three side-by-side cards, stack on mobile | ✓ |
| Carousel/slider | One at a time with arrows/auto-rotate | |
| Featured quote | One large hero testimonial + smaller supporting quotes | |

**User's choice:** Static cards row
**Notes:** User selected after viewing ASCII preview mockups.

### Q2: Section header style?

| Option | Description | Selected |
|--------|-------------|----------|
| Heading + Google badge | Title + small Google Reviews badge with aggregate rating | |
| Heading only | Clean section heading, no Google branding | ✓ |
| You decide | Claude picks most trustworthy look | |

**User's choice:** Heading only
**Notes:** The "View on Google" link per card provides enough credibility without a badge.

### Q3: Position on homepage?

| Option | Description | Selected |
|--------|-------------|----------|
| After 'Why Make Wine' | After the value prop section — reinforces the pitch | ✓ |
| Near the bottom | Just above footer as final trust signal | |
| You decide | Claude picks best conversion position | |

**User's choice:** After 'Why Make Wine'
**Notes:** None

### Q4: Review data storage?

| Option | Description | Selected |
|--------|-------------|----------|
| In home.json | Add testimonials array to existing home.json | |
| Separate reviews.json | New content/reviews.json, easier independent updates | |
| You decide | Claude picks based on maintainability | ✓ |

**User's choice:** You decide
**Notes:** None

---

## Claude's Discretion

- Technical placement of landing page copy (inline HTML vs content JSON)
- Whether condensed intro also appears on products.html
- Photo sizing, format, optimization approach
- Photo subfolder convention in images/
- Review data location (home.json vs reviews.json)
- Testimonial card styling details
- Photo layout/placement within each page

## Deferred Ideas

None — discussion stayed within phase scope.
