---
title: Record OG and target FG on recipes so the G8 Fermentation expected curve, attenuation and ABV turn on
status: pending
created: 2026-10-29
source: Phase 96 (96-02 finding; owner chose "track as follow-up" at 96-10)
area: recipes / brewpad dashboard
priority: low
owner_action: false
---

## What

Phase 96 G8 Fermentation can draw a dashed expected curve (OG → target FG) and show attenuation and ABV, but
`batchMeta.og` / `batchMeta.target_fg` are always null in live data: no recipe or recipe-snapshot writer records
them today (`parseDashSnapshot` in `zoho-middleware/lib/batch-pg-read.js` reads `og`, `target_fg`/`fg` in °P).

## Done when

Recipes (beer/cider at least) record OG and target FG, the batch recipe snapshot carries them, and G8 shows the
expected curve, attenuation and ABV for a batch with readings. Candidate for Phase 97.
