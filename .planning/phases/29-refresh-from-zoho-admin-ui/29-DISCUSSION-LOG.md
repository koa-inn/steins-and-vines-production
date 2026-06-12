# Phase 29: Refresh-from-Zoho Admin UI - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-11
**Phase:** 29-Refresh-from-Zoho Admin UI
**Areas discussed:** Which surface(s), Displayed customer info, Unlinked-batch state, Refresh flow & feedback

---

## Which surface(s)

| Option | Description | Selected |
|--------|-------------|----------|
| Both surfaces (Recommended) | BrewPad detail pane (iPad-first, has Zoho/Invoice section) AND admin Batches modal | ✓ |
| BrewPad only | Zoho-aware surface; admin stays Zoho-free | |
| Admin modal only | Literal roadmap reading; admin.js has zero Zoho awareness today | |

**User's choice:** Both surfaces

| Option | Description | Selected |
|--------|-------------|----------|
| New Zoho row + button (Recommended) | 'Zoho Ref: INV-…' line in admin info grid with Refresh button beside it; BrewPad button in existing Invoice section | ✓ |
| Button in actions row only | Footer button next to Print Label/Delete; no visible Zoho ref | |
| You decide | Planner picks placement | |

**User's choice:** New Zoho row + button
**Notes:** Discovery during scouting: roadmap's "batch detail modal" is ambiguous — admin.js has no `zoho_so_number` references while brewpad.js already has a full Invoice section.

---

## Displayed customer info

| Option | Description | Selected |
|--------|-------------|----------|
| Show email + phone (Recommended) | Add Email/Phone rows to both detail views | ✓ |
| Name only, fields update silently | Sheet fields update invisibly | |
| Show on refresh result only | One-time result message, no permanent rows | |

**User's choice:** Show email + phone

| Option | Description | Selected |
|--------|-------------|----------|
| In-place field update (Recommended) | Update only the name/email/phone DOM nodes + cached batch object | ✓ |
| Re-fetch & re-render detail | openBatchDetail re-render; loses scroll position | |
| You decide | Planner picks per surface | |

**User's choice:** In-place field update
**Notes:** Planner note added: also patch list-row caches (_batchesData, sessionStorage per-batch, admin list) to avoid stale names.

---

## Unlinked-batch state

| Option | Description | Selected |
|--------|-------------|----------|
| Hidden, link UI explains (Recommended) | Button doesn't render; BrewPad's 'Link to Invoice' is the affordance; admin row shows 'Not linked' | ✓ |
| Disabled with explanation | Greyed-out button with explanatory text | |
| You decide | Planner picks per surface | |

**User's choice:** Hidden, link UI explains

| Option | Description | Selected |
|--------|-------------|----------|
| Yes, gate on format (Recommended) | Render only when zoho_so_number matches /^(INV\|SO)-\d+$/i | ✓ |
| Presence only, handle 400 as error | Show button for any value; 400 surfaces as toast | |
| You decide | Planner checks actual sheet values | |

**User's choice:** Yes, gate on format

---

## Refresh flow & feedback

| Option | Description | Selected |
|--------|-------------|----------|
| One-click apply (Recommended) | Click → spinner → fields update + toast; refresh is non-destructive (Phase 28 D-02) | ✓ |
| Preview diff, then confirm | Fetch first, show diff, apply on OK | |
| Confirm only when name changes | Silent for email/phone, confirm on name change | |

**User's choice:** One-click apply

| Option | Description | Selected |
|--------|-------------|----------|
| Distinct toasts per state (Recommended) | Success / already-up-to-date / partial / not-found / Zoho-down messages | ✓ |
| Simple success/fail | Just 'Updated' or 'Refresh failed' | |
| You decide | Planner maps states to messages | |

**User's choice:** Distinct toasts per state

| Option | Description | Selected |
|--------|-------------|----------|
| Warn in toast, still apply (Recommended) | Apply refresh; warning toast notes the document is void | ✓ |
| Ignore status | Treat voided like any success | |
| Block with message | Don't apply from voided docs | |

**User's choice:** Warn in toast, still apply

| Option | Description | Selected |
|--------|-------------|----------|
| Skip write, toast only (Recommended) | If fetched == current, 'Already up to date', no update_batch call | ✓ |
| Always write | Always call update_batch; bumps version for nothing | |
| You decide | Planner picks | |

**User's choice:** Skip write, toast only

---

## Claude's Discretion

- Exact button label/styling per surface (follow `admin-btn-sm` / `bp-btn-sm` conventions)
- Loading-state mechanics and exact toast wording (D-10/D-11 semantics must hold)
- No-change comparison whitespace/case handling
- Optimistic-lock conflict handling (follow existing stale-version pattern)
- Test structure (Jest jsdom patterns in `tests/frontend/`)
- Whether admin "Not linked" row renders for all batches or only when relevant

## Deferred Ideas

- Manual SO-linking in the admin modal (BrewPad has it; admin only displays "Not linked") — overlaps existing Future Requirements entry
- REQUIREMENTS.md prematurely ticks ZSYNC-01/02 `[x]` — bookkeeping fix at phase completion
