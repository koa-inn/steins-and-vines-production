---
title: "Limited Releases 2026-27 page + $50 online deposits (LE26 + RQ27), with supplier marketing assets"
status: pending
created: 2026-10-27
source: owner handoffs 2026-10-27 — HANDOFF-limited-releases-deposits.md (main spec) + HANDOFF-limited-releases-assets.md (addendum: supplier marketing assets)
area: frontend + middleware / limited releases, checkout, Zoho
priority: medium
---

Build `limited-releases.html` presenting this season's ten limited-release wine kits: five from Winexpert
Limited Edition 2026 and five from RJS Restricted Quantities 2027 "Elemento". Customers reserve a kit with a
**$50 non-refundable deposit per kit**, through `POST /api/preorder/deposit`. There is no cap. The page launches
only when deposits work end to end. Full spec: `HANDOFF-limited-releases-deposits.md` (§0–§11).

**Addendum (assets), `HANDOFF-limited-releases-assets.md`:**
- **Supplier assets:** use Winexpert's and RJS's own marketing assets, already web-ready in
  `images/limited-releases/` (25 files, 3.0 MB, WebP + 2 brochure PDFs). They are referenced by new fields in
  `content/limited-releases-2026-27.json`: collection hero/group/logo/brochure; kit image/alt/scene_image/
  food_pairings/region_note; top-level `assets.attribution`.
- **First step:** commit the images + JSON as their own commit before any page work. Don't re-encode or resize them.
- **Rendering rules:**
  - Cards must work without `scene_image` (all RQ27 kits have none).
  - **Never overlay text on `le26-hero.webp`** (its CTA and logo are baked in).
  - Each card shows food pairings and a one-line region note.
  - Collection logo dark or light variant, chosen for the background behind it.
  - Brochure links with `download` and the file size.
  - Images get width/height, JSON alt text, lazy loading except the first hero, and `decoding="async"`.
  - Show the attribution line in small print. The images are self-hosted, so no CSP change is needed.
- **Don't:** pull any other supplier files into the repo (the RJS pack has licensed stock photography). Don't use
  the social, video, poster or email assets here, and don't copy supplier text beyond the JSON.
- **Tests to add:**
  - every JSON image and PDF path exists;
  - every kit image has non-empty alt;
  - a kit with `scene_image: null` renders cleanly;
  - pairings render;
  - attribution is present;
  - the LE26 hero has no overlay text element.
- **Business context:** RQ27 is sold first come, first served by RJS, so a reserved kit may not be supplied.
  The owner keeps no cap, but the per-item cap should stay easy to add in `lib/limited-releases.js`. The
  refund-on-supplier-failure line still needs owner confirmation (main handoff §8 item 1).

**Untracked in the working tree today:** `images/limited-releases/`, `content/limited-releases-2026-27.json`,
`HANDOFF-limited-releases-deposits.md`, `HANDOFF-limited-releases-assets.md`.
