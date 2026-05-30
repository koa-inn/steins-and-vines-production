# Phase 22 — Mobile / Responsive Audit

> Audit of the ingredient category subpages & navigation feature on phones/tablets.
> Source files only (no minified output reviewed). Breakpoints evaluated: 320, 360, 375, 414, 768px.
> Audit date: 2026-05-29. No code was modified.

## Scope reviewed
- `products/*.html` (7 subpages) — sub-nav + Products dropdown markup
- `css/catalog-subpage.css` — sub-nav, hero, product grid, cart drawer overrides
- `css/hops.css` — hops list/table view, `.hops-table-wrap`
- `css/styles.css` — nav dropdown, mobile nav, reservation qty controls, cart-drawer weight steppers
- `js/modules/16-catalog-subpage.js`, `15-hops.js`, `11-cart.js`, `12-checkout.js` — responsive markup

---

## BLOCKER

### B1 — Mobile nav menu has no max-height/scroll; 10-item Products dropdown can overflow viewport
- **File:** `css/styles.css:6736-6760` (`.nav-list` mobile rule) + dropdown open logic `js/modules/13-init.js:177-188`
- **Breakpoint:** ≤768px, worst at 320–375px and in landscape (short viewport height)
- **Problem:** On mobile the hamburger menu `.nav-list` is `position: fixed; top: var(--header-height,80px)` with **no `max-height` and no `overflow-y`**. Tapping "Products" expands the dropdown to 10 links (Ferment in Store, Custom Labels, divider, All Ingredients, Hops, Grains, Yeast, Additives, Packaging, Equipment) inside this already-fixed panel. Each mobile dropdown link is `min-height: 40px` (`styles.css:519`) plus the 4 top-level links at 44px+. Total expanded height ≈ 4×44 + 10×40 ≈ 576px of menu content below an 80px header. On a 320×568 (iPhone SE) or any phone in landscape, the bottom dropdown items (Packaging, Equipment) render **below the fold with no way to scroll the menu** — they are unreachable. This directly breaks the headline navigation feature of the phase on the smallest, most common phones.
- **Fix:** Add to the `≤768px` `.nav-list` rule: `max-height: calc(100dvh - var(--header-height, 80px)); overflow-y: auto; -webkit-overflow-scrolling: touch;`. Use `100dvh` (with a `100vh` fallback) so iOS dynamic toolbars don't cut it off. Verify the backdrop still covers the scrolled menu.

---

## HIGH

### H1 — Stacked hops table data-labels are cream-on-cream (invisible) at ≤640px
- **File:** `css/hops.css:948-958` (`.hops-table td::before`) vs panel background `css/hops.css:851` (`.hops-table-wrap { background: var(--color-cream) }`)
- **Breakpoint:** ≤640px (320–414px primary)
- **Problem:** At ≤640px the hops table collapses to a stacked block layout where each cell shows its field name via `td::before { content: attr(data-label) }`. That label color is `rgba(229,222,193,0.5)` — i.e. **`--color-cream` at 50% opacity**. The surrounding `.hops-table-wrap` panel is solid `--color-cream`. The labels are therefore nearly invisible (cream on cream). The color was evidently chosen for the dark "foil" page background, but the list view sits inside the cream panel, not on the foil. On phones the entire hops list loses its "Alpha Acid / Flavour / Origin / Price" field labels, leaving an ambiguous column of values.
- **Fix:** In the `≤640px` block, set the stacked `td::before` color to a dark token, e.g. `color: var(--color-muted, #5f5f5f)` or `var(--color-burgundy)` (matches the table header color used elsewhere). Confirm contrast ≥4.5:1 against cream.

### H2 — Sub-nav pills are 36px tall — below the 44px touch-target minimum the spec's own a11y rule promises
- **File:** `css/catalog-subpage.css:629` (`.subnav-pill { min-height: 36px }`), search btn `:670` (36px)
- **Breakpoint:** all phone widths (320–414px)
- **Problem:** The UI-SPEC (line 49, "Touch targets on mobile: 44px minimum enforced by existing global mobile rule") asserts a 44px floor, but no such global rule applies to `.subnav-pill` — its computed height stays 36px on mobile. The horizontally-scrolling pill row is the primary category-switching control of the whole feature; 36px is under WCAG 2.5.5 AAA (44px) and Apple HIG (44pt). Combined with horizontal scroll (where a slightly-off tap scrolls instead of navigating) the small target is more error-prone than usual. Pills are also tightly packed (`gap: 8px`), so adjacent-target spacing doesn't compensate.
- **Fix:** Add a mobile rule bumping `.subnav-pill` and `.subnav-search-btn` to `min-height: 44px` (keep padding `8px 16px`; increase to `10px 16px` if needed for visual balance). Verify the sub-nav bar's `padding: 0.5rem 0` plus 44px pills still doesn't eat excessive vertical space below the sticky header.

### H3 — Sticky header (80px) + sticky sub-nav stack consumes a large share of small viewports
- **File:** `css/catalog-subpage.css:596-603` (`.ingredient-subnav` sticky at `top: var(--header-height,80px)`)
- **Breakpoint:** ≤480px, acute in landscape
- **Problem:** The header is 80px and the sub-nav (`0.5rem` padding top/bottom + ~36–44px pills) adds ≈52–60px, both sticky. That is ≈132–140px of permanently-pinned chrome. On a 320×568 portrait phone that's ~24% of the viewport; in landscape (e.g. 667×375) it eats ~37% of the height, leaving very little room for the product grid. There's no media query that reduces header or sub-nav height, nor that un-sticks the sub-nav on very short viewports.
- **Fix:** Consider tightening sub-nav vertical padding on `≤480px` and/or releasing `position: sticky` on landscape short viewports via `@media (max-height: 480px)`. At minimum confirm no overlap/jank when both sticky bars are pinned and the page is scrolled (the `--header-height` ResizeObserver fallback of 80px should be validated against the real rendered header height on mobile, where the header may wrap taller).

---

## MEDIUM

### M1 — Cart-drawer weight stepper input is 13px → iOS Safari auto-zoom on focus
- **File:** `css/styles.css:5766-5780` (`.cart-sidebar-item-controls .product-qty-controls--weight .qty-input { font-size: 0.8125rem }`)
- **Breakpoint:** all iOS phones (320–414px)
- **Problem:** The weight qty input inside the cart drawer is `0.8125rem` = 13px. iOS Safari auto-zooms the page whenever a focused text input has `font-size < 16px`, then does not zoom back out — a classic mobile annoyance. The base `.qty-input` (styles.css:2998) and `.weight-control-input` (6027) correctly use 16px with explicit comments about this, but the cart-drawer override drops below the threshold. Same issue, slightly less severe, on the reservation-table input at `0.95rem`/15.2px (`styles.css:2960`).
- **Fix:** Raise the cart-drawer weight `.qty-input` and the reservation-table `.qty-input` to `font-size: 16px` on touch viewports (a `≤768px` override is enough; desktop can keep the compact size). The element is editable (`type="text"`, `inputmode="decimal"`), so the zoom trigger is real.

### M2 — Cart-drawer weight stepper buttons are 26px — hard thumb targets
- **File:** `css/styles.css:5741-5745` (`.cart-sidebar-item-controls .qty-btn { width:26px; height:26px }`)
- **Breakpoint:** all phones
- **Problem:** The −/+ buttons in the cart drawer are 26×26px. The product-card stepper uses 38px and the reservation table bumps to 40px on mobile (`styles.css:6914-6919`), but the cart-drawer stepper has no mobile enlargement, leaving 26px taps for adjusting weights to two decimals. Easy to mis-tap, especially adjacent to the editable input.
- **Fix:** Add a `≤768px` rule raising `.cart-sidebar-item-controls .qty-btn` to ~40px (mirroring the reservation-table mobile branch). Re-check that the `qty-value-group { width: 58px }` + two 40px buttons + unit label still fits the 380px / 90vw drawer width.

### M3 — Hops table at 641–768px relies solely on horizontal scroll; 6 columns + 110px cart cell overflow narrow tablets
- **File:** `css/hops.css:850-932` (`.hops-table-wrap { overflow-x: auto }`, `.product-reserve-wrap { min-width: 110px }`); stacked layout only kicks in `≤640px` (`:933`)
- **Breakpoint:** 641–768px (small tablets, large phones in landscape)
- **Problem:** The mobile-friendly stacked card layout is gated at `≤640px`. Between 641px and 768px the table stays a 6-column grid (Name, Alpha Acid, Flavour, Origin, Price, Cart) with a 110px-min cart column and `white-space: nowrap` headers. On a ~700px landscape phone the table will horizontally scroll inside `.hops-table-wrap`. Horizontal scroll is contained (good — no page-level overflow), but it's an awkward read and the scroll affordance is just the panel edge. The 640 vs 768 mismatch means the most common "large phone landscape" width gets the worst version.
- **Fix:** Move the stacked-layout breakpoint up to `≤768px` to match the rest of the feature's mobile breakpoint, or add an intermediate rule. At minimum verify the `overflow-x: auto` scroll is discoverable (consider a fade/shadow cue like the reservation table at `styles.css:6511`).

### M4 — Sub-nav active pill uses per-category `--subpage-accent`; some accents may fail contrast for cream text
- **File:** `css/catalog-subpage.css:652-662` (active pill `background: var(--subpage-accent); color: var(--color-cream)`)
- **Breakpoint:** all (visual, amplified on small screens with thin labels)
- **Problem:** The active pill fills with the per-category accent and uses cream (#e5dec1) text. Yeast accent `#c4a035` (amber gold) on cream text is ~1.9:1 — fails WCAG AA badly; the active pill label becomes hard to read. The spec's contrast note only validated green-on-cream, not the accents-as-pill-background case. On phones the pill label (13px) is already small, compounding it.
- **Fix:** Either keep the active pill on `--color-green` (spec line 103 says border/hover use green only — extending that to the active fill is consistent and passes 5.1:1) or compute a safe text color per accent. Re-verify Yeast and Additives especially.

---

## LOW

### L1 — Mobile dropdown opens on hover/focus-within on touch — relies on JS tap fallback only for the first `.nav-dropdown`
- **File:** `css/styles.css:487-491` + `js/modules/13-init.js:177` (`querySelector('.nav-dropdown')` — single element)
- **Breakpoint:** ≤768px
- **Problem:** The CSS opens the dropdown on `:hover`/`:focus-within`, which don't fire cleanly on touch; the JS `.open` toggle is the real mobile path. `13-init.js:177` uses `querySelector` (first match only). There's a single nav dropdown today so it works, but it's fragile if a second dropdown is ever added. Minor.
- **Fix:** Use `querySelectorAll` and bind each, or document the single-dropdown assumption.

### L2 — Content loader fetches `content/{page}.json` with a relative path that 404s from `products/` subpages
- **File:** `js/modules/13-init.js:200-205`
- **Breakpoint:** not breakpoint-specific (affects all devices) — flagged as observed-in-scope
- **Problem:** `fetch('content/shared.json')` / `fetch('content/' + page + '.json')` resolve relative to the subpage URL, i.e. `products/content/shared.json`, which does not exist. The `.catch` returns `{}` so it fails silently (static fallback copy stays), but any `[data-content]` overrides on subpages won't apply. Not a layout/mobile bug, but noted since it surfaces on the in-scope subpages. Out of strict mobile scope — confirm whether subpages use `data-content` at all before acting.
- **Fix:** Use a root-relative path (`/content/...`) or compute the prefix like the nav hrefs do.

### L3 — Sub-nav horizontal scroll has no visible scroll cue; users may not realize Equipment/Packaging exist off-screen
- **File:** `css/catalog-subpage.css:611-623` (`.subnav-pills { overflow-x: auto; scrollbar-width: none }`)
- **Breakpoint:** ≤414px (where 7 pills definitely overflow)
- **Problem:** Hidden scrollbar is intentional (spec line 121), but with the scrollbar gone there's no affordance that the row scrolls. At 360–375px only ~4–5 of 7 pills are visible; the rightmost categories are discoverable only by guessing to swipe. The reservation table solves the same problem with a fade gradient (`styles.css:6511`).
- **Fix:** Add a right-edge fade gradient on `.ingredient-subnav` / `.subnav-pills` to hint at more content, or ensure the active pill auto-scrolls into view on load (currently active state is pure CSS, so on e.g. the Equipment page the active pill is off-screen-right at load with no scroll-into-view).

### L4 — Active pill not scrolled into view on load
- **File:** `css/catalog-subpage.css:652` (CSS-only active state, no JS) + no scroll handler
- **Breakpoint:** ≤414px
- **Problem:** Because active state is CSS-only (no JS per spec), landing on `equipment.html` shows the sub-nav scrolled to the left with "Equipment" (the active page) off the right edge. The user can't see which category they're on without manually scrolling. Pairs with L3.
- **Fix:** A tiny JS `scrollIntoView({inline:'center'})` on the active pill at load would resolve both L3/L4 without changing the CSS-only active styling.

---

## Things that are correct (verified)
- `inputmode` is set appropriately everywhere: `numeric` for integer qty, `decimal` for weight inputs (`11-cart.js:232,399,600,836`; `12-checkout.js:743,1255`). Good.
- Base `.qty-input` (16px, `styles.css:2998`) and `.weight-control-input` (16px, `:6027`) correctly avoid iOS zoom with explicit comments. Only the cart-drawer/reservation overrides regress (M1).
- Product grid collapses to a single column at `≤640px` (`catalog-subpage.css:573-577`) — good card legibility on phones.
- Reservation qty buttons enlarge to 40px on mobile (`styles.css:6914-6919`) — good.
- Hops stacked layout prevents page-level horizontal overflow at ≤640px; `.hops-table-wrap { overflow-x: auto }` contains overflow on tablet rather than blowing out the page.
- Hero `h1` uses `clamp()` and scales down at `≤480px` (`catalog-subpage.css:589-591`).
- Safe-area insets handled on hero padding (`catalog-subpage.css:546-548`, `hops.css:810-818`).
