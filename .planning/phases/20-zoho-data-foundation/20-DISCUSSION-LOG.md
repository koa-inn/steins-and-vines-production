# Phase 20: Zoho Data Foundation — Discussion Log

**Date:** 2026-05-27
**Duration:** ~5 minutes
**Areas discussed:** 3 of 3

## Area 1: Category Mapping Rules

**Question:** How to handle ambiguous items (hydrometers, sanitizer, etc.)?
**Options:** All to Equipment | Equipment vs Cleaning | Custom rules
**Selected:** Equipment vs Cleaning — separate subcategories, but cleaning displayed on equipment page (only 4 cleaning items, too few for own page)

**Follow-up:** Should Cleaning get its own subpage?
**Selected:** Share Equipment page — tag as separate subcategories in Zoho for future flexibility, but display together

## Area 2: Tagging Approach

**Question:** How to tag 56 uncategorized items?
**Options:** Script + manual review | All manual | Script tags everything
**Selected:** Script + manual review — auto-tag obvious items by name pattern, generate ambiguous list for manual review

## Area 3: Snapshot Verification

**Question:** What level of verification after tagging?
**Options:** Automated check script | Manual spot-check | Both
**Selected:** Automated check script — hits middleware API, counts per subcategory, flags untagged items
