#!/usr/bin/env bash
# scripts/check-artifact-drift.sh
#
# CI artifact-drift check — plan 45-04, requirement AUDIT-H-CI.
#
# PURPOSE
#   Rebuild the JS/CSS bundles from source and exit non-zero if any tracked
#   artifact diverges from its freshly-built counterpart.  A tested, merged
#   money-path/kiosk fix that was never rebuilt before commit can otherwise
#   ship silently behind a stale bundle while tests stay green.
#
# STAMP EXCLUSION (D-10 / T-45-04-STAMP)
#   The build (npm run stamp) injects a Date.now()-based ISO timestamp into
#   js/admin.js:
#       var BUILD_TIMESTAMP = 'YYYY-MM-DDTHH:MM:SS.sssZ';
#   which propagates into js/admin.min.js.  This token changes on every build
#   and is intentionally excluded from the diff scope — js/admin.min.js is NOT
#   in the check list below.
#
#   The checked artifacts (js/main.js, js/main.min.js, js/kiosk.min.js,
#   css/*.min.css) carry NO stamp token and are byte-for-byte reproducible
#   from the same source.  A sed normalisation pass that strips ISO-timestamp
#   literals is applied as defense-in-depth in case a future source module
#   ever introduces such a token.
#
# ARTIFACTS CHECKED (must match the ones served by GitHub Pages)
#   js/main.js                   — module concatenation (concat:js pipeline)
#   js/main.min.js               — terser-minified main bundle
#   js/kiosk.min.js              — terser-minified kiosk bundle
#   css/styles.min.css
#   css/admin.min.css
#   css/batch.min.css
#   css/brewpad.min.css
#   css/catalog-subpage.min.css
#   css/hops.min.css
#   css/kiosk.min.css
#   css/labels.min.css
#   css/search-overlay.min.css
#
# USAGE
#   bash scripts/check-artifact-drift.sh
#   Exits 0 when all artifacts match a fresh build.
#   Exits 1 and names the drifted files when drift is detected.
#
#   NOTE: Running this script rebuilds artifacts in the working tree as a
#         side-effect of npm run build (admin.js BUILD_TIMESTAMP + HTML ?v=
#         cache tokens will be updated; this is expected and does not affect
#         the checked artifacts).

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# ---------------------------------------------------------------------------
# 1. Install dependencies if node_modules is absent (uses lockfile for
#    a reproducible, tamper-evident install — T-45-04-SC).
# ---------------------------------------------------------------------------
if [ ! -d node_modules ]; then
  echo "[check-artifact-drift] node_modules not found — running npm ci..."
  npm ci
fi

# ---------------------------------------------------------------------------
# 2. Rebuild all artifacts from source.
#    The build stamps admin.js and HTML files (Date.now()/ISO timestamp);
#    those changes affect files outside the check scope and are harmless here.
# ---------------------------------------------------------------------------
echo "[check-artifact-drift] Running npm run build..."
npm run build

# ---------------------------------------------------------------------------
# 3. Stamp-normalised diff over the checked artifacts.
#
#    git diff (without --cached) compares the working tree to the committed
#    index.  After a clean build where source matches the committed artifact,
#    each checked file rebuilds to identical content → diff is empty → exit 0.
#    When a source module was edited but the rebuilt artifact was not committed,
#    the working-tree file differs from the index → non-empty diff → exit 1.
#
#    Normalisation: sed strips ISO 8601 datetime literals in single or double
#    quotes (the BUILD_TIMESTAMP stamp format) from the diff output.  This has
#    no effect on the currently-checked artifacts (none carry the stamp) but
#    prevents false positives if a future module introduces one.
#    Token format: 'YYYY-MM-DDTHH:MM:SS.sssZ'
# ---------------------------------------------------------------------------
ARTIFACTS=(
  js/main.js
  js/main.min.js
  js/kiosk.min.js
  css/styles.min.css
  css/admin.min.css
  css/batch.min.css
  css/brewpad.min.css
  css/catalog-subpage.min.css
  css/hops.min.css
  css/kiosk.min.css
  css/labels.min.css
  css/search-overlay.min.css
)

echo "[check-artifact-drift] Checking: ${ARTIFACTS[*]}"

# Stamp-normalisation pattern: ISO 8601 datetime literal in single or double quotes
STAMP_PATTERN="s/['\"][0-9]\{4\}-[0-9]\{2\}-[0-9]\{2\}T[0-9]\{2\}:[0-9]\{2\}:[0-9]\{2\}\.[0-9]\{3\}Z['\"]/__TIMESTAMP__/g"

DIFF=$(git diff -- "${ARTIFACTS[@]}" | sed "$STAMP_PATTERN")

if [ -n "$DIFF" ]; then
  echo ""
  echo "ERROR: Artifact drift detected — committed artifacts diverge from a fresh build."
  echo "Run 'npm run build' locally and commit the rebuilt artifacts before merging."
  echo ""
  echo "Drifted files:"
  git diff --name-only -- "${ARTIFACTS[@]}"
  echo ""
  echo "Diff (stamp-normalised):"
  printf '%s\n' "$DIFF"
  exit 1
fi

echo "[check-artifact-drift] PASS — all checked artifacts match their fresh build. No drift detected."
exit 0
