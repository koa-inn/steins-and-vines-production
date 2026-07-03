'use strict';

// Regression proof for D-03/D-04: a seeded customer email and a raw payment
// amount attached to a Sentry event never survive to send, and same-class
// errors group into one fingerprint. Tests the scrub module directly (does
// NOT boot the server — no server.js require, no supertest).

var scrub = require('../lib/sentry-scrub');

describe('sentry-scrub beforeSend path', function () {
  function seededEvent(exceptionType) {
    return {
      user: { email: 'jacob@gmail.com' },
      tags: {
        reqId: 'req-abc123',
        txnId: 'txn-999',
        invoiceId: 'inv-42',
        salesorder_id: 'so-7',
        amount: '19.99'
      },
      extra: {
        grandTotal: 45.5,
        customerEmail: 'jacob@gmail.com'
      },
      request: {
        data: { email: 'jacob@gmail.com', total: 45.5 },
        cookies: { session: 'secret-session' },
        headers: { authorization: 'Bearer super-secret' }
      },
      exception: {
        values: [{ type: exceptionType || 'TypeError', value: 'boom' }]
      }
    };
  }

  it('strips the customer email and raw amount before send', function () {
    var event = seededEvent();
    var scrubbed = scrub.scrubEvent(event);

    // Email masked, not raw.
    expect(scrubbed.user.email).not.toBe('jacob@gmail.com');
    expect(scrubbed.user.email).toContain('***');

    // Raw amount / total keys removed from tags and extra.
    expect(scrubbed.tags.amount).toBeUndefined();
    expect(scrubbed.extra.grandTotal).toBeUndefined();
    expect(scrubbed.extra.customerEmail).not.toBe('jacob@gmail.com');

    // request.data/cookies/headers removed entirely (T-53-01/T-53-03).
    expect(scrubbed.request.data).toBeUndefined();
    expect(scrubbed.request.cookies).toBeUndefined();
    expect(scrubbed.request.headers).toBeUndefined();
  });

  it('preserves safe correlation ids in tags', function () {
    var event = seededEvent();
    var scrubbed = scrub.scrubEvent(event);

    expect(scrubbed.tags.reqId).toBe('req-abc123');
    expect(scrubbed.tags.txnId).toBe('txn-999');
    expect(scrubbed.tags.invoiceId).toBe('inv-42');
    expect(scrubbed.tags.salesorder_id).toBe('so-7');
  });

  it('groups events of the same error class to the same fingerprint', function () {
    var eventA = seededEvent('TypeError');
    var eventB = seededEvent('TypeError');

    expect(scrub.fingerprintFor(eventA)).toEqual(scrub.fingerprintFor(eventB));
    expect(scrub.fingerprintFor(eventA)).toEqual(['TypeError']);
  });

  it('gives different error classes different fingerprints', function () {
    var eventA = seededEvent('TypeError');
    var eventB = seededEvent('RangeError');

    expect(scrub.fingerprintFor(eventA)).not.toEqual(scrub.fingerprintFor(eventB));
  });

  // CR-01 regression: captureException(err) feeds err.message straight into
  // event.exception.values[].value. That message is the money-path's dominant
  // leak vector — a raw email or amount there must never survive to send
  // (T-53-02). Same for breadcrumbs echoed from console-logged amounts.
  it('scrubs raw email and amount from the exception message', function () {
    var event = {
      exception: {
        values: [{
          type: 'Error',
          value: 'charge failed for jacob@gmail.com: total=$45.50 gift_card=$10.00'
        }]
      }
    };

    var scrubbed = scrub.scrubEvent(event);
    var msg = scrubbed.exception.values[0].value;

    expect(msg).not.toContain('jacob@gmail.com');
    expect(msg).toContain('***');
    expect(msg).not.toContain('45.50');
    expect(msg).not.toContain('$45.50');
    expect(msg).not.toContain('10.00');
    // Error class preserved for fingerprinting/debuggability.
    expect(scrubbed.exception.values[0].type).toBe('Error');
    expect(msg).toContain('charge failed');
  });

  it('scrubs raw amounts and emails from breadcrumbs', function () {
    var event = {
      breadcrumbs: [
        {
          category: 'console',
          message: '[pos/kiosk/sale] Pushing to terminal: total=$45.50 for jacob@gmail.com'
        },
        {
          category: 'console',
          message: 'ok',
          data: { amount: 45.5, customerEmail: 'jacob@gmail.com', reqId: 'req-abc123' }
        }
      ]
    };

    var scrubbed = scrub.scrubEvent(event);

    expect(scrubbed.breadcrumbs[0].message).not.toContain('$45.50');
    expect(scrubbed.breadcrumbs[0].message).not.toContain('45.50');
    expect(scrubbed.breadcrumbs[0].message).not.toContain('jacob@gmail.com');

    // Money-keyed breadcrumb data dropped; email masked; safe id preserved.
    expect(scrubbed.breadcrumbs[1].data.amount).toBeUndefined();
    expect(scrubbed.breadcrumbs[1].data.customerEmail).not.toBe('jacob@gmail.com');
    expect(scrubbed.breadcrumbs[1].data.reqId).toBe('req-abc123');
  });
});
