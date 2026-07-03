'use strict';

// WR-01 regression: captureExceptionSafe() must NEVER throw, even if the
// underlying Sentry SDK does. Money-movement catch blocks call it before the
// orphan-charge void-on-failure logic, so a throw here would strand a charge
// (money taken, no order, no void). We isolate + harden that guarantee here
// rather than relying on the SDK's (real but implicit) non-throwing contract.

jest.mock('@sentry/node', function () {
  return {
    captureException: jest.fn(function () {
      throw new Error('simulated Sentry SDK failure');
    })
  };
});

var Sentry = require('@sentry/node');
var capture = require('../lib/sentry-capture');

describe('captureExceptionSafe', function () {
  beforeEach(function () {
    Sentry.captureException.mockClear();
  });

  it('does not throw when the underlying Sentry.captureException throws', function () {
    expect(function () {
      capture.captureExceptionSafe(new Error('boom'), { level: 'error' });
    }).not.toThrow();
  });

  it('still forwards err and options to the SDK', function () {
    var err = new Error('boom');
    var opts = { level: 'error', tags: { txnId: 'txn-1' } };
    capture.captureExceptionSafe(err, opts);
    expect(Sentry.captureException).toHaveBeenCalledWith(err, opts);
  });

  it('returns undefined instead of propagating the SDK failure', function () {
    var result = capture.captureExceptionSafe(new Error('boom'), { level: 'error' });
    expect(result).toBeUndefined();
  });
});
