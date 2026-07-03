# Phase 48: Kiosk POS De-Fork — Discussion Log

**Date:** 2026-07-03
**Mode:** discuss (default)

> Human-reference record of the discussion. Not consumed by downstream agents — see `48-CONTEXT.md` for the authoritative decisions.

## Area 1 — Module boundary / exposure
**Options presented:**
- Single `window.KioskCore` namespace (IIFE attaches one object; explicit seam)
- Adopt the `window.SV` namespace now (first module under future SV.*)
- Bare globals (minimal diff, no explicit seam)

**User selection:** "whatever you think is best, i dont really know the implications" — deferred to Claude.
**Resolution (Claude's discretion → D-01):** `window.KioskCore` namespace. Chosen for the explicit parity-test seam, to avoid `window.SV` scope creep (deferred), and for ES5/no-bundler fit.

## Area 2 — Standalone vs admin-embedded
**Options presented:**
- Truly identical, inject context
- Identical money-path, allow UI/host differences
- Surface the diffs first

**User selection:** Truly identical, inject context → D-02.
**Notes:** kiosk-core is context-agnostic; consumers inject only environment (mwUrl, mode, DOM roots). Existing divergence in the money/cart path is treated as accidental fork to unify.

## Area 3 — Parity verification depth
**Options presented:**
- Automated payload-parity test + iPad manual
- Rely on existing kiosk tests + iPad manual
- Maximal — full integration harness

**User selection:** Automated payload-parity test + iPad manual → D-03.
**Notes:** Existing kiosk tests must pass unchanged (no weakening); add an assertion that both surfaces emit identical fetch payloads for the same cart (SC#2); SC#5 iPad Safari sale from both surfaces is a human checkpoint.

## Area 4 — Product-type discount parity
**Options presented:**
- Purely identical on both
- Admin may need an override/visibility

**User selection:** Purely identical on both → D-04.
**Notes:** The one allowed behaviour change — discount moves into kiosk-core so admin-embedded gets it identically. No staff override.

## Deferred ideas
- `window.SV` namespace adoption — future phase.
- Kiosk adopting `money-path.js` primitives — Phase 50 (MONEY-02).

## Claude's discretion noted
- Exact `KioskCore` API surface + init signature.
- Build wiring for `kiosk-core.js` (separate script vs prepend-per-bundle) — flagged as the key research mechanic.
