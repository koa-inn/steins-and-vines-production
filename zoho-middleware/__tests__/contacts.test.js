'use strict';

// ---------------------------------------------------------------------------
// Regression tests for buildContactsRoutePayload (POST /api/contacts handler)
//
// Regression: INV-000078-class bug — email/phone at top-level of Zoho contact
// payload are silently dropped by Zoho Books. They must be nested under
// contact_persons. Explicit first_name/last_name from the request body must
// override the whitespace-split fallback.
// ---------------------------------------------------------------------------

jest.mock('express', () => {
  var router = { get: jest.fn(), post: jest.fn() };
  var express = function () {};
  express.Router = function () { return router; };
  return express;
});
jest.mock('../lib/zoho-api', () => ({
  zohoGet: jest.fn(),
  zohoPost: jest.fn(),
  normalizeTimeTo24h: jest.fn()
}));
jest.mock('../lib/calcom', () => ({}));
jest.mock('../lib/cache', () => ({
  get: jest.fn(),
  set: jest.fn()
}));
jest.mock('../lib/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn()
}));
jest.mock('../lib/constants', () => ({
  CACHE_KEYS: {
    AVAILABILITY_PREFIX: 'av:',
    BOOKING_SERVICES: 'bksvc',
    SLOTS_PREFIX: 'slots:'
  }
}));

var { buildContactsRoutePayload } = require('../routes/bookings');

describe('buildContactsRoutePayload', () => {
  // INV-000078 guard: email must be nested, NOT at top level
  test('nests email under contact_persons (NOT top-level) — INV-000078 guard', () => {
    var payload = buildContactsRoutePayload('Anne MacDougall', 'anne@example.com', '', '', '');
    expect(payload.contact_persons[0].email).toBe('anne@example.com');
    expect(payload.email).toBeUndefined();
  });

  // Name splitting fallback
  test('splits full name into first_name / last_name on the primary contact person', () => {
    var payload = buildContactsRoutePayload('Anne MacDougall', 'anne@example.com', '', '', '');
    expect(payload.contact_persons[0].first_name).toBe('Anne');
    expect(payload.contact_persons[0].last_name).toBe('MacDougall');
    expect(payload.contact_persons[0].is_primary_contact).toBe(true);
  });

  // contact_type
  test('sets contact_type to customer', () => {
    var payload = buildContactsRoutePayload('Anne MacDougall', 'anne@example.com', '', '', '');
    expect(payload.contact_type).toBe('customer');
  });

  // Phone nesting — same INV-000078 class
  test('nests phone under contact_persons when provided, no top-level phone', () => {
    var payload = buildContactsRoutePayload('Anne MacDougall', 'anne@example.com', '604-555-0100', '', '');
    expect(payload.contact_persons[0].phone).toBe('604-555-0100');
    expect(payload.phone).toBeUndefined();
  });

  test('omits phone from contact_person when not provided', () => {
    var payload = buildContactsRoutePayload('Anne MacDougall', 'anne@example.com', '', '', '');
    expect(payload.contact_persons[0].phone).toBeUndefined();
  });

  // Explicit first_name/last_name override
  test('uses explicit first_name/last_name when provided, skipping whitespace split', () => {
    var payload = buildContactsRoutePayload('Mary Jane Watson Parker', 'mj@example.com', '', 'Mary Jane', 'Watson Parker');
    expect(payload.contact_persons[0].first_name).toBe('Mary Jane');
    expect(payload.contact_persons[0].last_name).toBe('Watson Parker');
  });

  test('keeps contact_name as the combined display name even with explicit first/last override', () => {
    var payload = buildContactsRoutePayload('Mary Jane Watson Parker', 'mj@example.com', '', 'Mary Jane', 'Watson Parker');
    expect(payload.contact_name).toBe('Mary Jane Watson Parker');
  });

  test('falls back to whitespace split when first_name is empty string', () => {
    var payload = buildContactsRoutePayload('Anne MacDougall', 'anne@example.com', '', '', '');
    expect(payload.contact_persons[0].first_name).toBe('Anne');
    expect(payload.contact_persons[0].last_name).toBe('MacDougall');
  });

  test('last_name defaults to empty string when explicit first_name provided but no last_name', () => {
    var payload = buildContactsRoutePayload('Cher', 'cher@example.com', '', 'Cher', '');
    expect(payload.contact_persons[0].first_name).toBe('Cher');
    expect(payload.contact_persons[0].last_name).toBe('');
  });

  test('is_primary_contact is true on the contact person', () => {
    var payload = buildContactsRoutePayload('Anne MacDougall', 'anne@example.com', '604-555-0100', 'Anne', 'MacDougall');
    expect(payload.contact_persons[0].is_primary_contact).toBe(true);
  });
});
