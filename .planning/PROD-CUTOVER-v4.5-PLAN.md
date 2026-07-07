# v4.5 Production Cutover — Migration Plan ("Option C")

**Author:** drafted 2026-07-04 · **Status:** DRAFT for owner review · **Owner action required**

## TL;DR

The real fix for today's leaked-key kiosk outage is to **execute the Phase 46 auth
cutover** — which is already fully written in `docs/RUNBOOK.md` → *"Phase 46 Auth
Cutover"* (⏳ pending owner execution). This plan does not reinvent that runbook; it
**sequences** it against today's reality and folds in Phase 48.

Because the middleware deploys **only** from the production repo and there is **no
separate staging middleware** (staging frontend calls prod middleware), the cutover is
a **single coupled, off-hours production deploy** of everything currently on
`origin/main` (phases **46, 47, 49, 52, 53**), followed by iPad provisioning and a key
rotation. **Phase 48 comes after** — it depends on device-token auth being live on the
prod middleware, so it can't be tested until the cutover is done.

---

## Current state (the map)

| Target | Ref | Auth model | Contents |
|---|---|---|---|
| **production** (`steinsandvines.ca`) | `4956301` (end of Phase 45) | OLD `x-api-key`; **leaked key `a9QK…` re-enabled today** to restore sales | 44, 45 |
| **staging** (`origin/main`) | `b65b2b3` | NEW 3-tier (device-token / session / legacy) | + 46, 47, 49, 52, 53 |
| **local `main`** | `6cfaa1f` | same as staging | + 48 + today's WR-01/03/05 fixes |

**Today's hotfix context:** we set prod `API_SECRET_KEY` back to the leaked value so the
old-model kiosk could sell again. That is exactly the **dual-accept** starting condition
the runbook assumes — the leaked key keeps working through Task 1–2 and is **killed by the
Task 3 rotation.** This cutover is what closes the loop we opened today.

**Milestone reality:** v4.5 is partial — Phases **50 and 51 are not built**, and **49-02
and 48-06 real-card UATs are deploy-pending.** This cutover ships "v4.5-so-far" to prod;
those UATs then run *on* prod.

---

## Scope honesty — this is a milestone release, not a surgical auth patch

Production is at end-of-Phase-45, and the middleware is single-deployment from repo HEAD,
so the cutover ships the **entire in-flight v4.5 payload** at once. What goes live in Stage 1:

- **46** — 3-tier auth (device-token kiosk / Google-session admin+BrewPad / legacy key), leaked key removed from `sheets-config.js`.
- **47** — internal `.planning/`/audit docs purged from the prod-served site (SEC-01).
- **49** — online captured-amount verification: **void + reject on `captured < invoiced`** (MONEY-01) — a real change to booking logic; watch for false-positive voids.
- **52** — fail-closed-on-Redis-error across money/security call-sites.
- **53** — Sentry on every money-path catch, CI/lint hardening.

→ Treat this as a **money-path release**: off-hours, rollback ready, eyes on Sentry after.

---

## Sequence

### Stage 0 — Pre-flight (Claude can do now, no production access)
- [ ] Confirm `origin/main` is green (CI) and bundles are built; confirm no uncommitted drift.
- [ ] Confirm the **Gated Production Deploy** workflow + CNAME handling are intact (see `docs/RUNBOOK.md` → CNAME Reference; note `enforce-cname.yml` is known-broken, gated-deploy manages CNAME manually).
- [ ] Fix the **deploy SHA = `origin/main` HEAD** (Phase 48 explicitly **excluded** from Stage 1).
- [ ] Re-read `docs/RUNBOOK.md` "Phase 46 Auth Cutover" together and confirm nothing changed since it was written.

### Stage 1 — Auth cutover (EXECUTE `docs/RUNBOOK.md` Tasks 1–3)
This is the existing runbook; summary of the gated human steps:
- [ ] **Task 1 (off-hours, store closed):** owner sets `STAFF_EMAILS`, `KIOSK_DEVICE_TOKEN`, `SHEETS_CLIENT_ID` in Railway (leave `API_SECRET_KEY` = current leaked value → dual-accept). `git push origin main`, then coupled prod deploy (gated workflow / break-glass force-push). Verify `/health` + old key still accepted. → **"deployed"**
- [ ] **Task 2:** provision the iPad device token; verify kiosk sale end-to-end, admin (allowlisted vs not), BrewPad, and the negative device-scope check (kiosk token refused on gift-card void). → **"verified"**
- [ ] **Task 3 (within 2–3 business days):** rotate `API_SECRET_KEY` to a fresh value → **leaked key dead**; re-verify no lockout + public checkout. Fill in the runbook Outcome record. → **"rotated"**
- [ ] Write `.planning/phases/46…/46-10-SUMMARY.md`, mark Phase 46 complete, close SEC-02.

**Outcome:** leaked key neutralized; prod middleware now speaks device-token — which
*unblocks Phase 48's UAT.*

### Stage 2 — Land Phase 48 on staging + real-terminal UAT
- [ ] `git push origin main` (local → staging) to publish Phase 48 + today's WR fixes to the staging frontend (which now calls the device-token-enabled prod middleware).
- [ ] Run **`48-HUMAN-UAT.md`** on the iPad: full sale on both surfaces, product-type discount, dual-cart, void-on-failure, Manager Override (409→override→resubmit), admin `modified_ingredients` pricing, single-batch. This also exercises WR-02/WR-04 live.
- [ ] Re-run `/gsd:verify-work 48` / mark 48 complete once green.

### Stage 3 — Phase 48 to production
- [ ] Second coupled off-hours prod deploy (`origin/main` now includes 48). Smoke-test the kiosk on prod (both surfaces).
- [ ] (Optionally batch with 49-02 live-card UAT, which is already deploy-pending.)

---

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| Big-bang money-path deploy (49 changes booking logic) | Off-hours; Sentry (53) now on money-path catches — watch for void spikes; rollback ready |
| Coupled deploy — new middleware needs new frontend | That's the design; **dual-accept** is the safety net (old key retained through Task 1–2) |
| iPad provisioning fails → kiosk down | Do Task 1–2 store-closed; old key still works (dual-accept) as fallback until token verified |
| Rotation locks out a surface still on old key | Runbook **gates rotation (Task 3) behind verifying ALL surfaces (Task 2)** |
| Phase 48 tested too early | Sequenced **after** cutover — its `x-device-token` kiosk needs the new prod middleware |
| Rollback needed | Redeploy prior prod SHA `4956301` (restores old auth + old key). Document the exact command in the runbook before Stage 1 |

---

## Open decisions for you

1. **Decouple 48 from the cutover?** — Recommended (Stages 1 → 2 → 3 as above). Bundling 48 into Stage 1 would deploy unverified-on-hardware kiosk code in the same window as the auth cutover.
2. **Off-hours window** for the Stage 1 coupled deploy + iPad provisioning.
3. **`STAFF_EMAILS`** — the staff Google accounts to allowlist for admin/BrewPad.
4. **Ride-along UATs** — 49-02 (captured-amount) is already deploy-pending; it goes live in Stage 1 and can be UAT'd right after.

## What I can do next without production access
- Draft the exact rollback command block into `docs/RUNBOOK.md` (prior-SHA redeploy).
- Pre-stage Phase 48 for Stage 2 (it's already committed locally; ready to `git push origin main` on your go).
- Generate the verification `curl` commands with the real prod middleware host filled in.
- Write the Phase 46 `46-10-SUMMARY.md` scaffold to capture the cutover outcome as you execute it.
