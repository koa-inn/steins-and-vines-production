# Phase 35: Batch Scaling Engine - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-20
**Phase:** 35-batch-scaling-engine
**Areas discussed:** Unit rounding rules, Locked-price scaling, Stock-conflict handling, Volume input rules

---

## Unit rounding rules

| Option | Description | Selected |
|--------|-------------|----------|
| By unit string | kg/g/l/ml → linear; pcs/each/unit/pkg → round up. No new fields. | ✓ |
| By cf_type | Use Phase 34 cf_type as the weight-vs-discrete signal. | |
| Explicit per-ingredient flag | Add a 'discrete' flag across the catalog. | |

| Option | Description | Selected |
|--------|-------------|----------|
| Round up, min 1 | ceil(), never below 1 — 2.3→3, 0.5× of 1 packet stays 1. | ✓ |
| Round up, allow 0 | ceil() but can drop to 0 on small batches. | |
| Nearest whole | Standard rounding; can under-provision. | |

**User's choice:** Classify by unit string; round up with a floor of 1.
**Notes:** Unknown/blank units default to linear (Claude discretion); researcher to enumerate real unit values for the planner to finalize the discrete-unit token list.

---

## Locked-price scaling

**Clarification round 1 — what locked_price represents:**

| Option | Description | Selected |
|--------|-------------|----------|
| Flat locked price only | Customer pays exactly locked_price; fees not added (current code). | |
| Locked price + fees | Customer pays locked_price + service + materials. | ✓ ("not sure but it should be") |
| Not sure / check | Researcher confirms current pos-recipe.js behavior. | |

| Option | Description | Selected |
|--------|-------------|----------|
| Real ingredient cost (base held) | Portion = catalog cost; base price stays today's locked_price. | |
| Locked minus fee fields | Portion = locked_price − service − materials. | ✓ (initial pick) |

**Clarification round 2 — reconciled model:**

| Option | Description | Selected |
|--------|-------------|----------|
| Yes — locked + fees, globally | price = locked_price × factor + service + materials, base AND scaled. | ✓ |
| Only change scaled sales | Keep base flat; only scaled sales add fees (creates 1× discontinuity). | |
| Let me rethink fees | Reopen the fee model. | |

**User's choice:** locked_price is the scalable portion; service + materials are fixed add-ons; `price = locked_price × factor + service_fee + materials_fee`, applied globally.
**Notes:** User initially picked "locked minus fees" (which produces a negative portion when fees > locked price) alongside a "locked + fees" mental model — the two were contradictory. Reconciled: under a "+fees" model locked_price already IS the ingredient portion, so we scale it directly and add fixed fees (no subtraction, no negatives). Flagged as a change from current flat-locked-price behavior — researcher must verify current code; existing locked recipe prices will shift.

---

## Stock-conflict handling

| Option | Description | Selected |
|--------|-------------|----------|
| Hard block + override | Block + list shortfalls; manager can override to proceed. | ✓ |
| Hard block, no override | Must lower volume until everything is in stock. | |
| Warn only | Warning banner but sale proceeds freely. | |

| Option | Description | Selected |
|--------|-------------|----------|
| Live availability endpoint | Reuse existing recipe availability/stock data. | ✓ |
| Re-fetch fresh at confirm | Pull freshest Zoho stock at confirm. | |
| You decide | Match existing kiosk/recipe-sale stock logic. | |

**User's choice:** Hard block with manager override; compare against the existing live availability endpoint.
**Notes:** Checks run on the scaled quantities.

---

## Volume input rules

| Option | Description | Selected |
|--------|-------------|----------|
| Pre-fill base, free L entry | Default to base batch_size_l, free litre entry, 0.5 L steps. | ✓ |
| Blank, must enter | Field starts empty. | |
| Preset multipliers | 1×/1.5×/2× buttons + custom. | |

| Option | Description | Selected |
|--------|-------------|----------|
| Sane bounds + block if no base | volume > 0, max ~10× base; scaling disabled if no base set. | ✓ |
| Sane bounds, treat no-base as 1× | Assume entered volume is base if base missing. | |
| No bounds | Any positive number. | |

**User's choice:** Pre-fill base, free litre entry with 0.5 L steps; bounds volume > 0 and max ~10× base; disable scaling (prompt to set base) when a recipe has no base batch_size_l.

---

## Claude's Discretion

- Unknown/blank units → linear scaling (pending researcher unit enumeration).
- Exact discrete-unit token set, finalized against the live catalog.
- Scale-factor display string + placement of the volume input in the admin recipe-sale UI.
- Whether to also re-run the scaled stock check server-side at /confirm.

## Deferred Ideas

- Cross-surface batch-size control (kiosk + BrewPad) and carry-through into cart/batch record — Phase 36 (SEL-01, SEL-02).
- One-off ingredient add/remove/substitute + save-as-new-recipe — Phase 36 (MOD-01..03).
