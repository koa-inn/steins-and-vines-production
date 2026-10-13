'use strict';

/**
 * Regression: BC moved to permanent UTC-7 after 2026-03-08 (IANA tzdata 2026a+). Node 20.20.2
 * bundles tzdata 2025c, so from 2026-11-01 Intl puts America/Vancouver at UTC-8 and every
 * middleware "today", due-date and month bucket is an hour behind between 00:00 and 01:00.
 * The runtime must ship tzdata new enough to know BC no longer falls back.
 */

function vancouverOffset(isoInstant) {
  var parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Vancouver',
    timeZoneName: 'longOffset'
  }).formatToParts(new Date(isoInstant));
  return parts.find(function (p) { return p.type === 'timeZoneName'; }).value;
}

function vancouverDate(isoInstant) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Vancouver', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date(isoInstant));
}

describe('America/Vancouver time zone data (BC permanent UTC-7)', function () {
  it('stays at UTC-7 after 2026-11-01 instead of falling back to UTC-8', function () {
    expect(vancouverOffset('2026-11-15T12:00:00Z')).toBe('GMT-07:00');
    expect(vancouverOffset('2027-01-15T12:00:00Z')).toBe('GMT-07:00');
  });

  it('is UTC-7 in summer too (unchanged)', function () {
    expect(vancouverOffset('2026-07-15T12:00:00Z')).toBe('GMT-07:00');
  });

  it('dates 07:30 UTC on 2026-11-15 as 2026-11-15 local (00:30), not the 14th', function () {
    expect(vancouverDate('2026-11-15T07:30:00Z')).toBe('2026-11-15');
  });
});
