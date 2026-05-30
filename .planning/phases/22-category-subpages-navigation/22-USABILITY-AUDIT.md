# Phase 22 — Usability Audit
**Auditor:** UI/UX agent (Claude Sonnet 4.6)
**Date:** 2026-05-29
**Scope:** Category subpages & navigation feature — interaction design, information architecture, task flows, accessibility, and cognitive load. No visual-style opinion unless it affects usability.

---

## Severity Scale

| Level | Meaning |
|-------|---------|
| BLOCKER | Breaks a core user task or has a concrete accessibility failure that violates WCAG AA. Production push should be held. |
| HIGH | Significant friction, likely to confuse or strand real users. Fix before the next release. |
| MEDIUM | Noticeable friction, degraded experience for a meaningful user segment. Fix in the following sprint. |
| LOW | Minor inconsistency or missed opportunity. Fix when convenient. |

---

## BLOCKER

### B-01 — Hero h1 and desc render blank on initial paint (grains, yeast, additives, packaging, equipment)

**File:** `products/grains.html:98-99`, `products/yeast.html:98-99`, `products/additives.html:98-99`, `products/packaging.html:98-100`, `products/equipment.html:98-100`

The hero `<h1>` and `.subpage-hero-desc` are empty in HTML. They are populated by `16-catalog-subpage.js` on `DOMContentLoaded` (lines 848–850 of the module). The module is loaded with `defer`, which means it runs after parsing completes. On fast connections this is imperceptible, but on slow connections (3G, rural BC is common) or with cold cache the hero section renders completely empty — no heading, no description — for a perceptible interval.

More critically: if JS fails entirely (CSP block, network error, script load failure), the page presents no `<h1>` at all. This is an accessibility failure: WCAG 2.4.6 requires descriptive headings, and a missing h1 leaves screen reader users with no page identity announcement.

**Recommendation:** Move the category name and short description into the HTML at build time. The values are static per page (they live in `SUBPAGE_CONFIG` which is an inline `<script>` block). Populate `<h1>Grains</h1>` and `<p class="subpage-hero-desc">Base malts, specialty grains...</p>` directly in HTML. The JS can still overwrite them if it loads, but the page is never blank.

---

### B-02 — Disabled search button has no visible tooltip or "coming soon" label for sighted users

**File:** `products/grains.html:88`, `products/hops.html:164` (and all 7 subpages)

The search button carries `aria-label="Search ingredients (coming soon)"` which communicates intent to screen reader users. However, sighted users only see a magnifying glass icon at 50% opacity. Without a visible label or tooltip, a sighted user cannot distinguish "this is intentionally disabled and will be available soon" from "this is broken" or "this is a search for this specific page" (confusingly, each page already has a text search input in the toolbar below).

Having two search affordances — one working text search in the toolbar and one non-functional icon in the sub-nav — creates immediate confusion about the difference between them.

**Recommendation:** Add a `title="Search ingredients (coming soon)"` attribute as a browser-native tooltip fallback. Additionally, consider adding a small "Soon" text badge or pill adjacent to the icon, or displaying a toast/popover on hover/focus explaining the upcoming feature. The `disabled` attribute correctly removes it from tab order, but sighted users pointing at it deserve an explanation.

---

### B-03 — Active pill on ingredients-supplies.html uses wrong background color (accent not set, falls back to green)

**File:** `css/catalog-subpage.css:652-662`, `products/ingredients-supplies.html:76`

The CSS active state for the "All" pill is:
```css
body[data-page="ingredients"] .subnav-pill[data-subnav="all"] {
  background: var(--subpage-accent, var(--color-green));
  ...
}
```

`--subpage-accent` is only injected by `applyHeroAccent()` in `16-catalog-subpage.js`. However, `ingredients-supplies.html` does NOT load `16-catalog-subpage.min.js` — it uses the legacy `08-catalog-ingredients.js` renderer via `main.min.js`. Therefore `--subpage-accent` is never set on this page, and the active "All" pill falls back to `var(--color-green)` — which is visually fine but inconsistently different from the per-category accent colors on the other 6 pages.

More importantly: because `ingredients-supplies.html` also does not define a `SUBPAGE_CONFIG` at all, any future code that guards on `SUBPAGE_CONFIG` existing before setting `--subpage-accent` will silently do nothing on this page. The divergent rendering pipeline for the "All" page creates a structural inconsistency that is a maintenance risk.

**Recommendation:** This is acceptable for Phase 22 if the visual result (green active pill) is intentional. The BLOCKER concern is that future engineers may not realize this page bypasses the standard pipeline. Add a comment in `ingredients-supplies.html` above the subnav block explicitly noting that this page does not load `16-catalog-subpage.js` and the accent color fallback is intentional.

---

## HIGH

### H-01 — "Read more" toggle has no aria-expanded and no aria-controls

**File:** `js/modules/16-catalog-subpage.js:854-872`, `products/grains.html:100-101`

The hero "Read more" button toggles visibility of `.subpage-hero-full` but never sets `aria-expanded` (true/false) or `aria-controls` pointing to the controlled element. Screen reader users cannot know whether the expanded section is currently open or closed.

**Recommendation:**
1. Add `aria-expanded="false"` to the `<button class="subpage-hero-toggle">` in HTML.
2. Add `id="hero-full-desc"` to `.subpage-hero-full`.
3. Add `aria-controls="hero-full-desc"` to the button.
4. In the JS toggle handler (lines 858–870), call `heroToggle.setAttribute('aria-expanded', isOpen ? 'false' : 'true')` on each toggle.

---

### H-02 — Products dropdown has no keyboard arrow-key navigation

**File:** `js/modules/13-init.js:176-188`, `css/styles.css:487-489`

The Products dropdown opens on `:hover` and `:focus-within` (CSS) and on click for mobile (JS). Keyboard users can Tab into it and the items are accessible. However, there is no arrow-key navigation: pressing Down from the "Products" link does not move focus into the dropdown items — the user must Tab through every item. On a menu with 9 items (2 + divider + 7 ingredient links), this requires 9 Tab presses to get past the dropdown, and there is no way to close the dropdown with Escape while focused inside it (the existing Escape handler only closes the mobile nav overlay, not the desktop dropdown).

**Recommendation:**
- Add a `keydown` handler on `.nav-dropdown-menu` that responds to ArrowDown/ArrowUp to move focus between `a` elements, and Escape to close the dropdown and return focus to the "Products" `<a>` trigger.
- If that is out of scope for Phase 22, at minimum document this as a known gap in the audit so it is not forgotten.

---

### H-03 — Card expand chevron (::after pseudo-element) is the only affordance signaling clickability — no hover cursor on the text

**File:** `css/catalog-subpage.css:271-286`, `js/modules/16-catalog-subpage.js:599-613`

The entire `.subpage-card` element is clickable (click handler on the card div), but the cursor is set to `pointer` only via `.product-card.subpage-card { cursor: pointer }` at line 248. The small downward-pointing chevron (▾) at the top-right is the only visual cue that the card is expandable. At 0.75rem and 50% opacity it is low-contrast and easily missed. First-time users have no clear signal that clicking the card body (rather than the "Add to Cart" button) reveals more detail.

This is especially confusing on mobile: the accordion behavior (expand in-card) is a different pattern than the desktop behavior (full-width row below), but there is nothing in the card UI that previews either pattern.

**Recommendation:**
- Increase the chevron opacity to at least 0.7 (currently 0.5) and size to 1rem.
- Add a short text hint such as "Details" or a visible "expand" label adjacent to the chevron.
- Alternatively, add a dedicated "View details" button or link so the expand affordance is unambiguous and separate from the Add to Cart button area.

---

### H-04 — Weight stepper on card uses `renderReserveControl` (not `renderWeightControl`) — slider UX is only in the detail panel

**File:** `js/modules/16-catalog-subpage.js:591-596`

At lines 591-596 in `buildItemCard()`:
```js
reserveWrap._reserveRenderer = renderReserveControl;
renderReserveControl(reserveWrap, cartObj, productKey);
```

This is hardcoded to `renderReserveControl` for cards, not `renderWeightControl`. So for a weight-based grain product (unit="kg"), clicking "Add to Cart" on the card adds the item at the minimum weight (0.01 kg) without showing the slider. The full slider only appears if the user opens the detail panel.

A user who adds a grain from the card and then goes to checkout may be surprised to find 0.01 kg of grain in their cart. The `hasMinQtyIngredients()` guard and the confirmation overlay (in `12-checkout.js`) exist to catch this, but they are a recovery mechanism for a preventable UX failure.

**Recommendation:** For weight items, render `renderWeightControl` (the full slider) on the card instead of `renderReserveControl`. If the slider is too large for the card layout, use `renderWeightControlCompact` — which exists precisely for this use case (compact slider + action row).

---

### H-05 — Empty state body copy diverges from UI-SPEC

**File:** `js/modules/16-catalog-subpage.js:356-368`

The UI-SPEC (22-UI-SPEC.md) specifies:
- Heading: "No items currently available"
- Body: "Check back soon or browse another category."

The actual implementation in `renderEmptyState()`:
- Heading (class `catalog-no-results`): "No [categoryName] are currently available." — differs from spec.
- Body (class `catalog-no-results-sub`): "Check back soon or contact us if you need something specific." — differs from spec.

The implemented copy is arguably better (more actionable), but the divergence from spec is worth flagging for review and sign-off.

More importantly, the empty state has no navigation links to other categories. A user who lands on Additives and finds zero items is presented with text only — no link to "All Ingredients" or adjacent categories. This is a dead end.

**Recommendation:** Add at least one link in the empty state, e.g., "Browse all ingredients" pointing to `ingredients-supplies.html`, or render mini pills linking to adjacent categories. The empty state should never be a dead end.

---

### H-06 — "Products" dropdown link goes to ferment-in-store.html, not a Products landing page

**File:** `products/grains.html:55`, all 7 subpages

The "Products" label in the main nav is an `<a href="ferment-in-store.html">` — clicking it navigates away from the ingredient subpages to the ferment kits page. A user on the Grains page who clicks "Products" expecting a products overview will land on Ferment in Store, which has no ingredients. The dropdown is the only way to reach other product categories, and it requires hover/click to reveal.

This predates Phase 22 but is significantly more confusing now that there are 7 ingredient pages that surface "Products" in the nav. The "Ferment in Store" label within the dropdown (first item) is redundant with the nav link's destination, which further muddies the information architecture.

**Recommendation:** Change the "Products" nav link destination to a neutral products overview (or `ingredients-supplies.html` as the most visited products page), or make "Products" a non-clickable trigger (button element) that only opens the dropdown. This is a higher-scope IA change than Phase 22 should necessarily address, but it should be tracked.

---

## MEDIUM

### M-01 — Sub-nav sticky offset assumes header is always visible — no guard for cases where it is hidden or smaller

**File:** `css/catalog-subpage.css:597-600`

```css
.ingredient-subnav {
  top: var(--header-height, 80px);
}
```

The `--header-height` CSS variable is set by a ResizeObserver in `13-init.js`. If the header hides on scroll (e.g., if a hide-on-scroll behavior is added in a future phase), the sub-nav will remain positioned at the wrong offset. The current fallback of 80px is hardcoded and will look wrong on any device where the header height differs from that value before the ResizeObserver fires (notably, the first paint frame).

This is a medium-severity issue rather than a blocker because the 80px fallback is close to the actual header height, and the ResizeObserver corrects it quickly. But on first load on a slow device the sub-nav may visually overlap the header briefly.

**Recommendation:** Use `top: calc(var(--header-height, 0px) + 0px)` and have the ResizeObserver set the variable as soon as possible — preferably synchronously in the `<head>` via an inline style on `:root`, not relying on `DOMContentLoaded`.

---

### M-02 — Mobile: horizontal pill scroll gives no visual indication that more pills exist off-screen

**File:** `css/catalog-subpage.css:611-619`

The `.subnav-pills` container scrolls horizontally with `scrollbar-width: none` (hidden scrollbar). On a narrow viewport (375px iPhone SE), the last 1-2 pills (Packaging, Equipment) are partially or fully off-screen with no gradient, shadow, or scroll cue visible. The disabled search button sits at `margin-left: auto`, pushing it to the far right — this potentially compresses the pill scroll area further and pushes the rightmost pills into hidden territory.

**Recommendation:** Add a right-edge fade gradient using a pseudo-element on `.subnav-pills` container, or on `.ingredient-subnav .container`, to signal that more content is scrollable:
```css
.subnav-pills::after {
  content: '';
  position: sticky;
  right: 0;
  width: 2rem;
  background: linear-gradient(to left, var(--color-cream), transparent);
  pointer-events: none;
}
```

---

### M-03 — "All Ingredients" is ambiguous — the page shows grains, hops, yeast, additives, AND packaging/equipment (not just food ingredients)

**File:** `products/ingredients-supplies.html`, all subnav HTML blocks

The "All" pill and dropdown link both read "All Ingredients." The page includes equipment (fermenters, hoses, tubing) and packaging (bottles, bags, closures) — items most users would not classify as "ingredients." The label mismatch may cause confusion when a user looking for equipment chooses to skip the "All Ingredients" overview, expecting it to be irrelevant to their search.

**Recommendation:** Rename the pill and dropdown link to "All Supplies" or "All Products" to accurately reflect the full catalog scope. This should be coordinated with the existing page title "Ingredients & Supplies" which already acknowledges the broader scope.

---

### M-04 — Cart drawer title says "Your Cart" for ingredient items but checkout link says "reservation.html"

**File:** `js/modules/11-cart.js:1066`, `products/grains.html:143`

On the ingredient subpages, the cart drawer title is dynamically set to "Your Reservation" only when all items are ferment kits (`allKits`). For ingredient-only carts the title is "Your Cart." However, the checkout link href always goes to `reservation.html` (with or without `?cart=ingredient`). The URL slug "reservation" implies a service booking, not a purchase.

This is a labeling inconsistency: the cart calls itself "Your Cart" (purchase framing) but sends users to "reservation.html" (booking framing). A user purchasing grains may hesitate at the URL or page heading that says "Reservation" when they expect an e-commerce checkout.

**Recommendation:** This is a known debt from the kits-first origin of the site. For Phase 22, at minimum ensure the checkout link label reads "Checkout" (it does) rather than "Reserve" or "Go to Reservation." Long-term, the checkout page slug should be changed or aliased.

---

### M-05 — "Read more" toggle in hero is visible even when heroDescriptionFull is empty or identical to heroDescription

**File:** `products/grains.html:100`, `js/modules/16-catalog-subpage.js:854-872`

The "Read more" `<button>` is always visible in the HTML, even before JS loads and regardless of whether `heroDescriptionFull` has meaningful additional content. For Grains, the full description adds location context (Squamish, BC) and pickup info — genuinely useful. But if a future category has no extended copy in `heroDescriptionFull`, the "Read more" button will appear, the user will click it, and nothing meaningful will render (the `heroFull` content is only populated on first click).

**Recommendation:** In the `DOMContentLoaded` handler, hide the toggle button if `SUBPAGE_CONFIG.heroDescriptionFull` is falsy or identical to `heroDescription`:
```js
if (!SUBPAGE_CONFIG.heroDescriptionFull || 
    SUBPAGE_CONFIG.heroDescriptionFull === SUBPAGE_CONFIG.heroDescription) {
  if (heroToggle) heroToggle.hidden = true;
}
```

---

### M-06 — hops.html is missing `class="subpage-catalog"` on body — cart drawer CSS overrides do not apply

**File:** `products/hops.html:77`

```html
<body data-page="hops">
```

All five new subpages have `class="subpage-catalog"` on the body (e.g., `products/grains.html:29`). The catalog-subpage.css cart drawer overrides are scoped to `body.subpage-catalog .cart-drawer` (lines 750-833). On `hops.html`, these overrides do not apply, so the cart drawer may render with the wrong styles (wrong width, incorrect slide animation, missing header border treatment).

**Recommendation:** Add `class="subpage-catalog"` to the body of `hops.html` to match the other 6 pages:
```html
<body class="subpage-catalog" data-page="hops">
```

---

### M-07 — Additives accent color in yeast.html SUBPAGE_CONFIG does not match UI-SPEC

**File:** `products/yeast.html:183`

The UI-SPEC (22-UI-SPEC.md) specifies:
- Additives: `#6b5a9e` (muted purple)

The `yeast.html` SUBPAGE_CONFIG sets:
```js
accentColor: '#7b5ea7',
```

And `additives.html` SUBPAGE_CONFIG sets:
```js
accentColor: '#c47a2a',
```

The Additives page uses `#c47a2a` (a warm amber/orange), not the specified purple `#6b5a9e`. The Yeast page uses `#7b5ea7` (a purple) which is closer to the specified Additives color. The Grains accent `#8b6f3a` matches spec.

This appears to be a spec/implementation mismatch: the purple was specified for Additives but was applied to Yeast, while Additives got a warm orange with no spec reference. The implication for usability is that the color-coding system loses semantic meaning if colors are swapped across categories.

**Recommendation:** Reconcile the accent colors with the UI-SPEC. Confirm which colors are intentional and update either the spec or the HTML files to match. A user switching between Yeast and Additives will see a purple → warm orange change; the orange does not convey "chemical/adjunct" as intended.

---

### M-08 — Toolbar search input type="text" instead of type="search" — loses mobile "Search" keyboard and browser clear affordance

**File:** `products/grains.html:108`, `products/yeast.html:108`, and all 5 new subpages

All subpage search inputs use `<input type="text">`. Using `type="search"` would provide:
- Mobile: "Search" action key on iOS/Android keyboards
- Desktop Chrome/Safari: a native clear (×) button when text is present
- Browser-level semantic hinting for autocomplete suppression

**Recommendation:** Change all subpage search inputs to `type="search"`. The CSS styles already cover both `input[type="search"]` and `input[type="text"]` (catalog-subpage.css:103-115).

---

### M-09 — Detail panel closes silently on viewport resize to mobile — user loses their state with no feedback

**File:** `js/modules/16-catalog-subpage.js:930-934`

```js
window.matchMedia('(max-width: 767px)').addEventListener('change', function () {
  closeDetailPanel();
});
```

If a user has a product detail panel open on desktop and resizes the browser to mobile width, the panel silently disappears. No toast, no accordion replacement, no focus management. The user's browsing context is lost.

**Recommendation:** After `closeDetailPanel()`, open the mobile accordion for the same card if possible, or at minimum return focus to the card that was open. If silent close is acceptable, that is fine for now, but this is a UX regression under responsive testing.

---

## LOW

### L-01 — "All" pill in sub-nav is labeled "All" not "All Ingredients" — inconsistent with dropdown label

**File:** `products/grains.html:80`, all 7 subnav blocks

The sub-nav pill reads "All" while the Products dropdown link reads "All Ingredients." These two affordances navigate to the same page (`ingredients-supplies.html`) but use different labels. Users scanning both navigation systems may not immediately understand they are the same destination.

**Recommendation:** Label the pill "All Ingredients" or both labels "All" for consistency. Given the compact pill width, "All" is reasonable — but then the dropdown should also say "All."

---

### L-02 — No `aria-current="page"` on active subnav pill

**File:** `css/catalog-subpage.css:651-662`

The UI-SPEC notes: "Active pill — CSS active state is visually clear (filled green); no `aria-current` attribute needed since navigation is page-load not AJAX."

This reasoning is debatable. `aria-current="page"` is the correct semantic for a navigation link that points to the current page, regardless of whether navigation is AJAX or page-load. Without it, screen reader users hear a list of 7 navigation links with no indication of which one represents the current page — the visual fill color is not communicated.

WCAG 2.4.1 (Bypass Blocks, Level A) and best practices from APG strongly recommend `aria-current="page"` on the current page's nav link.

**Recommendation:** Add `aria-current="page"` to the active pill. Since the pills are static HTML (not JS-managed), this needs to be set directly in each HTML file on the correct `<a>` element. The CSS active state is still driven by the `body[data-page]` selector (no change needed there).

For example, in `products/grains.html`:
```html
<a href="grains.html" class="subnav-pill" data-subnav="grains" aria-current="page">Grains</a>
```

---

### L-03 — `nav-dropdown-indent` items have smaller font-size but no visual left-border or grouping marker beyond indentation

**File:** `css/styles.css:482-485`

```css
.nav-dropdown-menu .nav-dropdown-indent a {
  padding-left: 2rem;
  font-size: 0.9em;
}
```

The 7 ingredient links in the dropdown are indented and smaller, which signals sub-category. However, there is no visible group label or divider between "All Ingredients" and its sub-categories (Hops, Grains, etc.). A user might not understand that "All Ingredients" is a parent of the 6 below it — it just looks like 7 separate links.

**Recommendation:** Consider adding a non-interactive group header `<li>` with text "Ingredient Categories" styled as a label, or a left border on the indented items to visually connect them. At minimum, the divider between the two groups (ferment/labels vs. ingredients) is good; the sub-grouping within ingredients could be clearer.

---

### L-04 — Cart FAB count includes weight items as "1" but user may expect kg or g quantity shown

**File:** `js/modules/16-catalog-subpage.js:962-964`

```js
count += (typeof isWeightUnit === 'function' && isWeightUnit(item.unit)) ? 1 : (parseFloat(item.qty) || 1);
```

Weight items (grains in kg/g) are counted as 1 item in the FAB badge regardless of quantity. A user who adds 2 kg of grain and 500 g of another grain sees "2" in the FAB. This is consistent with "2 line items" but inconsistent with the product card, which shows the actual weight (e.g., "2.00 kg"). The inconsistency is low-friction but could cause confusion.

**Recommendation:** This behavior is acceptable and keeps the badge simple. Add a note in code comments explaining the intentional "1 per line item" logic for weight items so future developers do not inadvertently change it.

---

### L-05 — Hops subpage loads `hops.min.css` AND `catalog-subpage.min.css` — potential style conflicts

**File:** `products/hops.html:73-75`

```html
<link rel="stylesheet" href="../css/styles.min.css?v=mprvu1q1">
<link rel="stylesheet" href="../css/hops.min.css?v=mprvu1q1">
<link rel="stylesheet" href="../css/catalog-subpage.min.css?v=mprvu1q1">
```

`catalog-subpage.css` was added to `hops.html` in Phase 22 (the sub-nav CSS lives there). This is correct. However, `catalog-subpage.css` also defines `.product-card`, `.product-price`, `.stock-badge`, etc. — rules that may conflict with or be overridden by `hops.css`. Load order means `catalog-subpage.css` rules come last and will win specificity ties. This may or may not cause visible conflicts depending on how `hops.css` styles those selectors.

**Recommendation:** Audit the selectors in `hops.css` vs. `catalog-subpage.css` for conflicts. The sub-nav CSS should eventually be extracted into its own `subnav.css` file to avoid coupling it to the broader subpage catalog styles.

---

### L-06 — Error state copy in module does not match UI-SPEC

**File:** `js/modules/16-catalog-subpage.js:336`

Module implementation: `"Could not load products. Please try again."`
UI-SPEC specifies: `"Could not load products. Try refreshing or check back later."`

The actual copy is more concise but omits the alternative action ("check back later") which is useful when the failure is not recoverable by retrying.

**Recommendation:** Update the error message to match the spec: `"Could not load products. Try refreshing or check back later."` This is a one-line text change in `showError()`.

---

### L-07 — Sort select has no visible label — relies on aria-label only

**File:** `products/grains.html:109-116`

```html
<select id="subpage-sort" aria-label="Sort grains">
```

The sort control has an `aria-label` but no visible `<label>` element. Sighted users relying on pointing devices are expected to understand from context ("In Stock First" as the first option, followed by "Name (A-Z)", etc.) that this is a sort control. In the toolbar context this is usually acceptable. However, for users with low vision who do not use a screen reader, there is no visible label text.

**Recommendation:** Add a short visible label "Sort:" before the select element (matching the pattern in `ingredients-supplies.html:187` where `<label for="ingredient-sort" class="catalog-filter-label">Sort:</label>` is used). This is already done consistently in the old ingredients page.

---

### L-08 — View toggle buttons say "Grid" / "List" as text but hops uses SVG icons — inconsistent within the same navigation ecosystem

**File:** `products/grains.html:117-119`, `products/hops.html:199-204`

The 5 new category subpages use text labels ("Grid", "List") in the view toggle buttons. The hops page uses SVG icons (grid icon and list icon) for the same toggle. The ingredients-supplies.html page also uses SVG icons. Within the same sub-navigation family, the view toggle has two different interaction patterns.

**Recommendation:** Standardize on SVG icons with aria-labels (matching hops.html) across all subpages. This aligns with the existing design system pattern established by Phase 20/21 and reduces cognitive inconsistency.

---

## Cross-Cutting Observations

### Navigation Redundancy — Sub-nav vs. Dropdown

The "All Ingredients / Hops / Grains / Yeast / Additives / Packaging / Equipment" structure appears in two places: the Products dropdown and the sub-nav pills. This redundancy is intentional (the dropdown is global site nav; the sub-nav is context nav for the ingredient section) and is a well-established pattern (e.g., Amazon's left rail + top nav). The risk is that users may find the sub-nav easier but never discover the dropdown, or vice versa. Given the site's small audience this is low risk.

The "All Ingredients" link in the dropdown pointing to the same destination as the "All" pill is correct. The only confusion risk is naming consistency (see L-01).

### Cognitive Load — Weight Item Interaction Pattern

The weight stepper is the most cognitively demanding interaction in this phase. A user buying grains encounters:
1. An "Add to Cart" button on the card (adds at 0.01 kg minimum without warning)
2. A detail panel with a slider + exact input + update button
3. A compact stepper in the cart drawer

These three representations of the same quantity-adjustment task have different affordances: button → slider + numeric input + "Update Cart" button → −/input/+. The transition from the card "Add to Cart" to the detail panel slider is especially jarring because clicking "Add to Cart" commits the minimum quantity silently, then the detail panel reveals the full control.

This is the interaction area most likely to generate customer support questions ("I accidentally added 0.01 kg, how do I change it?"). The min-qty confirmation overlay at checkout (in 12-checkout.js) is a recovery mechanism, but prevention is better. **See H-04 for the recommended fix.**

### Hops Page Structural Divergence

The hops page uses `15-hops.js` (custom module) and presents a different product card design (radar charts, comparison mode) from the 5 new subpages (`16-catalog-subpage.js` cards). A user who browses Hops first and then switches to Grains via the sub-nav will encounter a completely different visual layout and interaction paradigm. This divergence is a known and intentional decision (D-09 in CONTEXT.md), but it is worth monitoring in user testing.

---

## Blockers Summary for Production Decision

| ID | Issue | Block Reason |
|----|-------|-------------|
| B-01 | Hero h1 blank until JS loads | Accessibility failure (missing h1) + poor first paint |
| B-02 | Disabled search button unexplained to sighted users | Perceived breakage; two competing search affordances |
| B-03 | Accent not set on ingredients-supplies.html | Structural debt; must be documented before ship |

**Recommendation:** B-01 and B-02 should be resolved before production push. B-03 is acceptable to ship with an inline documentation comment; it does not break the user experience.
