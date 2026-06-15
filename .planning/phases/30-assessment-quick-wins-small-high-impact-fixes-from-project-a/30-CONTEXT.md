# Phase 30: Assessment Quick Wins — Context

**Gathered:** 2026-06-15
**Status:** Ready for planning

<domain>
## Phase Boundary

Execute the curated list of 21 small, high-impact fixes captured in `30-QUICK-WINS.md` (sourced from `PROJECT_ASSESSMENT.md`, 2026-06-10). Categories: user-facing live-bug fixes (#1–6), security hardening (#7–9), dead-weight removal (#10–14), repo hygiene (#15–16), config/infra (#17–20), and test-config cleanup (#21). Each item is ~under 30 minutes and already specified with exact `file:line` + fix.

This phase clarifies HOW to ship those fixes and resolves the handful of items that needed an owner decision. It does NOT add new product capabilities — anything beyond the 21 listed items is out of scope and belongs in its own phase.
</domain>

<decisions>
## Implementation Decisions

### Repo hygiene — `.planning/` exposure (item #15)
- **D-01:** Stop `.planning/` from serving publicly **by excluding it at the deploy layer, keeping it tracked in git.** Do NOT `git rm --cached` / untrack it — preserving the full GSD planning history in version control is required (GSD `commit_docs=true` convention stays intact). The planner/researcher should determine the exclusion mechanism (e.g. GitHub Pages Jekyll `exclude:` in `_config.yml`, a `.nojekyll`-aware build-time strip, or equivalent) that removes `.planning/` from the published site on BOTH staging and prod without removing it from the repo. Verify after deploy that `.planning/` paths 404 on the live site while still present in the repo.

### Beer waitlist form (item #2)
- **D-02:** Fix the silently-discarding waitlist form by **routing it through the existing `/api/contact` endpoint** (same path the contact form uses) so signups are actually captured + emailed. Replace the placeholder Google Form POST (`js/modules/12-checkout.js:1693`, section `index.html:227-231`); remove the fake-success behavior. Reuse existing contact-form plumbing (reCAPTCHA, validation, mailer) rather than introducing new infra. Rebuild bundles after the JS change.

### Human / infra items (items #17–18)
- **D-03:** Keep the non-code dashboard/external actions **in this phase as a tracked human checklist** (owner-action items), so they aren't lost: #17 verify Railway env vars (`REDIS_ENCRYPTION_KEY` → closes #106, `HELCIM_WEBHOOK_SECRET`, `RECAPTCHA_SECRET_KEY`, `SENTRY_DSN`) and #18 stand up an uptime monitor on middleware `/health`. The planner should surface these as explicit "human action required" tasks, not auto-completable code tasks. Code/config items #19 (railway.toml `watchPatterns`), #20 (node-cron upgrade), and #21 (jest config cleanup) are executed normally.

### Deploy cadence (cross-cutting)
- **D-04:** Ship the 21 items in **risk-batched staging checkpoints**, not one monolithic deploy. Suggested grouping (planner refines into waves): (a) dead-weight removal + repo hygiene deletes (#10–14, low risk), (b) user-facing bug fixes (#1–6), (c) security fixes (#7–9, payment-adjacent — items #7/#8 touch kiosk/admin staff UI and MUST be verified on the staging kiosk after deploy), (d) config/infra + test cleanup (#19–21). Each batch: `git push origin main` → human approval on staging → promote to prod. Staging-first is mandatory; nothing goes straight to prod.

### Claude's Discretion
- Exact wave/batch composition and ordering within the risk groups above — planner decides, honoring D-04's risk grouping and the "verify items #7/#8 on staging kiosk" constraint.
- Implementation mechanism for D-01's deploy-layer exclusion (research task).
- Item #16 (untrack CNAME via `git rm --cached`): flagged for careful sequencing — see Specific Ideas. Mechanism/timing at planner discretion, but must not break the prod-deploy CNAME process.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase source (the authoritative item list)
- `.planning/phases/30-assessment-quick-wins-small-high-impact-fixes-from-project-a/30-QUICK-WINS.md` — the committed copy of all 21 items with exact `file:line` locations and fixes. This is the primary work list.
- `PROJECT_ASSESSMENT.md` (repo root, **gitignored** — do not commit/deploy) — the original assessment the quick-wins list was distilled from; richer rationale per item if needed.

### Project conventions / constraints
- `CLAUDE.md` (repo root) — ES5/`var` rules, `npm run build` requirement, never edit `js/main.js`/`*.min.js` directly, both-test-suites-before-commit rule, staging→prod deploy commands.
- No external ADRs/specs beyond the above — each item is self-contained with its own `file:line` target.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `/api/contact` endpoint + existing contact-form client wiring (reCAPTCHA, validation, mailer) — reused for the beer waitlist fix (D-02).
- Canonical `escapeHTML` in `js/lib/utils.js:6` (has apostrophe escaping) — the target for items #7/#8; weak shadow copies live in `brewpad.js:6`, `02-utils.js:97`, `kiosk.js:526`.
- Prototype-pollution guard pattern at `js/modules/17-search-overlay.js:176` (also in `16-catalog-subpage.js`) — copy into `07-catalog-kits.js:87-93` for item #9.
- `var(--color-muted)` CSS token — replaces hardcoded `#777` for contrast fixes (item #5).

### Established Patterns
- Build pipeline: `npm run build` regenerates `js/main.js` + `*.min.js` and stamps cache-busters across HTML. Items touching JS (#2, #7, #8, #9) and the `concat:js` script change (#8) require a rebuild + committing regenerated bundles.
- Content loader (`js/modules/13-init.js`) overwrites HTML copy from `content/*.json` at runtime — root cause of items #1 (hero subtitle) and #6 (empty story paragraph).
- BrewPad dashboard is a PWA with a service worker (separate from the dead `sw.js` in item #14) — note the service-worker cache gotcha when verifying staff-UI changes.

### Integration Points
- Staging calls the **prod** middleware (no separate staging middleware instance) — config/infra changes (#19, #20) deploy to Railway and affect prod immediately; verify carefully.
- GitHub Pages serves the repo root publicly — drives items #10–14 (dead files served publicly) and #15 (`.planning/` exposure).

</code_context>

<specifics>
## Specific Ideas

- **Item #16 (untrack CNAME) interacts with the prod-deploy process.** CNAME is currently **tracked** (not gitignored as the quick-wins note assumed). The prod deploy currently relies on a CNAME-swap (set `steinsandvines.ca` → `git push production main --force` → restore `staging.steinsandvines.ca` → push origin). `enforce-cname.yml` self-heals the domain after every push, so untracking CNAME is safe — but the planner must sequence item #16 so it doesn't strand a wrong CNAME mid-deploy, and should confirm the swap dance is retired once CNAME is untracked.
- Items #7 and #8 are payment-adjacent (kiosk/admin staff POS context) — explicit human verification on the **staging kiosk** is required after their batch deploys (ties to D-04 batch c).
- Item #8 carries build risk: adding `js/lib/utils.js` to `concat:js` must not double-define `escapeHTML`; verify concat ordering and run the full frontend suite.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope. Any work beyond the 21 listed quick-wins items is out of scope for Phase 30 and would be its own phase/backlog item.

</deferred>

---

*Phase: 30-assessment-quick-wins-small-high-impact-fixes-from-project-a*
*Context gathered: 2026-06-15*
