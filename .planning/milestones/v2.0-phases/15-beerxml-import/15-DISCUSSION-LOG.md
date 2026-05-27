# Phase 15: BeerXML Import — Discussion Log

**Date:** 2026-05-17
**Participants:** User + Claude

## Areas Discussed

### 1. Upload & Parsing Location
- **Options:** Browser-side, Server-side, Hybrid
- **Selected:** Browser-side
- **Notes:** DOMParser in browser, no file upload endpoint needed. 500KB limit + XML validation client-side.

### 2. Import Entry Point
- **Options:** Inside recipe editor, Separate import view, Both admin + kiosk
- **Selected:** Inside recipe editor
- **Notes:** Button next to "New Recipe". Pre-fills the existing form. No kiosk import.

### 3. Ingredient Matching UX
- **Options:** Auto-match + review table, Manual match only, Auto-match skip review
- **Selected:** Auto-match + review table
- **Notes:** Reuse filterIngredientCatalog for fuzzy matching. Staff must confirm all matches before save.

### 4. Unit Handling
- **Options:** Auto-convert to kg/g, Keep original units, Prompt per ingredient
- **Selected:** Auto-convert to kg/g
- **Notes:** Show original + converted in review table. Yeast = pcs. BeerXML AMOUNT is kg per spec.

## Deferred Ideas
- Kiosk inline recipe editor
- Kiosk BeerXML import
