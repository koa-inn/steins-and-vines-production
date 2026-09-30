/**
 * Per-sheet column specs for the backfill pipeline.
 *
 * VesselHistory, PlatoReadings and FermSchedules are REHEARSAL targets — they are
 * trivially portable (conversion note §3.2-3.4, Research Pattern 6) and exist here to
 * prove the read -> normalise -> reject -> scratch-schema mechanics end-to-end (Plan
 * 83-07) before any real data moves. Phases 84-87 add their own spec files for the
 * sheets that actually get promoted (GiftCards, Recipes, Batches, ...).
 *
 * Never dedupe backfilled rows on anything but each spec's primaryKey — conversion
 * note §6 documents a real recipe-ingredient row that repeats an item_id, and a
 * (col, col) composite dedupe would silently drop legitimate duplicate rows.
 */
'use strict';

var vesselHistory = require('./vessel-history');
var platoReadings = require('./plato-readings');
var fermSchedules = require('./ferm-schedules');

var SPECS = [vesselHistory, platoReadings, fermSchedules];

function findSpec(name) {
  for (var i = 0; i < SPECS.length; i++) {
    if (SPECS[i].sheet === name || SPECS[i].table === name) return SPECS[i];
  }
  return null;
}

function getSpec(name) {
  var spec = findSpec(name);
  if (!spec) {
    throw new Error('no spec for "' + name + '" (Phase 84 adds it)');
  }
  return spec;
}

function listSpecs() {
  return SPECS.map(function (s) { return s.sheet; });
}

module.exports = { getSpec: getSpec, listSpecs: listSpecs };
