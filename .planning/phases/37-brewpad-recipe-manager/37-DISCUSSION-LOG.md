# Phase 37: BrewPad Recipe Manager - Discussion Log

**Date:** 2026-06-20
**Mode:** discuss (interactive)

> Human-reference record of the discuss-phase session. Not consumed by downstream agents — see `37-CONTEXT.md` for the canonical decisions.

## Areas Selected for Discussion

User selected all four offered gray areas: Placement/navigation, Editor approach, Action scope, Field scope & validation.

## Questions & Selections

### Placement
- **Q:** Where should recipe management live in BrewPad?
- **Options:** New 5th bottom tab (rec) / Section inside Batches / From recipe-attach only
- **Selected:** New 5th bottom tab → **D-01**

### Editor
- **Q:** How should the recipe create/edit form be built?
- **Options:** Port admin's builder, BrewPad-styled (rec) / Fresh BrewPad-native editor / Minimal editor first
- **Selected:** Port admin's builder, BrewPad-styled → **D-02**

### Actions
- **Q:** Which actions should BrewPad support (create/edit/activate in scope per roadmap)?
- **Options:** Browse/view/create/edit/activate (rec) / Also include delete / View-create-edit only (no activate)
- **Selected:** Also include delete → **D-03**, **D-04** (delete via confirm-sheet)

### Field scope
- **Q:** How much recipe metadata should the BrewPad editor expose?
- **Options:** Full parity with admin (rec) / Focused subset / You decide
- **Selected:** Full parity with admin → **D-05**, **D-06** (inline activation guardrail)

### Wrap-up
- **Q:** More to discuss, or ready for context?
- **Selected:** Ready for context — delete-confirm UX, offline-write handling, and cache invalidation left to research/planning.

## Deferred / Out of Scope Noted
- Recipe versioning/edit history (future milestone, per REQUIREMENTS.md).
- Per-ingredient scaling overrides, unit conversion, customer-facing recipe config (future milestone).

## Claude's Discretion
- Delete-confirm UX, offline PWA write behavior, recipe-cache invalidation timing, grouped-ingredient detail view (reuse Phase 34 helper).

---
*Phase: 37-brewpad-recipe-manager*
