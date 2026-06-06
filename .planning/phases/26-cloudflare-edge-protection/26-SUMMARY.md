# Phase 26 — Cloudflare Edge Protection — SUMMARY

**Status:** Complete
**Shipped:** 2026-06-06
**Execution note:** Executed live (no formal PLAN.md) — user did the registrar/Cloudflare
dashboard steps in real time; assistant verified each step via `dig`/`curl`/`gh api` and
guided configuration. Goal-backward this fully satisfies the phase goal.

## What shipped

**DNS migration to Cloudflare (free tier)**
- Nameservers moved GoDaddy → Cloudflare (`eoin/rose.ns.cloudflare.com`) at the registrar
- All records recreated/verified in Cloudflare (see `DNS-INVENTORY.md`)
- Apex `steinsandvines.ca` + `www` **proxied** (orange) → bot protection + CDN
- `staging` left **DNS-only** (grey) — see gotcha below

**TLS**
- SSL/TLS mode set to **Full** (not Flexible — avoids GitHub Pages redirect loop)
- Always Use HTTPS on; Cloudflare edge cert (Google Trust Services) issued; verified `https` 200, 0 redirects

**Email authentication (hardened during the move)**
- SPF replaced GoDaddy `_spfm` chain with direct `v=spf1 include:_spf.google.com ~all` (old chain would have broken off-GoDaddy)
- DKIM generated in Google Workspace (2048-bit, selector `google`), added to Cloudflare, verified well-formed from CF nameservers
- MX (Google), DMARC, `google-site-verification`, and `_github-pages-challenge-koa-inn` all preserved/verified

**Bot defense (the goal)**
- **Bot Fight Mode** enabled (auto-allows verified search crawlers — SEO safe)
- **Rate-limiting rule** "Flood protection": URI Path starts-with `/` (all traffic), 100 req / 10s per IP, action Managed Challenge/Block, 10-min duration (free tier = 1 rule, 10s window)

## Verification
- Production served through Cloudflare: HTTP 200, `server: cloudflare`, valid TLS, origin still GitHub Pages
- Normal request bursts not rate-limited; www 301→apex; staging restored to 200
- Email records globally visible post-propagation (DKIM, MX, SPF)

## Key gotchas / decisions
- **GitHub Pages CNAME subdomains must stay grey-clouded.** Proxying `staging` (a CNAME→`koa-inn.github.io`) made GitHub's DNS check fail → GitHub dropped the custom domain (`cname: null`) → 404. Fix: grey-cloud staging, re-set Pages custom domain via `gh api … pages -X PUT -f cname=…`, trigger a Pages rebuild. Apex (A-records) + the `_github-pages-challenge` TXT kept production stable while proxied.
- **No Cloudflare API token needed in Railway** — all config is dashboard-side.
- Root cause of earlier Drive build failures was a full local disk, not Drive scale — now developing from `~/dev/steins-and-vines-website`.

## Deferred / follow-ups
- **API not yet protected.** Middleware is `svmiddleware-production.up.railway.app` (raw Railway domain, outside the zone). If Security → Events shows bots hitting the API, add `api.steinsandvines.ca` (proxied CNAME → Railway), add the custom domain in Railway, repoint `js/modules/01-config.js`, and read `CF-Connecting-IP` in middleware. Decision gated on ~24h of analytics.
- DKIM "Start authentication" final click in Google Admin (record verified, just needs the toggle).
- Optional: update DMARC `rua` off the GoDaddy reporting address.
