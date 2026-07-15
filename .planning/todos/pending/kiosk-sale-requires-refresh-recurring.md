---
title: Kiosk still needs a manual refresh before a sale will work (RECURRING — occurred 2026-07-14)
status: pending
created: 2026-07-15
source: owner report (2026-07-15) — "the error requiring the refresh button for a kiosk sale to work is still present, occurred yesterday"
area: kiosk / catalog load / resilience
priority: HIGH
severity: blocks selling until staff notice + refresh
history: Fix 7cbf856 (2026-07-11) added a Retry button + retry on visibilitychange/online. It was explicitly INFERRED from symptoms, never reproduced. This report is the first confirmation it did not fully solve the problem.
---

## Symptom (owner-reported)

Staff go to make a sale on the kiosk and it does not work until they hit refresh /
the Retry button. Recurred 2026-07-14.

## Why this is not yet fixable — the real blocker

**There is no frontend error capture anywhere.** Verified 2026-07-15: `js/kiosk-core.js`
and `js/lib/*.js` have zero Sentry, zero `captureException`, zero beacon, and no
client-error endpoint exists on the middleware. When the kiosk fails, the catch block at
`kiosk-core.js:801-811` renders:

    'Failed to load products: ' + err.message

...on screen, and the instant staff tap Retry the text is gone. **The exact error has
never been captured.** Fix 7cbf856 was built on a guess about the cause; this recurrence
proves the guess was incomplete. We must not guess a second time.

## Leading hypotheses (from reading the code — NONE confirmed)

1. **Auth/token expiry.** `/api/kiosk/products` is gated by the device-token tier
   (`authTiers.js`). If the device token or session goes stale, the fetch returns 401/403,
   `r.ok` is false → `throw new Error('HTTP 401')` → "Failed to load products: HTTP 401".
   A page refresh re-runs init and re-reads/re-presents the token, which would explain why
   refresh — and not the in-place Retry — is what fixes it. **Strongest candidate.**
2. **Auto-retry never fires on a real iPad wake.** 7cbf856 hooks `visibilitychange` +
   `online`. iOS Safari may discard the backgrounded tab entirely (bfcache/full reload) so
   the listeners are gone, or may not fire `online` when wifi was never technically "lost."
   If so, the self-heal path is dead on the actual device and only a manual reload works.
3. **Not the catalog at all.** The symptom is "a sale won't work" — could be the sale POST
   failing, a stale terminal/device state, or an expired session mid-shift rather than the
   product grid. Needs the real surface confirmed.
4. **Persistent server-side condition.** Railway middleware cold-start, a Redis blip, or a
   cache miss where the Retry *also* fails, so staff fall back to a full reload.

The single fact that discriminates between all four — the **actual error text + HTTP
status + which screen** — is exactly what we do not have.

## Blast radius

This is the money surface. Every minute the grid is dead is a minute staff cannot sell,
and it fails silently until a human notices. Higher real-world impact than most of the
open audit items even though it is not in the audit.

## Next step

See the plan of attack (2026-07-15). Step 0 is instrumentation — capture the real error
when it next happens — NOT another inferred fix. Relevant code: `kiosk-core.js:784-870`
(load + catch + retry), `authTiers.js` (device-token gate), `routes/pos.js` `/api/kiosk/products`.

Anti-pattern to avoid (from prior session, recorded in git history): a green test suite
proved nothing about the deployed kiosk last time. Verify against the live iPad.
