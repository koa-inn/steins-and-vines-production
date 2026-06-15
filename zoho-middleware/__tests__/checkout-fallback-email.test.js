'use strict';

// ---------------------------------------------------------------------------
// Tests for: mailer.js — sendCustomerConfirmation (customer order-confirmation
// email sent after checkout via the Resend HTTPS API; Railway blocks outbound SMTP).
// ---------------------------------------------------------------------------

jest.mock('axios', function () {
  return { post: jest.fn(), get: jest.fn() };
});

var axios = require('axios');
var mailer = require('../lib/mailer');

describe('sendCustomerConfirmation', function () {
  beforeEach(function () {
    process.env.RESEND_API_KEY = 're_test_123';
    process.env.CONTACT_TO = 'store@example.com';
    axios.post.mockReset();
    axios.post.mockResolvedValue({ data: { id: 'test-id' } });
  });

  test('sends email with correct subject containing order number', function () {
    return mailer.sendCustomerConfirmation({
      email: 'customer@example.com',
      orderNumber: 'SO-001234',
      items: [{ name: 'Wine Kit', quantity: 1 }],
      timeslot: '2026-05-10 10:00 AM'
    }).then(function () {
      var callArgs = axios.post.mock.calls[0][1];
      expect(callArgs.to).toEqual(['customer@example.com']);
      expect(callArgs.subject).toContain('SO-001234');
      expect(callArgs.subject).toContain('Steins & Vines');
    });
  });

  test('includes item names in body', function () {
    return mailer.sendCustomerConfirmation({
      email: 'customer@example.com',
      orderNumber: 'SO-005',
      items: [{ name: 'Pinot Noir Kit', quantity: 2 }, { name: 'Cider Kit', quantity: 1 }],
      timeslot: ''
    }).then(function () {
      var callArgs = axios.post.mock.calls[0][1];
      expect(callArgs.text).toContain('Pinot Noir Kit');
      expect(callArgs.text).toContain('Cider Kit');
    });
  });

  test('rejects with error if no email provided', function () {
    return expect(mailer.sendCustomerConfirmation({
      orderNumber: 'SO-005',
      items: []
    })).rejects.toThrow('No customer email provided');
  });

  test('includes timeslot when provided', function () {
    return mailer.sendCustomerConfirmation({
      email: 'customer@example.com',
      orderNumber: 'SO-006',
      items: [],
      timeslot: '2026-05-15 2:00 PM'
    }).then(function () {
      var callArgs = axios.post.mock.calls[0][1];
      expect(callArgs.text).toContain('2026-05-15 2:00 PM');
    });
  });

  test('sets reply_to to CONTACT_TO env var', function () {
    return mailer.sendCustomerConfirmation({
      email: 'customer@example.com',
      orderNumber: 'SO-007',
      items: []
    }).then(function () {
      var callArgs = axios.post.mock.calls[0][1];
      expect(callArgs.reply_to).toBe('store@example.com');
    });
  });
});
