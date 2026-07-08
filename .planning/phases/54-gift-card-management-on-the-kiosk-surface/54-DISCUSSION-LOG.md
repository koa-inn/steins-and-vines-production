# Phase 54: Gift-Card Management on the Kiosk Surface - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-07-08
**Phase:** 54-gift-card-management-on-the-kiosk-surface
**Areas discussed:** Entry-point placement, Void confirmation UX, Admin panel repoint-or-leave, Management scope

**Format note:** Gray areas were presented as a multi-select picker; the user declined the picker and confirmed a full set of recommended decisions in one pass ("looks good"). Options considered are preserved below.

---

## Entry-point placement

| Option | Description | Selected |
|--------|-------------|----------|
| Hidden kiosk settings area | Behind the existing device-token/PIN gear | ✓ |
| Main POS toolbar button | Prominent on the sales screen | |
| Inside existing gift-card menu | Grouped with sell/redeem | |

**User's choice:** Hidden kiosk settings area.
**Notes:** Void is money-destroying; keeping management off the sales screen prevents a mistap during a busy sale from reaching it. Consistent with the device-token settings placement.

---

## Void confirmation UX

| Option | Description | Selected |
|--------|-------------|----------|
| Keep admin two-step (reason required) | lookup → Void → reason → Confirm, "cannot be undone" | ✓ |
| Add friction (type cert # to confirm) | Extra confirmation step | |
| Trim to minimal confirm | Single-tap confirm | |

**User's choice:** Keep admin two-step, reason required. No manager-PIN (declined earlier), no type-cert friction.
**Notes:** Two-step + mandatory reason + irreversible-warning matches server enforcement and the admin flow staff may already know.

---

## Admin panel: repoint or leave

| Option | Description | Selected |
|--------|-------------|----------|
| Leave admin's modal as-is | Only add the kiosk surface; smaller scope | ✓ |
| Repoint admin to shared panel | Retire admin.js duplicate now | |

**User's choice:** Leave admin's existing `kgcm-*` modal untouched. Author shared panel in kiosk-core; wire only the kiosk entry.
**Notes:** Owner doesn't use admin; retiring the duplicate is a deferred follow-up folding into Phase 48's disclosed admin-duplicate cleanup.

---

## Management scope

| Option | Description | Selected |
|--------|-------------|----------|
| Lookup + void only | Issue/reload stay in cart+terminal | ✓ |
| Add issue/reload UI | Full lifecycle on the panel | |

**User's choice:** Lookup + void only.
**Notes:** Issue/reload already run through the kiosk cart + Helcim terminal (Phase 44). No new issue/reload surface.

---

## Claude's Discretion

- Exact `kgcm-*` element IDs, overlay markup, and dismissal — mirror the kiosk-native `kgcr-` redeem pattern.
- Whether the regression test is a new file or extends an existing kiosk gift-card test.

## Deferred Ideas

- Retire admin's duplicate `kgcm-*` modal by repointing `admin.html` to the shared panel (folds into Phase 48 cleanup follow-up).
- Manager-PIN gate on void (declined for now; future hardening option).
- Todo *"auto-clear selected customer after a sale"* — reviewed, not folded (distinct sales-flow feature).
