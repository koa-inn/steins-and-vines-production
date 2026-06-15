# Phase 30: Assessment Quick Wins - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-15
**Phase:** 30-assessment-quick-wins-small-high-impact-fixes-from-project-a
**Areas discussed:** .planning/ untracking (#15), Beer waitlist fix (#2), Human/infra items scope (#17–18), Deploy cadence / batching

---

## .planning/ exposure (#15)

| Option | Description | Selected |
|--------|-------------|----------|
| Exclude from deploy, keep tracked | Strip/exclude `.planning/` at the deploy layer; stays versioned in git; preserves GSD history | ✓ |
| Untrack + gitignore | `git rm -r --cached .planning` + gitignore; simplest but ends git versioning and conflicts with GSD commit_docs | |
| Leave as-is | Accept public exposure for now; skip item 15 | |

**User's choice:** Exclude from deploy, keep tracked
**Notes:** Preserving full GSD planning history in git was the priority; mechanism (Pages exclude vs build-time strip) left to research/planning.

---

## Beer waitlist fix (#2)

| Option | Description | Selected |
|--------|-------------|----------|
| Route through /api/contact | Reuse existing contact endpoint so signups are captured + emailed | ✓ |
| Hide the section | Remove the broken fake-success block entirely | |
| Wire a real Google Form | Plug in a real Google Form + entry IDs | |

**User's choice:** Route through /api/contact
**Notes:** Wants to keep collecting beer interest with real capture; reuse existing plumbing, no new infra.

---

## Human/infra items scope (#17–18)

| Option | Description | Selected |
|--------|-------------|----------|
| Track in-phase as human checklist | Capture 17 & 18 as owner-action items in the phase; code items 19–21 executed normally | ✓ |
| Split out as separate to-dos | Phase = code/config only; 17 & 18 handled outside | |

**User's choice:** Track in-phase as human checklist
**Notes:** Keep dashboard/external actions visible in the phase so they aren't lost.

---

## Deploy cadence / batching

| Option | Description | Selected |
|--------|-------------|----------|
| Batched by risk | Staged checkpoints: hygiene/deletes → user-facing → security (kiosk-verify 7/8) → config/test; each its own approval | ✓ |
| All-in-one | Single staging push for all 21, one approval, then prod | |

**User's choice:** Batched by risk
**Notes:** 21 items too many for one approval; risk grouping makes regressions easier to bisect.

---

## Claude's Discretion

- Exact wave composition/ordering within the risk groups (planner decides, honoring risk grouping + kiosk-verify constraint for items 7/8).
- Deploy-layer exclusion mechanism for `.planning/` (research task).
- Item #16 (untrack CNAME) sequencing/timing — flagged for careful handling vs the prod-deploy CNAME process; `enforce-cname.yml` self-heals.

## Deferred Ideas

None — discussion stayed within phase scope.
