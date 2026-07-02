# Phase 46: Auth Re-Architecture (CRITICAL — split from Phase 45) - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-07-02
**Phase:** 46-auth-re-architecture-critical-split-from-phase-45
**Areas discussed:** Kiosk device credential, Admin login & sessions, Staff surface coverage, Cutover & rotation logistics

---

## Kiosk device credential

| Option | Description | Selected |
|--------|-------------|----------|
| Typed-in device token (Recommended) | Owner-generated long token entered once via hidden settings prompt; localStorage; revoke = rotate env var; staff PIN still gates on top | ✓ |
| One-time pairing code flow | Short-lived pairing code exchanged for a server-tracked device token; nicer provisioning, biggest build | |
| PIN-unlocked day sessions | No standing device secret; staff PIN mints ~14h sessions daily; PIN becomes the bootstrap secret | |

**User's choice:** Typed-in device token

| Option | Description | Selected |
|--------|-------------|----------|
| Kiosk-scoped only (Recommended) | Token works for kiosk endpoints only; admin-grade routes require separate auth | ✓ |
| Full-power like today | Token replaces the current key 1:1 — re-creates the full-admin-token risk class | |
| You decide | Claude picks the split during planning | |

**User's choice:** Kiosk-scoped only

| Option | Description | Selected |
|--------|-------------|----------|
| Re-enter from password manager (Recommended) | Token in owner's password manager + Railway env; trusted staff or owner-by-phone re-enters in ~30s | ✓ |
| Owner-only re-entry | Tightest control; a cleared cache while owner is away halts kiosk card sales | |
| Backup pairing code | Break-glass recovery code path; re-adds pairing-flow build | |

**User's choice:** Re-enter from password manager

| Option | Description | Selected |
|--------|-------------|----------|
| Until manually rotated (Recommended) | No expiry; rotate on staff departure / suspected leak | ✓ |
| Scheduled rotation (e.g. quarterly) | Expiry on a schedule; missed rotation bricks the kiosk | |

**User's choice:** Until manually rotated

---

## Admin login & sessions

| Option | Description | Selected |
|--------|-------------|----------|
| Google login there too (Recommended) | Admin is admin everywhere incl. store iPad; per-person attribution; device token stays kiosk-scoped | ✓ |
| Device token unlocks admin on the iPad | No in-store friction but iPad token becomes admin-grade, undoing the scope decision | |
| Hybrid: PIN elevates on iPad | PIN-elevation window on the provisioned device; second elevation mechanism to maintain | |

**User's choice:** Google login there too

| Option | Description | Selected |
|--------|-------------|----------|
| Server session cookie, ~7 days (Recommended) | Verify ID token once → httpOnly Redis-backed cookie; weekly-ish sign-in; revocable | ✓ |
| Google token per request, ~1 hour | No server sessions; hourly silent-refresh hiccups become login prompts | |
| You decide | Claude picks in planning | |

**User's choice:** Server session cookie, ~7 days

| Option | Description | Selected |
|--------|-------------|----------|
| Railway env var (Recommended) | STAFF_EMAILS-style comma list; matches existing config management | ✓ |
| Google Sheet | Editable without Railway but adds Apps Script dependency to the auth path | |
| You decide | Claude picks in planning | |

**User's choice:** Railway env var

| Option | Description | Selected |
|--------|-------------|----------|
| Everyone equal (Recommended) | One allowlist, one privilege level; attribution via Google identity | ✓ |
| Owner tier for sensitive actions | OWNER_EMAILS gating voids/payouts; more control, owner becomes bottleneck | |

**User's choice:** Everyone equal

---

## Staff surface coverage

| Option | Description | Selected |
|--------|-------------|----------|
| Same session model as admin (Recommended) | BrewPad points its existing Google sign-in at the new server session; key dropped from brewpad.js | ✓ |
| Minimal touch: key removal only | Smallest rotation-surviving change; second migration later | |
| You decide | Claude assesses BrewPad's calls in research | |

**User's choice:** Same session model as admin

| Option | Description | Selected |
|--------|-------------|----------|
| Yes, keyless public pages (Recommended) | Public bundles stop sending x-api-key; research verifies the POST at 12-checkout.js:1512 | ✓ |
| Discuss the public POST now | Resolve that endpoint's treatment in this discussion | |

**User's choice:** Yes, keyless public pages
**Notes:** Area closed by Claude's judgment after a 60s no-response timeout on the "more questions?" check (both substantive questions were answered; assumption recorded and surfaced to the user, who resumed without objection).

---

## Cutover & rotation logistics

| Option | Description | Selected |
|--------|-------------|----------|
| Dual-accept window (Recommended) | Old key + new auth both accepted; migrate surface-by-surface; rotate to end the window | ✓ |
| Big-bang cutover | One deploy switches auth and rotates; any missed call site breaks with no fallback | |
| You decide | Claude picks in planning | |

**User's choice:** Dual-accept window

| Option | Description | Selected |
|--------|-------------|----------|
| Days, not weeks (Recommended) | Rotate within ~2–3 business days; scheduled owner action with checklist | ✓ |
| Same day | Provision+verify+rotate in one visit; no soak | |
| Open-ended until comfortable | Window risks never closing; CRITICAL persists | |

**User's choice:** Days, not weeks

| Option | Description | Selected |
|--------|-------------|----------|
| Skip it (Recommended) | D-05 interim IP allowlist not worth it: Wave-1 shipped, cutover near, store IP may be dynamic | ✓ |
| Build it as a stopgap | Throwaway mechanism + dynamic-IP fragility | |

**User's choice:** Skip it — D-05 formally closed as "not needed"

---

## Claude's Discretion

- Exact endpoint split for the kiosk-scoped token (from the real kiosk.js call inventory)
- Device-token header/storage naming; settings-prompt UX
- Session store implementation (Redis key shape, TTL refresh), sign-out affordance, unauthenticated admin/brewpad UX
- Old-key canary logging after rotation
- Treatment of the public POST at js/modules/12-checkout.js:1512 (pending research)

## Deferred Ideas

- Owner privilege tier (revisit if team grows)
- Break-glass kiosk recovery code (revisit if password-manager recovery proves painful)
- Scheduled token rotation
- Unauthenticated/enumerable gift-card lookup GET (audit Low) — phases 47+ unless free to fold in
