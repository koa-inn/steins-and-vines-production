# Phase 90: BrewPad batch invoice linking - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-10-14
**Phase:** 90-brewpad-batch-invoice-linking
**Areas discussed:** Invoice at batch creation, Unlinked filter + backfill queue, Grain-order recipe split, Canning bundle rules, Recipe dropdown (added mid-discussion)

---

## Invoice at batch creation

| Question | Options | Selected |
|---|---|---|
| Empty invoice behaviour | Warn + internal checkbox / Hard require / Silent optional | Warn + internal checkbox ✓ |
| What the internal checkbox records | source='internal' / keep manual + note / separate boolean | source='internal' ✓ |
| `source` editable after creation | manual↔internal only / any value / no | manual↔internal only ✓ |
| Invoice input style | Reuse invoice search / type number / search + typed fallback | Reuse invoice search ✓ |

## Unlinked filter + backfill queue

| Question | Options | Selected |
|---|---|---|
| Backfill shape | Filter chip + guided review / dedicated review screen / filter chip only | Filter chip + guided review ✓ |
| Candidate proposal | Customer match + date window / customer only / you decide | Customer match + date window ✓ |
| One invoice → many batches | Yes, warn / yes, no warning / one-to-one | Yes, warn if already linked ✓ |
| Unlinked includes internal | Exclude / include, badge them | Exclude ✓ |

## Grain-order recipe split

| Question | Options | Selected |
|---|---|---|
| How the customer marks the split | Per-grain bag selector / named bags / free text | Free text: "it should be separable as the grains are selected ideally... this may be a bigger feature than originally thought" |
| Qty split of one line | Yes / no | Yes ✓ |
| Scope + max | Milled only, max 4 / all grains, max 4 / milled, no cap | All grains, max 4 ✓ |
| Where staff see it | Zoho notes / email / BrewPad batch (multi) | All three ✓ |
| Placement | Own phase / keep in 90 / backlog | Own phase ✓ (→ Phase 91) |
| Select-time UX | Bag selector on add-to-cart / recipe builder / decide later | Decide in its own discussion ✓ |

## Canning bundle rules

| Question | Options | Selected |
|---|---|---|
| Trigger | Canning bundle button / auto when cans added | Button ✓ |
| Over cap | Warn + override / warn + per-can excess / block | Warn + override ✓ |
| Wine | One "Cider / sparkling wine" option / ask still vs sparkling | One option ✓ |
| Discountable | Non-discountable (keep D-08) / discountable | Non-discountable ✓ |
| custom-labels "~84 cans" copy | Fix in Phase 90 / quick fix separately | Fix in Phase 90 ✓ |
| Prod proof sequencing | Same terminal session as recipe money-path / independent | Same session ✓ |

## Recipe dropdown (owner request mid-discussion)

The owner asked: "can we also add a dropdown list when selecting a recipe (so i can see the existing recipes) in kiosk and brewpad where relevant"

| Question | Options | Selected |
|---|---|---|
| Surfaces | BrewPad new-batch / BrewPad attach / kiosk recipe mode / recipe editor (multi) | All four ✓ |
| Placement | Separate quick task / fold into 90 / backlog | Fold into Phase 90 ✓ |
| Behaviour | Full list on focus + filter / native select / grouped by category | Full list on focus + filter ✓ |
| Editor list | Duplicate check + start-from / reference only / warning only | Duplicate check + start-from ✓ |

## Claude's Discretion
- The candidate window and kit-line detection details; the visual design of the new UI; optional grouping by beer_category.

## Deferred Ideas
- Online grain-order recipe splitting → new Phase 91.
