# Phase 22 — UI Review

**Audited:** 2026-05-30
**Baseline:** `.planning/phases/22-category-subpages-navigation/22-UI-SPEC.md` (design contract)
**Screenshots:** captured (dev server on :8080) — desktop 1440x900 for grains/yeast/additives/packaging/equipment/ingredients/hops; mobile 375x812 for grains/equipment. Note: middleware not running locally, so catalog stays in the "Loading products…" state — populated card / empty / error visual states were NOT renderable and are assessed from source only.

---

## Pillar Scores

| Pillar | Score | Key Finding |
|--------|-------|-------------|
| 1. Copywriting | 3/4 | Empty-state body and error string deviate from the contract verbatim |
| 2. Visuals | 2/4 | Mobile cart drawer renders at-rest on screen, overlapping sub-nav (BLOCKER) |
| 3. Color | 2/4 | Two accent colors contradict the spec; Grains and Additives accents are near-identical browns |
| 4. Typography | 3/4 | ~10 distinct font sizes vs the 4 roles the contract declares (scale drift) |
| 5. Spacing | 3/4 | Conforms to scale; qty stepper controls fall below 44px touch target |
| 6. Experience Design | 3/4 | States covered in code; conflicting drawer rules produce a real desktop/mobile defect |

**Overall: 16/24**

---

## Top 3 Priority Fixes

1. **Mobile cart drawer is visible at rest, overlapping the sub-nav** (`css/catalog-subpage.css:750-767` vs `css/styles.css:6404-6421`) — A stray right-side cart panel covers ~10% of the viewport on every subpage at 375px (confirmed in `grains-mobile.png`, `equipment-mobile.png`). User impact: permanent occlusion of content and the Equipment/Packaging pills. Fix: scope `body.subpage-catalog .cart-drawer` to `@media (min-width: 1024px)` so the global mobile bottom-sheet rule (`translateY(100%)`) wins below 1024px, or merge the two rule sets into one breakpoint-aware block.

2. **Per-category accent colors contradict the design contract** (`products/yeast.html:183`, `products/additives.html:183`) — Spec mandates Yeast = `#c4a035` (gold) and Additives = `#6b5a9e` (purple). Implementation ships Yeast = `#7b5ea7` (purple) and Additives = `#c47a2a` (orange) — the two are effectively swapped. User impact: the Additives accent `#c47a2a` is visually almost identical to the Grains accent `#8b6f3a`, so two adjacent sub-nav pills read as the same warm brown and category differentiation is lost (confirmed in `additives-desktop.png` vs `grains-desktop.png`). Fix: set the accents to the contract values or, if the new palette is intentional, update the spec and re-pick Additives to a hue distinct from Grains.

3. **Empty-state and error copy do not match the Copywriting Contract** (`js/modules/16-catalog-subpage.js:336,360,364`) — Error reads `"Could not load products. Please try again."` (spec: `"Could not load products. Try refreshing or check back later."`); empty body reads `"Check back soon or contact us if you need something specific."` (spec: `"Check back soon or browse another category."`). User impact: low, but the contract was explicit. Fix: align both strings to the spec, or amend the contract.

---

## Detailed Findings

### Pillar 1: Copywriting (3/4)
- WARNING — Error string deviates from contract: `16-catalog-subpage.js:336` outputs "Could not load products. Please try again." vs spec "Could not load products. Try refreshing or check back later."
- WARNING — Empty-state body deviates: `16-catalog-subpage.js:364` "Check back soon or contact us if you need something specific." vs spec "Check back soon or browse another category."
- PASS — Empty heading "No {category} are currently available." (`:360`) is an acceptable parameterized variant of the spec's "No items currently available."
- PASS — Hero descriptions for all 5 new categories match the contract verbatim (`grains/yeast/additives/packaging/equipment.html:181`).
- PASS — Search aria-label "Search ingredients (coming soon)", sub-nav aria-label "Ingredient categories", and "All Ingredients" dropdown link all match (`grains.html:60,77,88`).
- Note: hops retry button says "Try again" (`15-hops.js:296`) — a separate Phase 21 pattern, not in this phase's contract.

### Pillar 2: Visuals (2/4)
- BLOCKER — Mobile cart drawer renders on-screen at rest. Two unscoped/over-scoped rule sets collide: the right-panel rule `body.subpage-catalog .cart-drawer` (`catalog-subpage.css:750`, no media query, specificity 0,2,0) and the global mobile bottom-sheet `@media (max-width:1023px) .cart-drawer` (`styles.css:6404`, specificity 0,1,0). The higher-specificity right-panel rule positions a 380px/90vw panel that is not fully cleared, intruding into the viewport and overlapping the sticky sub-nav (see `grains-mobile.png`, `equipment-mobile.png`).
- PASS — Strong, consistent focal hierarchy across all 7 pages: green hero band → display H1 → description → toolbar (verified across grains/yeast/additives/packaging/equipment screenshots; template drift is NOT present).
- PASS — Icon-only controls carry labels: disabled search button `aria-label="Search ingredients (coming soon)"`, cart FAB `aria-label="View cart"`, detail close `aria-label="Close details"`.
- WARNING — Spec §Color item 3 calls for a "subpage hero section — background tint via --subpage-accent," but the hero is a solid `--color-green` band; the accent appears only as a 4px bottom gradient line (`catalog-subpage.css:16-28`) and the toolbar top-border. The per-category accent is barely perceptible in the hero (see screenshots). Either acceptable as built or a missed contract item — flag for product decision.

### Pillar 3: Color (2/4)
- BLOCKER (contract) — Yeast accent `#7b5ea7` (purple) vs spec `#c4a035` gold (`yeast.html:183`). Additives accent `#c47a2a` (orange) vs spec `#6b5a9e` purple (`additives.html:183`). The two are essentially swapped from the contract.
- WARNING — Additives `#c47a2a` and Grains `#8b6f3a` are near-identical warm browns; on the shared sub-nav their active pills are not distinguishable, undermining the per-category color system (the whole point of the accent).
- PASS — Grains `#8b6f3a`, Packaging `#4a7fa8`, Equipment `#5a7a6a` match the spec.
- PASS — All structural color comes from tokens (`--color-cream`, `--color-green`, `--color-text`, `--subpage-accent`). Hardcoded hex in `catalog-subpage.css` are limited to `#fff` for input backgrounds (`:113,131`) and `var(--token, #fallback)` safety fallbacks (`:277,474,539,673,694,729,759`) — acceptable, not token bypasses.
- CONTRAST — Cream text (`#e5dec1`) on active-pill backgrounds: green `#4a6f4b` ≈ 4.9:1 (AA pass); Grains `#8b6f3a` ≈ 3.1:1 and Additives `#c47a2a` ≈ 2.6:1 fail WCAG AA (4.5:1) for the 13px/700 pill label. Yeast `#7b5ea7` ≈ 3.6:1 and Packaging `#4a7fa8` ≈ 3.0:1 also fail. Only Equipment `#5a7a6a` ≈ 3.9:1 is borderline. The active sub-nav pill label is informational text, so this compounds the project's known H14 contrast debt. WARNING.

### Pillar 4: Typography (3/4)
- WARNING — `catalog-subpage.css` introduces ~10 distinct font sizes (0.65, 0.75, 0.8, 0.85, 0.875, 0.9, 0.95, 1, 1.1, 1.125, 1.5rem) where the contract declares 4 type roles. New off-scale values: 0.65rem table headers (`:426`), 0.9rem mobile accordion (`:402`), 0.8rem weight-info (`:473`), 0.85rem list table (`:419`). Scale drift, not a break.
- PASS — Sub-nav pill labels are 0.8125rem/700 (`:635`) exactly as specced; hero H1 uses `clamp(1.625rem, 4vw+1rem, 3rem)`/700 (`:32`) as specced; only weights 400/700 are in use.

### Pillar 5: Spacing (3/4)
- PASS — Sub-nav pills `padding: 8px 16px; min-height: 36px` (`:628-629`) conform to the sm/md tokens and the documented 36px exception. Dropdown divider `margin: 4px 0` and width `min-width: 200px` match the contract (`styles.css:470,477-478`).
- WARNING — Quantity stepper touch targets below 44px: reservation-table qty buttons 28x28 (`styles.css:2980`), value input height 28px; cart-sidebar qty buttons 26x26 (`:5742`). WCAG 2.5.5 / mobile usability concern, though these are dense table/drawer contexts. Subpage-card qty buttons are 38x38 (`catalog-subpage.css:296`) — also under 44 but closer.
- PASS — Card grid gap `24px 16px` (`:243`) maps to lg/md tokens.

### Pillar 6: Experience Design (3/4)
- PASS — Loading (`subpage-loading`), error + Retry button, and empty states are all implemented (`16-catalog-subpage.js:178,323,356`). Search debounced 180ms (`:886`). View mode persisted to localStorage (`:899`). Escape closes detail panel; resize-to-mobile closes panel (`:919,931`). Out-of-stock items correctly suppress cart controls (`:586,679`).
- BLOCKER (carries from Pillar 2) — The drawer rule collision is an interaction defect, not just visual: at <1024px the right-panel transform competes with the bottom-sheet transform, so open/close animation direction is ambiguous.
- PASS — `--header-height` is set at runtime by `js/modules/13-init.js:234`, so the sub-nav `top: var(--header-height, 80px)` (`:598`) only relies on the 80px fallback for first paint; the 60px fallback used elsewhere in `styles.css` is a pre-existing inconsistency, not introduced here. Minor.
- PASS — No destructive actions in this phase; "Clear Cart" is the only state-reset and is not part of this phase's new surface.

---

## Registry Safety
No `components.json` present and the contract declares no third-party registries (§Registry Safety). Registry audit skipped — not applicable to this vanilla HTML/CSS/JS project.

---

## Files Audited
- `products/grains.html`, `products/yeast.html`, `products/additives.html`, `products/packaging.html`, `products/equipment.html`, `products/hops.html`, `products/ingredients-supplies.html`
- `css/catalog-subpage.css`
- `css/hops.css`
- `css/styles.css` (nav-dropdown `:459-523`; reservation qty controls `:2927-3030`; cart-sidebar weight steppers `:5728-5787`; global cart-drawer `:6381-6421`; color tokens `:118-129`)
- `js/modules/16-catalog-subpage.js`
- `js/modules/15-hops.js` (referenced)
- `js/modules/13-init.js:234` (header-height setter, referenced)
- Screenshots: `.planning/ui-reviews/22-20260529-231326/` (gitignored)
