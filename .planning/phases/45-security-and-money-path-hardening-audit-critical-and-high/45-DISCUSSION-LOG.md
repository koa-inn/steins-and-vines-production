# Phase 45: Security and Money-Path Hardening - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-29
**Phase:** 45-security-and-money-path-hardening-audit-critical-and-high
**Areas discussed:** Auth re-architecture, Redis-outage policy, Money-path depth + Phase 42, Sequencing + deploy

---

## Auth re-architecture

Clarification volunteered by owner: the kiosk is a single iPad that never leaves the store and is on the store WiFi.

### Q1 — Kiosk network / interim containment viability
| Option | Description | Selected |
|--------|-------------|----------|
| Fixed IP/network | Stable store IP — allowlist is cheap interim | |
| Single managed device | One managed iPad — pin to device | ✓ (via clarification) |
| Not fixed / varies | Varying/remote networks | |
| Not sure | — | |

**User's choice:** Clarified directly — "it's on an iPad that doesn't leave the store and is on the store wifi" → single managed in-store device on store network.

### Q2 — Admin panel access pattern
| Option | Description | Selected |
|--------|-------------|----------|
| In-store iPad only | Network+device trust covers admin too | |
| Also from other devices | Admin needs per-user Google OAuth | ✓ |
| Mostly iPad, occasionally elsewhere | Lean OAuth on admin | |
| Not sure | OAuth default | |

**User's choice:** Also from other devices → admin requires real per-user Google OAuth.

### Q3 — Kiosk login model
| Option | Description | Selected |
|--------|-------------|----------|
| Trusted shared terminal | One device-bound session; no per-sale login | ✓ |
| Per-staff login | Per-person audit trail, more friction | |
| You decide | — | |

**User's choice:** Trusted shared terminal.

### Q4 — Rotate timing
| Option | Description | Selected |
|--------|-------------|----------|
| At cutover with the fix | No staff breakage; leaked key valid until cutover | ✓ |
| Rotate now + interim | Kill exposure today, minor scramble | |
| You decide | — | |

**User's choice:** Rotate at cutover with the fix.

**Notes:** iPad-never-leaves-store + store WiFi makes device/network trust a legitimate boundary for the kiosk; admin is the broader/more-sensitive surface used off-site, so it splits to OAuth.

---

## Redis-outage policy

### Q1 — Outage stance for the money path
| Option | Description | Selected |
|--------|-------------|----------|
| Keep selling (in-process) | Per-process fallback; counter keeps working | ✓ |
| Fail-closed (halt) | Reject payments until Redis recovers | |
| Split by guard | Keep selling for payment, PIN always-on | (folded in) |

**User's choice:** Keep selling (in-process). PIN brute-force kept always-on in-process (folded from the split option).

### Q2 — Instance count (fact)
| Option | Description | Selected |
|--------|-------------|----------|
| Single instance | In-process fallback covers all traffic | ✓ |
| Multiple instances | Per-replica only; cross-instance risk | |
| Not sure | — | |

**User's choice:** Single instance → in-process MemoryStore fallback is full coverage, low risk.

---

## Money-path depth + Phase 42

Clarification: kiosk money-path findings are all backend (`routes/pos.js` + `lib`); Phase 42 de-fork is frontend — largely independent.

### Q1 — Orphan-charge defense depth
| Option | Description | Selected |
|--------|-------------|----------|
| Void + reconciliation backstop | Sync void + async Helcim↔Zoho reconcile | (Claude decided ✓) |
| Synchronous void only | Lighter; late-approval orphans still possible | |
| You decide | — | ✓ |

**User's choice:** You decide → Claude chose Void + reconciliation backstop (separable task), because a real orphan already occurred and sync void can't catch late terminal approval after timeout. Absorbs incident #107.

### Q2 — Phase 42 coordination
| Option | Description | Selected |
|--------|-------------|----------|
| Backend-first, independent | Harden pos.js + lib now, P42 frontend separate | (Claude decided ✓) |
| Pull P42 forward / bundle | Converge frontend + backend together | |
| You decide | — | ✓ |

**User's choice:** You decide → Claude chose backend-first, independent. Frontend "Confirm Manually" Medium deferred to 46+/P42.

---

## Sequencing + deploy

### Q1 — First wave
| Option | Description | Selected |
|--------|-------------|----------|
| First wave now | Land + deploy quick-wins to prod immediately | ✓ |
| Hold for full phase | One release at the end | |
| First wave, staging only | Stop at staging | |

**User's choice:** First wave now (incl. prod `railway up` for the committed middleware fixes + PII-route guard + PIN check + dump.rdb).

### Q2 — Gift-card + Phase 44 UAT
| Option | Description | Selected |
|--------|-------------|----------|
| Bundle the verification | One live test session covers P44 UAT + split-tender fix | ✓ |
| Handle separately | Independent tracks | |
| You decide | — | |

**User's choice:** Bundle the verification with Phase 44's deferred live gift-card UAT.

---

## Claude's Discretion

- Orphan-charge defense depth (D-13): chose void + bounded reconciliation backstop (separable).
- Phase 42 coordination (D-14): chose backend-first, independent.

## Deferred Ideas

- All medium/low/info audit findings → phases 46+ (mobile a11y, coverage floors/lint gate, webhook dedup, Sentry money-path, deps hygiene).
- Frontend `kiosk.js` "Confirm Manually" phantom-payment (Medium) → with Phase 42 de-fork.
- Split candidates if Phase 45 grows: auth re-architecture and the reconciliation backstop.
