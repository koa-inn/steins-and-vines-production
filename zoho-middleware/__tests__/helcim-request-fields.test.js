'use strict';

// Helcim v2 request field names for void (reverse) and refund.
//
// 2026-10-06: every production void failed. First with 401 (the API token's
// Transaction Processing permission was "Positive Transaction" — fixed in
// the Helcim dashboard), then, once authorised, with:
//   400 {"errors":{"cardTransactionId":"Missing required data card Transaction Id",
//                  "ipAddress":"Missing required data ip Address"}}
// because voidTransaction sent { transactionId }. Helcim's documented bodies
// (devdocs.helcim.com, verified 2026-10-06):
//   POST /v2/payment/reverse { cardTransactionId: integer, ipAddress: string }
//   POST /v2/payment/refund  { originalTransactionId: integer, amount, ipAddress }
// A manual reverse with exactly that body (ipAddress "127.0.0.1") on test
// txn 56129497 returned 200 type "reverse" status "APPROVED" (reversal
// 56129650) — the fixture below is that response with card/PII fields removed.

jest.mock('axios');

var axios = require('axios');
var helcim = require('../lib/helcim');

var REAL_REVERSE_RESPONSE = {
  transactionId: 56129650,
  dateCreated: '2026-10-06 16:08:57',
  cardBatchId: 7287581,
  status: 'APPROVED',
  user: 'Helcim System',
  type: 'reverse',
  amount: 1.05,
  currency: 'CAD',
  warning: ''
};

describe('Helcim request bodies match the v2 API', function () {
  beforeEach(function () {
    jest.clearAllMocks();
    process.env.HELCIM_API_TOKEN = 'test-token-fields';
    helcim.init();
  });

  afterEach(function () {
    delete process.env.HELCIM_API_TOKEN;
  });

  test('voidTransaction posts cardTransactionId (integer) + ipAddress to /payment/reverse', function () {
    axios.post.mockResolvedValue({ data: REAL_REVERSE_RESPONSE });
    return helcim.voidTransaction('56129497').then(function (result) {
      var call = axios.post.mock.calls[0];
      expect(call[0]).toMatch(/\/payment\/reverse$/);
      expect(call[1]).toEqual({ cardTransactionId: 56129497, ipAddress: '127.0.0.1' });
      expect(result).toMatchObject({ ok: true, transactionId: '56129497' });
    });
  });

  test('voidTransaction accepts a numeric id as-is', function () {
    axios.post.mockResolvedValue({ data: REAL_REVERSE_RESPONSE });
    return helcim.voidTransaction(55952401).then(function () {
      expect(axios.post.mock.calls[0][1].cardTransactionId).toBe(55952401);
    });
  });

  test('getCardTransactionById passes Helcim\'s transaction type through (lower-cased)', function () {
    axios.get.mockResolvedValue({ data: Object.assign({ invoiceNumber: 'KIOSK-1791324387910' }, REAL_REVERSE_RESPONSE) });
    return helcim.getCardTransactionById('56129650').then(function (t) {
      expect(t.type).toBe('reverse');
      expect(t.status).toBe('APPROVED');
      expect(t.invoiceNumber).toBe('KIOSK-1791324387910');
    });
  });

  test('refundTransaction posts originalTransactionId (integer) + amount + ipAddress to /payment/refund', function () {
    axios.post.mockResolvedValue({ data: { transactionId: 999, status: 'APPROVED', type: 'refund' } });
    return helcim.refundTransaction('56129497', 12.5).then(function () {
      var call = axios.post.mock.calls[0];
      expect(call[0]).toMatch(/\/payment\/refund$/);
      expect(call[1]).toEqual({ originalTransactionId: 56129497, amount: 12.5, ipAddress: '127.0.0.1' });
    });
  });
});
