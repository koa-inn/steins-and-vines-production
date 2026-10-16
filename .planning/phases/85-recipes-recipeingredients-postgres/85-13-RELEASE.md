# 85-13 + Node 24 production release plan

Drafted 2026-10-15. **Owner decisions are marked ⚑.** Nothing in this plan has touched production yet.

## Why one release

Two things need to reach production, and both are blocked on the same pinned SHA.
- **85-13** must deploy `d2c66be9` and never all of `main`. `main` carries Phase 86 code and migration 0004, plus Phase 89/90 work that is staging-only.
- **Node 24** (`abc4d42e`) must be live before **2026-11-01**. On that date Node 20.20.2 / tz 2025c starts treating America/Vancouver as UTC-8, while BC is permanently UTC-7.
  - Verified 2026-10-15 via `railway ssh`: production runs v20.20.2 with tz 2025c. Staging runs v24.21.0 with tz 2026c, and 2026-11-15 12:00Z correctly shows as PDT.

The 2026-10-13..15 kiosk recipe money-path fixes also sit after the pin. Production recipe sales stay disabled (`BEER_SALES_ENABLED=false`, set 2026-10-15) until those fixes ship.

## The release SHA

Local branch **`release/85-13-node24`** is `d2c66be9` plus 14 commits, all cherry-picked with `-x`:

| Commit on main | What |
|---|---|
| 6029ed7f | recipe sale charges under the kiosk's reference |
| 5404abea | manual recipe confirm verified against Helcim |
| 255c5e13 | captured-amount check before booking |
| 4849f473 | tax on recipe fees + invoice adjustment |
| 60d7b32f | kiosk shows the fee tax (build artifacts resolved to the pin, rebuilt below) |
| f4272eed | numeric Helcim txn id |
| ae191772 | payment after invoice submit |
| c10e8111 | reconcile the invoice total with the charge |
| 0cfbd181 | 3dp quantities + reconcile PUT keeps tax_id |
| 030846c4 | kiosk renders recipes after a background load |
| abc4d42e | Node 24 LTS (.nvmrc, engines, CI, tz regression test) |
| f6e6eff8 | kiosk receipt card no longer cut off on the iPad |
| (build) | one `npm run build` on Node 24 |
| 4a8267ab | test-only: pin the clock in the resetMonthToDefaults test |

Trial results on Node 24.21.0, 2026-10-15:
- No source-code conflicts.
- Root tests 2157/2157, middleware 2550/2550 (vancouver-timezone included), both lints clean.
- Migrations are only 0001-0003, so neither 0004 nor 0006 rides along.
- Public pages differ from production only in `?v=` stamps: no `main.js`, module or `style.css` changes, and the beer page holdback is intact.
- `scripts/backfill` is unchanged apart from a README line. The 85-13 backfill can therefore run from this branch, which satisfies the Phase 89 rule that the backfill must not run from a checkout carrying the `beer_category` spec.

**Not rehearsed on staging as this exact SHA.** Staging runs `main`, a superset of it. Every cherry-picked commit was exercised on staging (D-17 on 2026-10-15: recipe auto-confirm INV-000239). The combination is covered by the test gate only, so the production smoke in Step 2 matters.

## The D-08 gate problem ⚑

85-13 Task 1 refuses to deploy until production gift cards have flipped to postgres (D-08: one production dual window at a time). On 2026-10-15 the flip had not happened:
- 84-DUAL-LOG has no flip decision.
- The flip bar needs all six gift-card ops observed live, and redeem has never run.
- Organic gift-card traffic is low, so the gate could hold for weeks, past 2026-11-01.

**Proposal:** split 85-13 along the line its own tasks already draw.
- **Step 2, code deploy in sheets mode.** This is 85-13 Task 1's deploy.
  - It starts no recipes dual window, because `RECIPES_STORE` stays unset (sheets).
  - It has no behaviour change for recipes, and migration 0003 is additive.
  - D-08 is about dual windows, not deploys, so this step does not need the gate.
  - It ships Node 24, the catalog-503 fix (`a509e397`, already in the pin) and the recipe money-path fixes.
- **Step 4, recipes cutover to dual** (85-13 Tasks 2-3). This still waits for D-08, the gift card flip, exactly as planned.

**Owner decision 2026-10-15: APPROVED.** Deploy the release SHA in sheets mode before D-08. Recipes dual still waits for the gift-card flip. The deploy time is not yet chosen.

## Beer page launch (added 2026-10-15, owner chose option 1)

The release also launches the beer page. On top of the commits above, `release/85-13-node24` (head 0826ba28) carries:
- **Fixes:** 2fb176af (FAQ 28 L), f26946ad (cans not included), ab8a0347 (card subtitles), 7713dcd3 (custom-recipe card), fdcef0fd (GA4 kit price), eaf792c7 and 4dfcc8e1 (availability), 1a670017 (/cider sitemap).
- **Launch:** c01ab37d (nav item on 22 pages, ferment-in-store hub tile, noindex removed, `BEER_PAGE_LIVE` removed).
- **Build:** 0971f47b.
- **Sitemap fix:** 48e92ddc restores the /beer entry, which was lost while resolving the launch cherry-pick.
- **Ready in fix:** 1029e8b5 (+ build 0826ba28): the faded "Ready in" column on tinted beer cards, from the owner review 2026-10-15.

Gate on Node 24: root 2181/2181, middleware 2555/2555, both lints clean.

Phase 89 beer-category card colours are NOT included (migration 0006 must follow 0004/0005). On production the cards keep their pre-89 look.

⚑ The owner is reviewing the page on staging (https://staging.steinsandvines.ca/beer.html) before the deploy. The public pages are no longer stamp-only versus production: the beer nav, hub tile and beer.html content change.

## Steps

**Step 0: Prerequisites** (Claude, read-only)
- Production /health is OK with `authenticated:true`. Railway backups are live.
- No pending recipe-sale charges are in prod Redis.
- `git log production/main -1` is still ef3be1e3. If it moved, re-check for drift.
- Re-run the gate on the release branch (Node 24).

**Step 1: Owner approval** ⚑
- Approve the SHA (`git rev-parse release/85-13-node24`).
- Approve the deploy time. Store closed, kiosk idle.

**Step 2: Production deploy, sheets mode**
- Run `git push production release/85-13-node24:main --force`. This goes through the gated-deploy workflow, which now runs on Node 24.
- `enforce-cname.yml` re-sets the CNAME.
- Railway redeploys the middleware.

**Step 3: Post-deploy checks**
- `railway ssh … node -e` must show v24.x with tz ≥ 2026a, and 2026-11-15 12:00Z must show as PDT.
- /health must show `authenticated:true`, `database:true` and `database_required:true`.
- The guard-chain log must show 0003_recipes applied. Record this under 85-13 Task 1 "Production prerequisites".
- Spot check that public pages are unchanged and the beer page is still hidden.
- Kit sale path smoke: open the kiosk and request a quote. A real low-value kit sale is optional.
- `RECIPES_STORE` stays unset and `GIFT_CARDS_STORE` stays dual.

**Step 4: Re-enable recipe sales** ⚑
- Set production `BEER_SALES_ENABLED=true`.
- Run ONE real recipe sale on the production kiosk with a test discount, the same pattern as D-17.
- Expect: invoice Paid, total == charge, batch created.
- Then void and clean up.
- If anything is off, set the flag back to false. That is safe at any time.

**Step 5: Recipes cutover** (85-13 Tasks 2-3, unchanged)
- After hours, once D-08 is met (gift cards flipped).
- Backfill from this release checkout, then `RECIPES_STORE=dual`, then the verify and mirror-write checks.
- Then the opening-day smoke and the 85-14 ≥7-day window.

## Rollback

- **Code:** `git push production ef3be1e3:main --force`. This restores the 2026-10-06 production code, but also Node 20, so redo Node 24 before Nov 1.
- **Recipe sales:** `BEER_SALES_ENABLED=false`.
- **Recipes dual (Step 5):** `RECIPES_STORE=sheets`, per the RUNBOOK.

## Deadline math

- 2026-11-01 is a Sunday. Node 24 must be live on production before 2026-11-01 00:00 PDT.
- Target: Step 2 this week. That leaves ≥10 days of production soak on Node 24 before the cliff.
