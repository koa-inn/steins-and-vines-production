# Phase 89: Beer category field for recipes - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-10-14
**Phase:** 89-beer-category-field-for-recipes
**Areas discussed:** Category list & lagers, Initial recipe mapping, What customers see, Editors & pinned tests

---

## Category list & lagers

| Option | Description | Selected |
|--------|-------------|----------|
| Keep the 12 as-is | No new CSS; some lagers share a colour | ✓ |
| Add 1–2 lager colours | e.g. darklager, festbier, each with new .tint-* | |
| Rework the list for recipes | Recipe-specific vocabulary | |

| Option | Description | Selected |
|--------|-------------|----------|
| App-level only | Shared normaliser; PG plain text | ✓ |
| App + DB CHECK constraint | Strongest, but the allowlist forbids DROP CONSTRAINT | |
| You decide | | |

| Option | Description | Selected |
|--------|-------------|----------|
| Normalise, then reject | Trim/lowercase; 400 if still unknown | ✓ |
| Normalise, then blank it | Silent blank | |
| Strict, no normalising | Exact keys only | |

| Option | Description | Selected |
|--------|-------------|----------|
| beer_category | Explicit, beer-specific | ✓ |
| category | Generic; collides with the Zoho category | |
| tint | Names the colour, not the style | |

**Notes:** Claude raised that `migration-allowlist.js` forbids DROP CONSTRAINT, which drove the app-level choice.

---

## Initial recipe mapping

Clear-cut mapping presented as the default (no objection): the 2 IPAs → ipa, Hazy Pale → pale, German Pilsner → pilsner,
Helles and Bavarian → lager, English Mild → brown.

| Recipe | Options | Selected |
|--------|---------|----------|
| Oktoberfest (Festbier) | lager / amber | lager |
| Czech Lager | pilsner / lager | pilsner |
| Czech Dark Lager | brown / porter | brown |
| American Lager | lager / session | lager |

| Option | Description | Selected |
|--------|-------------|----------|
| Staff set them in BrewPad | Part of UAT; same picks on prod | ✓ |
| One-off scripted update | API script | |
| Pre-fill the sheet column | Arrives with the backfill | |

---

## What customers see

| Option | Description | Selected |
|--------|-------------|----------|
| Colour only | Name and style already shown | ✓ |
| Colour + small category tag | Needs display names and CSS | |

| Option | Description | Selected |
|--------|-------------|----------|
| Default gold, as today | No tint class | ✓ |
| Hide until categorised | Field effectively required | |

**Notes:** Claude noted that the colour also applies on the wine.html recipe mount (shared builder). This was accepted.

---

## Editors & pinned tests

| Option | Description | Selected |
|--------|-------------|----------|
| Next to Style, readable names | Select after Style; stores the key | ✓ |
| Readable names + colour swatch | Extra UI work | |
| Raw keys | Least friendly | |

| Option | Description | Selected |
|--------|-------------|----------|
| Optional | Blank = gold | ✓ |
| Required to set status Active | Extra validation | |

| Option | Description | Selected |
|--------|-------------|----------|
| Approve, field-set only | Add the field to pinned lists/fixtures; widen the className assertion | ✓ |
| Approve case by case | | |
| Don't approve | Blocks the phase | |

### Production timing

| Option | Description | Selected |
|--------|-------------|----------|
| After 85-13 | Separate promotion | ✓ (final) |
| Together with 85-13 | Colours live on cutover night | initially chosen |

**Notes:** The owner asked what the timing question meant in practice and first picked "together". Claude then
checked and flagged that bundling requires either pushing all of `main` (193 commits beyond the `d2c66be9` pin,
including gated Phase 86/87 and kiosk money-path work) or running migration 0006 ahead of 0004/0005, which
breaks node-pg-migrate's order check on a later deploy. The owner switched to "After 85-13".

## Claude's Discretion

- Dropdown label wording and order; the migration filename; special-casing vs the string-fields list; `setupRecipeTabs`
  header; a single frontend key list; the plan breakdown; the mechanism for keeping the 85-13 backfill safe (D-14).

## Deferred Ideas

- A recipe filter/grouping by category on beer.html; a visible category tag; extra lager colours; an editor colour swatch.
