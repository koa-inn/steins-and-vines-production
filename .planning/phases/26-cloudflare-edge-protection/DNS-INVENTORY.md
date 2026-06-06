# DNS Inventory — steinsandvines.ca (pre-Cloudflare snapshot)

Captured 2026-06-06, while nameservers were still GoDaddy (`ns27/ns28.domaincontrol.com`),
BEFORE the Cloudflare nameserver cutover propagated. Use this to verify Cloudflare's
auto-imported records are complete, and as a rollback reference.

## Records that MUST exist in Cloudflare after migration

| Type | Name | Value | Cloudflare proxy | Notes |
|------|------|-------|------------------|-------|
| A | `steinsandvines.ca` (apex) | 185.199.108.153 / .109.153 / .110.153 / .111.153 | 🟠 Proxied (goal) | GitHub Pages. All 4 IPs. |
| CNAME | `www` | koa-inn.github.io | 🟠 Proxied | GitHub Pages |
| CNAME | `staging` | koa-inn.github.io | ⚪ DNS-only (suggested) | Lower stakes; grey-cloud keeps it simple |
| CNAME | `api` | ghs.googlehosted.com | ⚪ DNS-only | Google-hosted (vestigial? verify if used — NOT the Railway middleware) |
| MX | `steinsandvines.ca` | aspmx.l.google.com (1), alt1/alt2 (5), alt3/alt4 (10) | ⚪ DNS-only | **Google Workspace email — never proxy MX. Email breaks if missing.** |
| TXT | `steinsandvines.ca` | `v=spf1 include:_spf.google.com ~all` (replaces GoDaddy `_spfm` chain) | n/a | See SPF note below |
| TXT | `steinsandvines.ca` | `google-site-verification=Jw0je8GTccB3lkTffarDLZg7uVrrqxVZTh3jqxHeOFE` | n/a | Google verification — preserve |
| TXT | `_github-pages-challenge-koa-inn` | `f8a0341e21008cf86ebc56272fa298` | n/a | **GitHub Pages domain verification — preserve or Pages may unverify the custom domain** |
| TXT | `_dmarc` | `v=DMARC1; p=quarantine; adkim=r; aspf=r; rua=mailto:dmarc_rua@onsecureserver.net;` | n/a | Preserve (rua points to GoDaddy; can update later) |

## SPF note (important)
Current SPF uses GoDaddy's proprietary merge: `v=spf1 include:dc-aa8e722993._spfm.steinsandvines.ca ~all`,
and that `_spfm` sub-record just resolves to `v=spf1 include:_spf.google.com ~all`.
**Off GoDaddy DNS the `_spfm` indirection is fragile — replace the apex SPF with the direct
`v=spf1 include:_spf.google.com ~all` and drop the `_spfm` record entirely.**

## To verify (not seen in quick scan)
- **DKIM**: `google._domainkey` returned empty — Google Workspace may use a different selector.
  Check Google Admin → Apps → Google Workspace → Gmail → Authenticate email for the real selector/value
  and recreate it in Cloudflare, or email signing breaks.
- Drop GoDaddy-only cruft: `_domainconnect` (→ GoDaddy domain-connect, irrelevant off GoDaddy).

## Middleware / API
- Frontend calls `https://svmiddleware-production.up.railway.app` directly (raw Railway domain,
  OUTSIDE the steinsandvines.ca zone). **Cloudflare cannot protect it as-is.**
- To put it behind Cloudflare: add `api.steinsandvines.ca` CNAME → `svmiddleware-production.up.railway.app`
  (proxied), add the custom domain in Railway, then update `js/modules/01-config.js` to call the new host.
  Separate sub-task — only needed if bots are hitting the API, not just the site.

## SSL
- Origin (GitHub Pages) serves a valid Let's Encrypt cert.
- **Cloudflare SSL/TLS mode MUST be "Full" (or Full strict) — NOT Flexible.** Flexible → infinite
  redirect loop because GitHub Pages forces HTTPS.

---

## Cloudflare import verification (2026-06-06, from zone export)

Zone is live in Cloudflare (NS `eoin/rose.ns.cloudflare.com`).

✅ Imported correctly:
- Apex A → 4 GitHub IPs, all proxied 🟠
- `www` → koa-inn.github.io, proxied 🟠
- `staging` → koa-inn.github.io, proxied
- MX → all 5 Google records
- `_dmarc` TXT, `google-site-verification` TXT

❌ MISSING — must add manually:
- **`_github-pages-challenge-koa-inn` TXT = `f8a0341e21008cf86ebc56272fa298`** (DNS-only) — GitHub Pages domain verification
- **SPF `_spfm` target** — apex SPF still references `dc-aa8e722993._spfm.steinsandvines.ca`, which did NOT import → SPF is now broken. Replace apex TXT with `v=spf1 include:_spf.google.com ~all`
- **DKIM** — none present. Verify selector in Google Admin and re-add.

⚠️ WRONG proxy setting — change to DNS-only (grey):
- `mail` → ghs.googlehosted.com — currently 🟠 proxied (breaks Google-hosted). Set grey.
- `drive` → ghs.googlehosted.com — currently 🟠 proxied. Set grey.
- `_domainconnect` → GoDaddy — cruft; delete.
