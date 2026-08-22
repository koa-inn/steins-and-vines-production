---
phase: 72-beer-and-cider-launch-announcement-pages-beer-html-cider-htm
plan: 03
subsystem: ui
tags: [static-html, owner-checkpoint, runbook, deploy-handoff]

# Dependency graph
requires:
  - phase: 72-01
    provides: "beer.html and cider.html launch announcement pages"
  - phase: 72-02
    provides: "Beer + Cider nav links on all 17 public pages; homepage 'Now Available' launch banners; reconciled stale waitlist banner"
provides:
  - "72-PROMOTE-STEPS.md — owner-facing promote runbook + full placeholder-fill checklist + banner-disposition record"
  - "Owner sign-off: banner disposition + overall phase 72 first pass APPROVED"
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Executor-stops-at-staging / owner-only-prod-push handoff pattern for content-launch phases (locked decision, threat T-72-06)"

key-files:
  created:
    - .planning/phases/72-beer-and-cider-launch-announcement-pages-beer-html-cider-htm/72-PROMOTE-STEPS.md
    - .planning/phases/72-beer-and-cider-launch-announcement-pages-beer-html-cider-htm/72-03-SUMMARY.md
  modified: []

key-decisions:
  - "Owner approved the phase 72 first pass as-is at the Task 2 checkpoint (\"cool, seems good for the first pass\") — no revision requested"
  - "Owner implicitly confirmed the 72-02 banner disposition (repurpose stale 'Beer Is Coming' banner into a live Beer banner + add a new Cider banner, waitlist form + iframe removed) by approving without requesting a different disposition"

requirements-completed: [OWNER-LAUNCH-72]

# Metrics
duration: ~5min
completed: 2026-08-22
---

# Phase 72 Plan 03: Promote-Steps Runbook + Owner Checkpoint Summary

**Wrote the owner-facing promote-steps runbook aggregating 72-01/72-02 handoff (placeholder checklist, banner-disposition record, staging/production deploy steps) and closed the phase on owner approval — "cool, seems good for the first pass" — with no revision requested.**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-08-22T21:56:07Z
- **Completed:** 2026-08-22
- **Tasks:** 2 (1 auto, 1 checkpoint)
- **Files modified:** 2 (72-PROMOTE-STEPS.md created; this SUMMARY.md)

## Accomplishments
- `72-PROMOTE-STEPS.md` — command-accurate runbook: what shipped, 23-item placeholder-fill checklist across beer.html/cider.html/index.html, stale-banner disposition record, staging deploy + smoke-test steps, owner-only production promotion steps, post-promotion checklist
- Owner checkpoint (Task 2) presented; owner reviewed and approved the first pass with no revision requests
- Phase 72 closed: feature work complete, no production deploy performed by the executor (owner will promote after filling placeholder content)

## Task Commits

1. **Task 1: Write the promote-steps runbook + placeholder-fill checklist** - `d8726356` (docs)
2. **Task 2: Owner checkpoint (human-verify)** - no code commit (approval-only); recorded in this SUMMARY

**Plan metadata:** (this commit, to follow)

## Files Created/Modified
- `72-PROMOTE-STEPS.md` (190 lines) - Owner runbook: shipped-changes summary, full `[PLACEHOLDER: ...]` fill checklist (23 items across beer.html/cider.html/index.html), stale-banner disposition record, staging deploy + smoke-test steps, owner-only production promotion command, post-promotion checklist
- `72-03-SUMMARY.md` - This file

## Decisions Made
- **Owner checkpoint decision: APPROVED.** Owner's exact response: *"cool, seems good for the first pass."* No changes requested; no revision plan needed.
- **Banner disposition (72-02's REPURPOSE choice): confirmed by approval.** The owner did not request removing the Cider banner, restoring a waitlist, or any reordering — the disposition documented in `72-PROMOTE-STEPS.md` §3 (repurposed "Beer Is Coming" waitlist banner → live "Now Available" Beer banner; new base-style "Now Available" Cider banner added; waitlist `<form>` and orphaned `#beer-waitlist-iframe` both removed) stands as final.

## Deviations from Plan

None - plan executed exactly as written. Task 1 (runbook) and Task 2 (checkpoint) both completed per plan; owner approved on first pass with no revision loop needed.

## Issues Encountered
None.

## User Setup Required
None for this plan. Outstanding **owner action before production promotion** (documented in full in `72-PROMOTE-STEPS.md`):
1. Fill all 23 `[PLACEHOLDER: ...]` markers across `beer.html`, `cider.html`, and `index.html` (price, availability dates, what's-included, FAQ answers, CTA button text — see `72-PROMOTE-STEPS.md` §2 for the itemized list).
2. Run the staging smoke test (`72-PROMOTE-STEPS.md` §4) after filling placeholders.
3. Owner-only: `git push production main --force` (`72-PROMOTE-STEPS.md` §5) — the executor did not run this and will not run it.

## Banner Disposition (Final)

The homepage's stale "Beer Is Coming" waitlist banner (badge "Coming Soon", `<form>`, hidden `#beer-waitlist-iframe`) was **REPURPOSED, not removed**, by 72-02:
- The existing `.beer-banner beer-banner--green` block became a live "Now Available" Beer banner — badge/headline/subhead rewritten, waitlist form deleted, `.btn` CTA added linking to `beer.html`.
- A **new second banner** ("Now Available" Cider, base `.beer-banner` class with no `--green` modifier) was added immediately after, linking to `cider.html`.
- The orphaned `#beer-waitlist-iframe` was **removed entirely** (its form target no longer existed; `setupBeerWaitlistForm()` in `js/modules/12-checkout.js:1690` is null-guarded, so removal caused no JS regression).
- `content/home.json` was corrected (`beer-title`/`beer-text` updated, `cider-title`/`cider-text` added) so the runtime CMS-JSON override in `js/modules/13-init.js` does not silently revert the new banner text back to "Beer Is Coming" on page load.

**Owner confirmed this disposition** at the Task 2 checkpoint by approving the phase without requesting an alternative.

## What Shipped Across Phase 72 (72-01 + 72-02 + 72-03)

- **`beer.html`** — "Now Brewing: Craft Beer" launch page (about.html shell + index.html primitives), clean-URL `/beer`, beer-specific OG/Twitter tags.
- **`cider.html`** — "Now Fermenting: 100% Okanagan Juice Cider" launch page, same structure, clean-URL `/cider`.
- **Site-wide nav** — Beer + Cider links added to all 17 public pages (8 root pages, `404.html`, all 8 `products/*.html` pages); staff-only pages (admin/kiosk/brewpad/batch) untouched.
- **Homepage launch banners** — stale waitlist banner repurposed into a live Beer banner + new Cider banner added (see disposition above).
- **`sitemap.xml`** — `/beer` and `/cider` entries added (monthly, priority 0.7).
- **`package.json`** — `beer.html`/`cider.html` added to `stamp:pages` for cache-bust stamping.
- **`72-PROMOTE-STEPS.md`** — the owner-facing runbook produced by this plan.
- Full build/lint/test gate green on every task across all three plans: `npm run build`, `npm run lint` (`--max-warnings 0`), `npm test` (79/79 suites / 1095/1095 tests).

## Next Phase Readiness
Phase 72 feature work is complete and owner-approved on the first pass. Nothing further for the executor to do on this phase. Remaining work is entirely the owner's: fill the 23 placeholder markers, run the staging smoke test, then `git push production main --force` when ready. No follow-up plan is needed unless the owner requests changes after filling in real content.

---
*Phase: 72-beer-and-cider-launch-announcement-pages-beer-html-cider-htm*
*Completed: 2026-08-22*

## Self-Check: PASSED

- FOUND: .planning/phases/72-beer-and-cider-launch-announcement-pages-beer-html-cider-htm/72-PROMOTE-STEPS.md
- FOUND: d8726356 (Task 1 commit)
