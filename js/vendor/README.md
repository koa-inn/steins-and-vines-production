# Vendored third-party scripts

| File | Package | Version | Provenance |
|------|---------|---------|------------|
| chart.umd.min.js | chart.js | 4.5.1 (pinned) | see below |
| qrcode.min.js | - | - | provenance not recorded |
| jspdf.umd.min.js | - | - | provenance not recorded |
| fuse.min.js | - | - | provenance not recorded |
| sentry.min.js | - | - | provenance not recorded |

## chart.umd.min.js

- Package: chart.js, version 4.5.1 (pinned; 4.6.x deferred until it passes the two-week rule)
- Source: `npm pack chart.js@4.5.1` -> `package/dist/chart.umd.min.js` (never npm-installed into the repo)
- Size: 208,522 bytes
- SHA-256 (file): `48444a82d4edcb5bec0f1965faacdde18d9c17db3063d042abada2f705c9f54a`
- SHA-256 (tarball): `f540d98468457ac7a0aabb32006dfb066297e096c5ea063a5d80aa973d1c337a`
- Registry integrity: `sha512-GIjfiT9dbmHRiYi6Nl2yFCq7kkwdkp1W/lp2J99rX0yo9tgJGn3lKQATztIjb5tVtevcBtIdICNWqlq5+E8/Pw==`
- Licence: MIT
- Loaded lazily by `loadChartJs()` in `js/brewpad.js`, only when the v2 dashboard opens. There is no static script tag.
- Checked: no `XMLHttpRequest`, `sendBeacon` or `fetch(` in the bundle.
- CSP check (2026-10-28, CLAUDE.md rule 12): `brewpad.html` has no CSP meta tag and the script is same-origin, so no CSP change is needed. No public page was touched.

### Upgrade procedure

1. `npm pack chart.js@<version>` in a scratch directory and verify the tarball hash against the registry.
2. Copy `package/dist/chart.umd.min.js` here and re-hash it.
3. Update this README (version, sizes, hashes) and the `?v=` cache-buster in `loadChartJs()`.
