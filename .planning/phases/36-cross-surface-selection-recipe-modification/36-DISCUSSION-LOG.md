# Phase 36: Cross-Surface Selection & Recipe Modification - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-20
**Phase:** 36-cross-surface-selection-recipe-modification
**Areas discussed:** Modify scope & edit flow, Locked-price + edits pricing, BrewPad attach semantics, Save-as-new-recipe (MOD-03)

---

## Modify scope & edit flow

### Which surfaces get add/remove/substitute (MOD-01)?

| Option | Description | Selected |
|--------|-------------|----------|
| Sale surfaces only | Admin + kiosk only; BrewPad attach stays scale-only (recommended) | |
| All three surfaces | Admin, kiosk, AND BrewPad recipe-attach | ✓ |
| Admin only for now | Ship admin first, defer kiosk/BrewPad | |

### How do edits and scaling combine?

| Option | Description | Selected |
|--------|-------------|----------|
| Edit base, then scale | Edit at base quantities; scale factor multiplies the modified list (recommended) | ✓ |
| Edit the scaled list | Scale first, then tweak final scaled numbers | |

**User's choice:** All three surfaces; edit base then scale.
**Notes:** Choosing "all three" means BrewPad attach also freezes a modified snapshot (no charge) — drove the BrewPad attach decisions below.

---

## Locked-price + edits pricing

### Locked recipe + ADD ingredient

| Option | Description | Selected |
|--------|-------------|----------|
| Add at catalog rate on top | locked_price×factor + fees + (added qty × catalog rate) (recommended) | ✓ |
| Force dynamic recompute | Modification flips sale to dynamic pricing | |
| No price change | Absorb added ingredient into locked price | |

### Locked recipe + REMOVE ingredient

| Option | Description | Selected |
|--------|-------------|----------|
| No credit — price unchanged | locked_price×factor + fees stays as-is (recommended) | ✓ |
| Subtract catalog rate | Reduce charge by removed ingredient's scaled cost | |
| Force dynamic recompute | Flip to dynamic so removal is reflected | |

**User's choice:** Add at catalog rate on top; remove gives no credit.
**Notes:** Intentional asymmetry (adds cost money, removals don't refund) — margin-protective. Flagged for UAT awareness in CONTEXT D-08.

---

## BrewPad attach semantics

### What does attach persist (no payment)?

| Option | Description | Selected |
|--------|-------------|----------|
| Scaled + modified snapshot, no charge | Freeze snapshot via updateBatch; no pricing/charge (recommended) | ✓ |
| Full priced quote, still no charge | Also compute & store server price for reference | |

### Stock check / manager-override on attach

| Option | Description | Selected |
|--------|-------------|----------|
| Soft warning, never block | Advisory only; attach always allowed (recommended) | ✓ |
| Same hard-block + override | Reuse sale-path block for consistency | |
| No stock check on attach | Skip entirely | |

**User's choice:** Scaled + modified snapshot only, no charge; stock check is a soft warning.
**Notes:** Sale surfaces keep Phase 35's hard-block + manager override; attach never blocks because nothing is sold/deducted.

---

## Save-as-new-recipe (MOD-03)

### Stored quantities

| Option | Description | Selected |
|--------|-------------|----------|
| Base volume, un-scaled | Store modified set at base batch_size_l (recommended) | ✓ |
| Scaled quantities as new base | Save scaled qty; target volume becomes new base | |

### Pricing mode

| Option | Description | Selected |
|--------|-------------|----------|
| Force dynamic | Price from live catalog rates (recommended) | ✓ |
| Copy source mode | Inherit source; locked → draft until price set | |
| Prompt staff to choose | Ask at save time | |

### Naming + activation state

| Option | Description | Selected |
|--------|-------------|----------|
| Prompt name, create as draft | Staff name it; created inactive behind guardrail (recommended) | ✓ |
| Auto-name, create as draft | Default "{original} (modified)", still draft | |

**User's choice:** Base volume un-scaled; dynamic pricing mode; staff-prompted name, created as draft.
**Notes:** Persist the modified *base* list (pre-scale) directly — avoids reversing discrete ceil-rounding. Original recipe never touched.

---

## Claude's Discretion

- Exact ingredient-row modification UX per surface (inline rows vs sub-panel); reuse closest recipe-builder pattern, touch-friendly for iPad.
- Placement of the modification affordance relative to the target-volume input.
- Substitute as a distinct "swap" affordance vs remove-then-add (identical at data layer).
- Whether kiosk gates modification/override behind extra staff permission.
- Correct activation guardrail for a *dynamic* save-as-new recipe (documented guardrail assumes locked).

## Deferred Ideas

- Recipe versioning / edit history — future milestone.
- Per-ingredient scaling overrides / unit conversion / customer-facing recipe config — future milestone.
- Crediting removed ingredients on locked recipes — intentionally excluded (D-08).
