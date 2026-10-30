---
phase: 100-limited-releases-page-and-online-deposits
plan: 15
subsystem: frontend polish (limited-releases page, confirmation, emails, homepage banner)
tags: [ui, mobile, polish, owner-requested]
requires: [100-13]
provides: [owner-approved polished page, mobile fixes, homepage feature banner snippet]
key-files:
  created:
    - tests/frontend/limited-releases-polish.test.js
    - tests/frontend/limited-releases-mobile.test.js
    - tests/frontend/limited-releases-pairings.test.js
    - tests/frontend/limited-releases-terms.test.js
    - zoho-middleware/__tests__/mailer-preorder-so-label.test.js
    - .planning/phases/100-limited-releases-page-and-online-deposits/100-UI-REVIEW-MOBILE.md
    - .planning/phases/100-limited-releases-page-and-online-deposits/homepage-feature-snippet.html
  modified:
    - css/limited-releases.css
    - limited-releases.html
    - js/modules/18-limited-releases.js
    - zoho-middleware/lib/mailer.js
    - css/styles.css
decisions:
  - "Owner approved the polish on staging 2026-10-30 ('polish approved')"
  - "Release calendar moved below the collections and restyled as wall-calendar pages with a supplier colour legend"
  - "'Pairs with' always visible (no toggle); deposit terms folded with the key term and fee note kept visible"
  - "Homepage feature banner added at launch (Plan 14) — markup held in homepage-feature-snippet.html because the hold-back test forbids links before launch"
  - "Kit card height on phones left as is (owner did not ask for compact cards)"
metrics:
  completed: 2026-10-30
---

# Phase 100 Plan 15: UI polish — Summary

Owner-requested polish pass after the staging run, plus a dedicated mobile audit and a round of owner design
feedback, all on staging and approved.

## Polish pass (fdae1080, 329aa295)
Root cause of most misalignment: the global `p` max-width/auto-margin rule centred paragraph blocks inside left-aligned
sections. Fixed for this page only (styles.css untouched by this pass). Calendar month/kit structure, chip pills, 5-kit
grid, Elemento crop, section rhythm, confirmation alignment, form spacing; "SO SO-" fixed on the page and in both emails.

## Mobile audit (100-UI-REVIEW-MOBILE.md) and fixes (cb7c9c6b … 57e4375c)
BLOCKER: the sticky bar was inside `<main>`, whose entry animation leaves a transform, so `position: fixed` broke and
the bar never appeared on phones — moved to `<body>`. Also: body padding so the bar never covers the footer policy
links, 44 px calendar tap targets, bar hidden while the cookie notice is open, hero "2026-27" no-wrap, scroll lock
while the payment sheet is open, confirm spinner, focus rings, pluralisation, button sizing, bar/hero button styles.
Measured on headless Chromium at 320–430 px: no horizontal overflow, bar inside the viewport.

## Owner design feedback (9a645b1c … 6bf661e7)
Calendar moved below the kits and restyled as wall-calendar pages (Nov→Apr row on desktop, 2 columns on phone,
burgundy = Winexpert, gold = RJS); calendar and How-it-works headings centred; deposit terms in the reserve panel's
760 px column, full list folded under "Read the full deposit terms" with "$50 per kit, non-refundable" and the fee
note visible; "Pairs with" always shown. Homepage feature banner styles (e1c39e26) + launch snippet; Plan 14 updated
to insert it (36e3f56b).

## Deviations
- Two assertions in the Phase-100 test limited-releases-payment.test.js changed (they encoded the "SO SO-" bug).
- One assertion in the Phase-100 polish test accepts "Jan 2027" after the calendar restyle.
- Phase 100 middleware lint warnings cleared (42ad801b). The pre-existing `lib/batch-pg-read.js:304` warning
  (Phase 96) still fails `cd zoho-middleware && npm run lint` (`--max-warnings 0`) — flagged to the owner, out of scope.

## Follow-ups
- Responsive image `srcset` (audit LOW, skipped).
- Kit card height on phones (~900 px) unchanged.
- styles.css `.btn--hero-solid` cascade bug likely affects other pages (audit note).

## Self-Check: PASSED
Owner approval recorded; frontend 3,298+ / middleware suites green at each push; staging deployed.
