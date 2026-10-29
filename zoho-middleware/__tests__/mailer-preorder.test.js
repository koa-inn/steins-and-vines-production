'use strict';

// Limited Release deposit emails (Phase 100).

jest.mock('axios', () => ({ post: jest.fn(), get: jest.fn() }));

var axios = require('axios');
var mailer = require('../lib/mailer');

var SOS = [
  { salesorder_number: 'SO-001001', name: 'Ember', release_label: 'November 2026' },
  { salesorder_number: 'SO-001002', name: 'Ember', release_label: 'November 2026' },
  { salesorder_number: 'SO-001003', name: 'Amici', release_label: 'April 2027' }
];

describe('preorder deposit emails', function () {
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

  test('customer confirmation lists every SO and the deposit', async function () {
    await mailer.sendPreorderDepositConfirmation({
      email: 'c@x.com', name: 'Pat', salesorders: SOS, depositTotal: 150, kitCount: 3
    });
    var m = sent();
    expect(m.to).toEqual(['c@x.com']);
    expect(m.reply_to).toBe('staff@example.com');
    expect(m.subject).toBe('Your Limited Release deposit is confirmed (3 kits)');
    ['SO-001001', 'SO-001002', 'SO-001003'].forEach(function (n) { expect(m.text).toContain(n); });
    expect(m.text).toContain('Deposit paid: $150.00 (non-refundable, $50 per kit)');
    expect(m.text).toContain('What happens next');
    expect(m.text).toContain('hold your kit for 60 days');
    expect(m.text).toContain('(604) 567-4565');
  });

  test('customer confirmation rejects without an email', async function () {
    await expect(mailer.sendPreorderDepositConfirmation({ salesorders: SOS }))
      .rejects.toThrow('No customer email provided');
    expect(axios.post).not.toHaveBeenCalled();
  });

  test('CR/LF in name is flattened everywhere', async function () {
    await mailer.sendPreorderDepositConfirmation({
      email: 'c@x.com', name: 'Evil\r\nBcc: a@b.com', salesorders: SOS, depositTotal: 150, kitCount: 3
    });
    var m = sent();
    expect(m.subject).not.toMatch(/[\r\n]/);
    expect(m.text).toContain('Hi Evil Bcc: a@b.com,');
    expect(m.text).not.toContain('\r');

    jest.clearAllMocks();
    await mailer.sendPreorderDepositNotification({
      name: 'Evil\r\nBcc: a@b.com', email: 'c@x.com', phone: '1\n2', salesorders: SOS,
      depositTotal: 150, kitCount: 3, txnId: 'T1'
    });
    var s = sent();
    expect(s.subject).not.toMatch(/[\r\n]/);
    expect(s.text).toContain('Name:  Evil Bcc: a@b.com');
    expect(s.text).not.toContain('\r');
  });

  test('staff notification lists every SO, txn and contact', async function () {
    await mailer.sendPreorderDepositNotification({
      name: 'Pat', email: 'c@x.com', phone: '604', salesorders: SOS,
      depositTotal: 150, kitCount: 3, txnId: 'TXN-9'
    });
    var m = sent();
    expect(m.to).toEqual(['staff@example.com']);
    expect(m.subject).toBe('New Limited Release deposit: 3 kits, $150.00');
    ['SO-001001', 'SO-001002', 'SO-001003'].forEach(function (n) { expect(m.text).toContain(n); });
    expect(m.text).toContain('TXN-9');
    expect(m.text).toContain('c@x.com');
    expect(m.text).toContain('604');
  });

  test('cleanup alert: leftovers, void status, orphan hint', async function () {
    await mailer.sendPreorderCleanupAlert({
      txnId: 'TXN-9', voided: false, possibleOrphan: true,
      leftovers: [{ kind: 'salesorder', id: '111', error: 'delete failed' }, { kind: 'contact', id: '222' }]
    });
    var m = sent();
    expect(m.to).toEqual(['staff@example.com']);
    expect(m.subject).toBe('ACTION NEEDED: Limited Release deposit failed after charge (txn TXN-9)');
    expect(m.text).toContain('NOT voided');
    expect(m.text).toContain('salesorder 111');
    expect(m.text).toContain('contact 222');
    expect(m.text).toContain('LIMITED-2026-27');
    expect(m.text).toContain('a Zoho create timed out');
  });

  test('cleanup alert: Reason line only when a reason is given', async function () {
    await mailer.sendPreorderCleanupAlert({ txnId: 'T', voided: true, leftovers: [], reason: 'x' });
    expect(sent().text).toContain('Reason: x');
    expect(sent().text).toContain('voided successfully');

    jest.clearAllMocks();
    await mailer.sendPreorderCleanupAlert({ txnId: 'T', voided: true, leftovers: [] });
    expect(sent().text).not.toContain('Reason:');
    expect(sent().text).not.toContain('a Zoho create timed out');
  });
});
