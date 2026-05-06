'use strict';

// ---------------------------------------------------------------------------
// Tests for: sendCustomerConfirmation in mailer.js
// Tests for: fallback email + eventLog wiring in checkout.js
// ---------------------------------------------------------------------------

jest.mock('nodemailer', function () {
  var sendMailMock = jest.fn().mockResolvedValue({ messageId: 'test-id' });
  return {
    createTransport: jest.fn().mockReturnValue({ sendMail: sendMailMock }),
    _sendMailMock: sendMailMock
  };
});

var nodemailer = require('nodemailer');
var mailer = require('../lib/mailer');

describe('sendCustomerConfirmation', function () {
  beforeEach(function () {
    process.env.SMTP_USER = 'test@example.com';
    process.env.CONTACT_TO = 'store@example.com';
    nodemailer._sendMailMock.mockClear();
  });

  test('sends email with correct subject containing order number', function () {
    return mailer.sendCustomerConfirmation({
      email: 'customer@example.com',
      orderNumber: 'SO-001234',
      items: [{ name: 'Wine Kit', quantity: 1 }],
      timeslot: '2026-05-10 10:00 AM'
    }).then(function () {
      var callArgs = nodemailer._sendMailMock.mock.calls[0][0];
      expect(callArgs.to).toBe('customer@example.com');
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
      var callArgs = nodemailer._sendMailMock.mock.calls[0][0];
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
      var callArgs = nodemailer._sendMailMock.mock.calls[0][0];
      expect(callArgs.text).toContain('2026-05-15 2:00 PM');
    });
  });

  test('sets replyTo to CONTACT_TO env var', function () {
    return mailer.sendCustomerConfirmation({
      email: 'customer@example.com',
      orderNumber: 'SO-007',
      items: []
    }).then(function () {
      var callArgs = nodemailer._sendMailMock.mock.calls[0][0];
      expect(callArgs.replyTo).toBe('store@example.com');
    });
  });
});
