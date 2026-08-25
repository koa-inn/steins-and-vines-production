# Phase 73 — Discussion Log

**Date:** 2026-08-25
**Mode:** discuss (default), batched single-call

Human-reference record of the discuss-phase decisions. Not consumed by downstream agents (they read `73-CONTEXT.md`).

## Input
Owner supplied a full diagnosis handoff (`73-PRICING-BUG-HANDOFF.md`) covering symptom, root causes A (no unit conversion) + B (pack granularity), per-line evidence, suggested fix, tests, and acceptance criteria. Discussion focused only on the genuine open decisions with data-model / money-path implications.

## Gray areas & decisions

### Pack-granularity model (Whirlfloc-class multi-unit packs)
- Options: redefine item per-unit in Zoho / pack-size field engine divides / fractional recipe quantity
- **Chosen:** Redefine item per-unit in Zoho (per-tablet). → D-01
- Note: owner data action for the Zoho redefinition + purchase-receiving conversion; invalid `L` unit on the recipe line fixed regardless.

### Non-convertible unit/rate pairs
- Options: fail closed (no price) / auto-normalize-else-fail / flag-but-compute
- **Chosen:** Fail closed — refuse to price, name the offending line (mirror Phase 67 tax fail-closed). → D-02

### apps-script save-time validation scope
- Options: include in this phase / follow-up phase
- **Chosen:** Include in this phase. → D-03

### Interim handling of SV-R-000004
- Options: leave as draft / set locked_price ~$92 / correct BrewPad lines now
- **Chosen:** Leave as draft (no interim edits). → D-04

## Deferred / owner actions
- Catalog-wide Zoho unit normalization (data hygiene, reduces bug class).
- Confirm SafLager sale price in Zoho.
- Kits-sheet negative retail_instore row (separate pricing-data todo).

## Claude's discretion
- Shared helper home/signature (`ingredientLineCost` in `lib/recipe-scaling.js` candidate) and conversion-table structure.
- Reject vs auto-normalize per case in save-time validation.
