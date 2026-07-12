'use strict';

// Regression: "Last, First" customer names must not keep the comma.
//
// Zoho contacts are stored surname-first ("Gamba, Remo"), and that display name is
// what the kiosk sends as customer_name. splitCustomerName() only split on
// whitespace, so the batch for INV-000137 was written with
// customer_firstname="Gamba," (comma included) and customer_lastname="Remo" —
// the names were both mangled AND swapped. Verified on the live row SV-B-000173.
//
// Space-separated names ("Jane Doe") must keep behaving exactly as before; those
// cases are pinned in brewpad-integration.test.js.

jest.mock('../lib/cache', function () {
  return {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue(),
    del: jest.fn().mockResolvedValue(),
    isConnected: jest.fn().mockReturnValue(true),
    getClient: jest.fn().mockResolvedValue({ keys: jest.fn().mockResolvedValue([]) })
  };
});
jest.mock('../lib/logger', function () {
  return { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
});
jest.mock('../lib/eventLog', function () {
  return { logEvent: jest.fn() };
});
jest.mock('axios');

var brewpadIntegration = require('../lib/brewpad-integration');

describe('splitCustomerName — Zoho surname-first names', function () {

  it('splits "Gamba, Remo" into first=Remo, last=Gamba (the INV-000137 case)', function () {
    expect(brewpadIntegration.splitCustomerName('Gamba, Remo'))
      .toEqual({ first: 'Remo', last: 'Gamba' });
  });

  it('tolerates a missing space after the comma', function () {
    expect(brewpadIntegration.splitCustomerName('Gamba,Remo'))
      .toEqual({ first: 'Remo', last: 'Gamba' });
  });

  it('keeps a multi-part given name after the comma', function () {
    expect(brewpadIntegration.splitCustomerName('Van Der Berg, Mary Jane'))
      .toEqual({ first: 'Mary Jane', last: 'Van Der Berg' });
  });

  it('handles a trailing comma with no given name', function () {
    expect(brewpadIntegration.splitCustomerName('Gamba,'))
      .toEqual({ first: '', last: 'Gamba' });
  });

  it('still splits plain "Jane Doe" first-name-first (unchanged)', function () {
    expect(brewpadIntegration.splitCustomerName('Jane Doe'))
      .toEqual({ first: 'Jane', last: 'Doe' });
  });

  it('a comma never leaks into either field', function () {
    var r = brewpadIntegration.splitCustomerName('Gamba, Remo');
    expect(r.first).not.toContain(',');
    expect(r.last).not.toContain(',');
  });
});
