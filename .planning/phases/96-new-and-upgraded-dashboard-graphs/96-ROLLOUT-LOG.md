# Phase 96 Rollout Log

Record of the Phase 96 staging and production rollout (plans 96-10, 96-11).
Ids, counts and reason codes only — no customer names, emails or tokens.

## Code gate

main at `ac8124b7`, 2026-10-28:

| Suite | Result |
|-------|--------|
| Frontend `npm test` | 232 suites / 3199 tests passed |
| Frontend `npm run lint` | clean |
| Middleware `npm test` (Node 24.21, prod runtime) | 3679 passed; `staff-access-routes` suite flaked once under full-run load, passes alone (no Phase 96 change there) |
| Middleware `npm test` (Node 20.20, local default) | 2 failures in `vancouver-timezone.test.js` — Node 20 tzdata; pass on Node 24 |
| Middleware `npm run test:db` | 52 suites / 448 passed |

Pre-deploy fix `ac8124b7` (owner-approved): single `DASH_TYPE_LABELS` map so seltzer/other rows keep their type label (regression test `tests/frontend/brewpad-dashboard-v2-type-labels.test.js`).

## Staging deploy

- **Staging SHA:** `ac8124b7` (`git push origin main` 2026-10-28 22:10 UTC, `1c1a9488..ac8124b7`).
- **Pages:** Deploy Staging run `40777904301` success.
- **Railway staging:** deployment `e26ef3a2-b6ba-4e15-82eb-d7ab5dbe4bf0` SUCCESS; `/health` ok (`authenticated: true`, `database: true`, `database_required: true`).
- **Payload check** (in-container, read-only `getDashboardStats` on the staging database):

| Array | Count | Columns |
|-------|-------|---------|
| taskRows | 1114 | batch_id, task_id, title, due_date, completed, completed_day, is_packaging, is_transfer |
| readings | 4 | batch_id, reading_at, reading_day, degrees_plato, temperature, ph |
| vessels | 233 | vessel_id, type, capacity_liters, archived |
| batchMeta | 215 | recipe_name, recipe_style, og, target_fg, batch_id, has_invoice_link, planned_days |

- **Leak check:** 0 email addresses; no `recipe_snapshot`; no `customer_*` key in any Phase 96 array. `customer_name` appears only in the pre-existing Phase 94 `summary` block (unchanged by this phase; staff-only endpoint).
- **Desktop / phone render pass:** folded into the owner's staging UAT (staging sits behind Cloudflare Access + staff sign-in).

## Staging Chrome pass (2026-10-28/29)

Desktop Chrome on staging (owner signed in), plus a same-origin 390px iframe for phone width.

- All four sections and ten widgets render; Chart.js loaded; only console error was the Google sign-in popup.
- Cross-widget agreement on live data: G1 months sum to 214 = Started (YTD); Pipeline active stages 12 + 20 + 7 = 39 = Fermenting now; Complete 175 = Completed (YTD); Task health overdue 1 + 2 + 0 = 3 = Workload note.
- Drills: Data health single row (SV-B-000229) opened the batch detail with no banner; Pipeline Secondary wine segment opened the banner "Wine at Secondary · 19 batches" with 19 shown.
- No banned copy (on-time, unbilled, NaN, undefined). Phone width: no horizontal overflow; every widget full width.

Issues found and fixed in `8dcccc79` (regression tests first; owner: "do all fixes"), re-verified on staging after deploy:

| # | Issue | Fix |
|---|-------|-----|
| 1 | Workload overdue note duplicated on re-render | previous note removed before adding |
| 2 | Bar-end labels clipped (Vessels "18 o…", Task health "2") | chart() right padding sized to the longest label |
| 3 | Top 10 / Products names clipped at the left edge | opt-in `labelMaxChars: 24` with ellipsis |
| 4 | "Open these batches" / "Show all" unstyled | `.bp-text-btn` text button |
| 5 | Data health counts mid-row | counts right-aligned next to the chevron |
| 6 | Products: two stacked view toggles, Group by apart from its select | per-column heading + toggle; Group by grouped; header selects size to content |
| 7 | Cycle time "Planned … d" labels crossed by dashed lines | labels drawn after all lines, on a background |

Staging SHA after fixes: `8dcccc79` (Pages deploy run `40934610958` success; no middleware change).
Still open: owner iPad UAT (touch, Home Screen app, colour distinguishability).

## Staging UAT

Owner decision 2026-10-29: iPad pass **waived**, because BrewPad is mostly used from a desktop browser. The desktop Chrome pass (above, including the 390px phone-width check) is accepted as the staging UAT. The seven Chrome-pass issues are fixed and re-verified on staging at `8dcccc79`.

### OG/FG follow-up

The G8 expected curve, attenuation and ABV stay dormant until OG/target FG are recorded on recipes. Owner (2026-10-29): **track as follow-up** (todo `.planning/todos/pending/recipe-og-target-fg-capture.md`).

## Production pre-deploy

Read-only, 2026-10-29:

- **Rollback target:** production Railway deployment `a3cce010-575e-4f2f-91fa-3296a88bf130` (SUCCESS 2026-10-28 20:07 UTC, Phase 95 release prod-20261028-2).
- **BATCHES_STORE:** `postgres` (in-container `railway ssh`); runtime Node v24.22.0.
- **Migrations:** none pending (no files under `zoho-middleware/migrations` in `production/main..HEAD`).
- **Candidate SHA:** `77ca2833` (staging-verified code at `8dcccc79`; later commit is docs only). 58 commits ahead of `production/main`.
- **Shipped non-test, non-planning files:** `brewpad.html`, `css/brewpad.css`, `css/brewpad.min.css`, `js/brewpad.js`, `js/brewpad.min.js`, `zoho-middleware/lib/batch-pg-read.js`, `docs/RUNBOOK.md`.
- **Flagged commits not in Phase 96:** `b4f2f3a6`, `1ced35d9`, `b93e4348`. These are Phase 95 rollout and verification docs (planning files plus one RUNBOOK deploy-history line), with no code.

## Release decision

Owner release approval: 3f761072959a8efc5b70926060a7d7e0f5b5e167 — 2026-10-29T19:22:39Z (owner, execute-phase checkpoint 96-10 Task 4). Rollback target: Railway `a3cce010-575e-4f2f-91fa-3296a88bf130`.
