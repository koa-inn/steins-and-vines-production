'use strict';

// Limited Release deposit emails print each SO number once (Phase 100, plan 15).
// Zoho SO numbers already start with "SO-", so "SO SO-000085" must never appear.

jest.mock('axios', () => ({ post: jest.fn(), get: jest.fn() }));

var axios = require('axios');
var mailer = require('../lib/mailer');

var SOS = [
  { salesorder_number: 'SO-000085', name: 'Amici', release_label: 'April 2027' },
  { salesorder_number: 'SO-000086', name: 'Ember', release_label: 'November 2026' }
];

describe('preorder deposit emails: SO label', function () {
  var origKey = process.env.RESEND_API_KEY;
  var origTo = process.env.CONTACT_TO;

  beforeEach(function () {
    jest.clearAllMocks();
    process.env.RESEND_API_KEY = 're_test_123';
    process.env.CONTACT_TO = 'staff@example.com';
    axios.post.mockResolvedValue({ data: { id: 'msg_1' } });
  });

  afterEach(function () {
    process.env.RESEND_API_KEY = origKey;
    if (origKey === undefined) delete process.env.RESEND_API_KEY;
    process.env.CONTACT_TO = origTo;
    if (origTo === undefined) delete process.env.CONTACT_TO;
  });

  function sent() { return axios.post.mock.calls[0][1]; }

  test('customer confirmation prints the SO number once', async function () {
    await mailer.sendPreorderDepositConfirmation({
      email: 'c@x.com', name: 'Pat', salesorders: SOS, depositTotal: 100, kitCount: 2
    });
    var m = sent();
    expect(m.text).toContain('Amici · April 2027 · SO-000085');
    expect(m.text).toContain('SO-000086');
    expect(m.text).not.toMatch(/SO SO-/);
  });

  test('staff notification prints the SO number once', async function () {
    await mailer.sendPreorderDepositNotification({
      name: 'Pat', email: 'c@x.com', phone: '604', salesorders: SOS,
      depositTotal: 100, kitCount: 2, txnId: 'TXN-9'
    });
    var m = sent();
    expect(m.text).toContain('Amici · April 2027 · SO-000085');
    expect(m.text).toContain('SO-000086');
    expect(m.text).not.toMatch(/SO SO-/);
  });

  test('a bare number without the prefix still gets an "SO" label', async function () {
    await mailer.sendPreorderDepositNotification({
      name: 'Pat', email: 'c@x.com', phone: '604',
      salesorders: [{ salesorder_number: '000090', name: 'Sol', release_label: 'April 2027' }],
      depositTotal: 50, kitCount: 1, txnId: 'TXN-9'
    });
    expect(sent().text).toContain('Sol · April 2027 · SO 000090');
  });
});
