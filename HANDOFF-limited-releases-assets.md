# Handoff (addendum) — Limited Releases: supplier marketing assets

**Date:** 2026-10-27
**Adds to:** `HANDOFF-limited-releases-deposits.md` (you already have it). Everything there still
stands. This covers what arrived after it was written: the suppliers' marketing materials, and the
new fields in the content file that carry them.

The owner wants the page to use Winexpert's and RJS's own marketing assets. They're now in the
repo, prepared for web, and referenced from the content JSON.

---

## 1. What's new in the working tree (untracked — commit it)

```
images/limited-releases/          25 files, 3.0 MB
content/limited-releases-2026-27.json   (new fields, below)
HANDOFF-limited-releases-deposits.md    (§7a and §8 item 6 updated to match this file)
```

Commit the images and the JSON as their own commit before the page work, e.g.
*"Add Winexpert LE26 and RJS RQ27 marketing assets for limited releases page"*.
Files are already web-ready: WebP, sRGB, sized and compressed. **Don't re-encode or resize them.**

| File(s) | Size | Use |
|---|---|---|
| `le26-<kit>-bottle.webp` ×5, `rq27-<kit>-bottle.webp` ×5 | 455×900 / ~237×900, transparent, 8–22 KB | Kit card image |
| `le26-<kit>-scene.webp` ×5 | 1200×857, 146–207 KB | LE26 card header / background |
| `le26-hero.webp` | 1920×1080, 114 KB | LE26 section banner — **has "RESERVE YOURS NOW." and the Winexpert logo printed in it** |
| `rq27-hero.webp` | 1920×1233, 161 KB | RQ27 section banner (no baked text) |
| `le26-group.webp` | 1400×1124 | All five LE26 bottles |
| `rq27-group.webp` | 1100×1375 (4:5) | All five RQ27 bottles, with the Elemento wordmark |
| `le26-logo-black/white.webp`, `rq27-logo-dark/white.webp` | ~700 wide, transparent | Collection logo; dark for light backgrounds, white for dark |
| `le26-brochure.pdf`, `rq27-brochure.pdf` | 585 KB / 686 KB | "Download the brochure" links |

## 2. New content fields

**Collection** (`collections[]`): `hero_image`, `hero_image_alt`, `group_image`,
`logo: { dark, light }`, `brochure_pdf`.

**Kit** (`kits[]`): `image`, `image_alt`, `scene_image` (null for all five RQ27 kits),
`food_pairings` (array of short strings, all ten kits), `region_note` (one sentence, all ten).
RQ27 `notes` were rewritten from RJS's official tasting notes, and Aria's `region` is now
"Niagara, Canada".

**`assets`** (top level): provenance and status of each pack, plus `attribution` —
"Images courtesy of Winexpert and RJS Craft Winemaking." Informational except `attribution`,
which the page must display.

All paths are relative to the site root and every one exists on disk (checked 27 Oct).

## 3. Rendering requirements

- **Card layout works with or without `scene_image`.** LE26 cards have one; RQ27 cards don't. Don't
  leave an empty frame. A consistent option: bottle shot on every card, scene image as a
  header band only when present.
- **Never put text over `le26-hero.webp`** — it already has a call to action and logo in it. Treat
  it as a picture, with the section heading above or below. `rq27-hero.webp` is clean and can take
  an overlay if you want one, with enough contrast.
- Food pairings as a short list on each card (or in an expandable "Pairs with" section on mobile).
  `region_note` as one line under the region.
- Collection logo at the top of each collection section; pick `dark` or `light` for the
  background behind it.
- Brochure links: `download` attribute, file size in the link text ("Brochure (PDF, 0.6 MB)").
- Images: `width`/`height` attributes set from the table above (no layout shift); `alt` from the
  JSON; `loading="lazy"` on everything except the first hero; `decoding="async"`.
- Show `assets.attribution` in small print near the bottom of the page.
- Self-hosted only. CSP `img-src 'self'` already covers `images/`, so no CSP change is needed for
  these.

## 4. Don't

- Don't pull anything else from the supplier packs into the repo. The RJS pack's landscape
  artwork includes licensed stock photography meant for RJS's own materials; only the files above
  were prepared for the web, deliberately.
- Don't use the per-kit social posts, videos, posters or email banners on this page — they're for
  social, the newsletter and the shop, and several have text and logos laid out for other formats.
- Don't copy supplier marketing text verbatim into the page beyond what's in the JSON.

## 5. Tests (add to the frontend suite)

- Every image and PDF path in `content/limited-releases-2026-27.json` exists on disk.
- Every kit renders its `image` with non-empty `alt`.
- A kit with `scene_image: null` renders without a broken or empty image element.
- Each kit's food pairings render.
- The attribution line is present.
- The LE26 hero has no overlay text element (guards the "don't overlay" rule).

## 6. Business context that changed

RJS's launch deck says RQ27 kits are sold **first come, first served until inventory is depleted**.
The owner's decision is still **no cap** on deposits, but this raises the chance that a reserved
RQ27 kit can't be supplied. The page copy already promises a full refund in that case (subject to
the owner confirming that line — §8 item 1 of the main handoff). Keep the per-item cap easy to add
in `lib/limited-releases.js`.
