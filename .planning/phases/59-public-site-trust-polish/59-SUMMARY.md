---
phase: 59-public-site-trust-polish
status: complete
completed: 2026-07-15
requirements: [REVIEW-03]
commits: [c1a6db29, 2fe23577]
approach: executed directly (investigation-informed), per owner decision
---

# 59 Summary — Public-Site Trust Polish

Investigation collapsed three reported problems into **one real issue and two
verified non-bugs** — measured against the live prod site, not assumed.

## (a) Empty gap above the footer — NOT A BUG (verified)

Measured `main`-bottom vs `footer`-top on Home, About, and Contact:
**gap = 0 on all three.** `main` meets the footer exactly; there is no stray
container, min-height, or margin. There is no static footer-gap bug.

What the reviewer saw ("tall stretch of blank background… reads as broken or
half-loaded") was **empty image boxes WITHIN the content**, not a gap between
content and footer — see (c). The two findings share one root cause.

## (b) Cart pre-populates / mystery item — NOT A BUG (verified)

The "Belgian Candi Syrup" the reviewer saw is **their own session state**. Two
confirmations:
1. It was sitting in *this* browser's `sv-cart-ingredients` localStorage from a
   prior session.
2. Code audit: **no path writes the ingredients cart on page load.** Every write to
   `INGREDIENT_CART_KEY` is inside an add / remove / checkout action
   (`js/modules/11-cart.js`, `12-checkout.js`). A genuinely-fresh visitor (empty
   localStorage) gets an empty cart.

The reviewer's "empty on Home/About/Contact, shown on Products" is expected: the
ingredients cart surfaces on the shopping pages, not the marketing pages. No
pre-populate bug; no fix.

## (c) Blank framed images — FIXED (`c1a6db29`)

The real issue, and the source of the (a) impression too. All facility images
return **HTTP 200 on prod** (nothing missing). They are `loading="lazy"` content
photos below the fold, and `.facility-photo-img` carries an 8px brown border — so
the box renders as an **empty bordered frame** until the image lazy-loads on scroll.
On the home page, 10 of 13 images were lazy+unloaded on first paint; the interior
photo alone reserves a 539px-tall empty box.

**Fix (owner decision — placeholder over eager-load, to protect first-paint speed):**
a brand-tone (`--color-cream`) placeholder + subtle shimmer on
`.facility-photo-img:not(.is-loaded)`, so an unloaded frame reads as "loading" not
"broken". A progressive-enhancement helper (`initFacilityPhotoPlaceholders`,
`13-init.js`) adds `.is-loaded` on load/error to stop the shimmer. The image is never
hidden by JS — placeholder sits behind it — so it degrades gracefully. Respects
`prefers-reduced-motion`.

RED→GREEN: `facility-photo-placeholder.test.js` (5 tests). Frontend 1014 green, lint
clean, artifacts rebuilt.

## Correction to the 58 summary

While reading `13-init.js` I found `renderOpenStatus()` runs on a
`setInterval(…, 60_000)`, so the Open/Closed pill **does** self-refresh every minute.
The "stale until reload" caveat noted in the 58 summary was wrong — there is no
staleness. No action.

## Net

REVIEW-03 closed. One real fix (image placeholder — frontend/CSS only, no money
path), two findings verified as non-bugs and recorded so they are not "fixed" by
guesswork. This is the milestone's verify-before-fix discipline paying off: of the
three reported items, only one was actually broken.

Next: Phase 60 (Admin Data Hygiene — orphan/blank kit rows inflating the low-stock
alert; overdue-count reconciliation). Note the Phase 58 owner todo (correct the bad
Kits-sheet price row) folds naturally into 60.
