---
phase: 09-content-seo-push
plan: 03
subsystem: frontend/content
tags: [photos, seo, content, css]
dependency_graph:
  requires: [09-01, 09-02]
  provides: [facility-photos-placed]
  affects: [index.html, about.html, products/ferment-in-store.html, products/ingredients-supplies.html]
tech_stack:
  added: []
  patterns: [facility-photo figure/img pattern, lazy loading, explicit width/height for CLS prevention]
key_files:
  created:
    - images/facility/winemaking.jpg
    - images/facility/bottling.jpg
    - images/facility/counter.jpg
    - images/facility/batch_w_logo.jpg
    - images/facility/interior.jpg
    - images/facility/storefront.jpg
    - images/facility/paul.jpg
    - images/facility/koa.jpg
  modified:
    - css/styles.css
    - css/styles.min.css
    - products/ferment-in-store.html
    - products/ingredients-supplies.html
    - index.html
    - about.html
decisions:
  - Photo placement uses <figure class="facility-photo"> wrapper per spec
  - winemaking.jpg placed before "Your first visit" paragraph in ferment-in-store (natural break after h3)
  - bottling.jpg placed after "Bottling day" paragraph in ferment-in-store (visual reinforcement)
  - counter.jpg placed before Equipment h3 in ingredients-supplies (breaks up text)
  - batch_w_logo.jpg placed before "Advice Is Always Free" h3 in ingredients-supplies
  - interior.jpg placed in "Why Make Your Own Wine?" section on homepage
  - storefront.jpg placed in "Homebrew Supplies in Squamish" section on homepage
  - paul.jpg and koa.jpg placed after cheers.jpg in about.html Our Story section
metrics:
  duration: 8 min
  completed: "2026-05-04"
  tasks: 1
  files: 14
---

# Phase 9 Plan 3: Facility Photos Summary

Professional facility photos placed on all 4 target pages (ferment-in-store, ingredients-supplies, homepage, about) with rustic brown border CSS styling, lazy loading, and explicit dimensions to prevent CLS.

## What Was Built

**CSS** (`css/styles.css`): Added `/* ===== Facility Photos ===== */` block with `.facility-photo` (margin, max-width 800px) and `.facility-photo-img` (8px brown border, border-radius, box-shadow, display:block).

**ferment-in-store.html**: Two photos placed in the `.landing-copy` section — `winemaking.jpg` (1920x2400) after the "How It Works" h3 heading, and `bottling.jpg` (1920x2880) after the "Bottling day" paragraph.

**ingredients-supplies.html**: Two photos placed in the `.landing-copy` section — `counter.jpg` (1920x2400) before the "Equipment" h3, and `batch_w_logo.jpg` (2400x1920) before the "Advice Is Always Free" h3.

**index.html**: Two photos placed in homepage intro sections — `interior.jpg` (2880x1920) at the end of the "Why Make Your Own Wine?" section, and `storefront.jpg` (2400x1920) at the end of the "Homebrew Supplies in Squamish" section.

**about.html**: Two photos placed in the "Our Story" tab panel after the existing `cheers.jpg` — `paul.jpg` (2880x1920) and `koa.jpg` (2400x1920).

All images follow the required pattern: `<figure class="facility-photo">` wrapper, `class="facility-photo-img"`, `loading="lazy"`, explicit `width` and `height` from `sips`, descriptive alt text including "Steins & Vines" and "Squamish".

## Deviations from Plan

None — plan executed exactly as written.

## Commits

| Task | Commit | Description |
|------|--------|-------------|
| Task 2 | 031a917 | feat(09-03): add facility photo CSS and place photos on all target pages |

## Awaiting Human Verification (Task 3)

Plan is paused at the `checkpoint:human-verify` gate. User must visually verify all pages before staging deploy proceeds.

## Known Stubs

None — all photos are real user-provided facility photos, not placeholders.

## Threat Flags

None — no new security-relevant surfaces introduced. Photos are static files served from GitHub Pages.

## Self-Check: PASSED

- css/styles.css contains `.facility-photo` block: FOUND
- css/styles.min.css contains facility-photo: FOUND
- ferment-in-store.html has 4 facility-photo references: FOUND
- ingredients-supplies.html has 4 facility-photo references: FOUND
- index.html has 4 facility-photo references: FOUND
- about.html has 4 facility-photo references: FOUND
- No placeholder tokens in any HTML file: CONFIRMED
- products.html has no facility-photo references: CONFIRMED
- Commit 031a917 exists: CONFIRMED
- 286 frontend tests pass: CONFIRMED
- 0 lint errors: CONFIRMED
