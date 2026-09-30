'use strict';

// Tests for lib/db.js — Phase 83 Plan 02 Task 1 (DB-02 SC1/SC2)
//
// pg is mocked end-to-end: no real Postgres connection is made. The fake
// Pool constructor records constructor args and exposes query/connect/on/end
// so behavior can be asserted without a live database (that integration
// coverage comes later via the Testcontainers-backed __tests__/db/ suite,
// D-14).

jest.mock('pg', function () {
  function makeClient(overrides) {
    var opts = overrides || {};
    return {
      query: jest.fn(function (text) {
        if (text === 'ROLLBACK' && opts.rollbackRejects) {
          return Promise.reject(new Error('rollback failed'));
        }
        return Promise.resolve({ rows: [] });
      }),
      release: jest.fn()
    };
  }

  var nextClientOverrides = null;

  var PoolCtor = jest.fn().mockImplementation(function (opts) {
    var handlers = {};
    return {
      _opts: opts,
      _handlers: handlers,
      query: jest.fn().mockResolvedValue({ rows: [] }),
      connect: jest.fn().mockImplementation(function () {
        var overrides = nextClientOverrides;
        nextClientOverrides = null;
        return Promise.resolve(makeClient(overrides));
      }),
      on: jest.fn(function (event, handler) {
        handlers[event] = handlers[event] || [];
        handlers[event].push(handler);
      }),
      end: jest.fn().mockResolvedValue(undefined)
    };
  });

  return {
    Pool: PoolCtor,
    __setNextClientOverrides: function (overrides) {
      nextClientOverrides = overrides;
    }
  };
});

jest.mock('../lib/logger', function () {
  return { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
});

jest.mock('../lib/sentry-capture', function () {
  return { captureExceptionSafe: jest.fn() };
});

describe('lib/db.js', function () {
  var db, pg, log, sentryCapture;
  var SAVED_ENV;

  beforeEach(function () {
    SAVED_ENV = Object.assign({}, process.env);
    jest.resetModules();
    jest.clearAllMocks();
    delete process.env.DATABASE_URL;

    pg = require('pg');
    log = require('../lib/logger');
    sentryCapture = require('../lib/sentry-capture');
    db = require('../lib/db');
  });

  afterEach(function () {
    Object.keys(process.env).forEach(function (k) {
      if (!(k in SAVED_ENV)) delete process.env[k];
    });
    Object.keys(SAVED_ENV).forEach(function (k) {
      process.env[k] = SAVED_ENV[k];
    });
  });

  function configureDb(databaseUrl) {
    process.env.DATABASE_URL = databaseUrl;
    jest.resetModules();
    pg = require('pg');
    log = require('../lib/logger');
    sentryCapture = require('../lib/sentry-capture');
    db = require('../lib/db');
  }

  describe('sslConfigFor', function () {
    test('returns rejectUnauthorized:false for the Railway public TCP proxy host', function () {
      expect(db.sslConfigFor('postgresql://u:p@x.proxy.rlwy.net:12345/railway'))
        .toEqual({ rejectUnauthorized: false });
    });

    test('returns false for the private Railway internal host', function () {
      expect(db.sslConfigFor('postgresql://u:p@postgres.railway.internal:5432/railway')).toBe(false);
    });

    test('returns false for localhost', function () {
      expect(db.sslConfigFor('postgresql://u:p@localhost:5432/db')).toBe(false);
    });
  });

  describe('redactConnectionString', function () {
    test('redacts the password segment and never leaks the secret', function () {
      var result = db.redactConnectionString('postgresql://user:s3cret@h:5432/db');
      expect(result).toContain('user:***@');
      expect(result).not.toContain('s3cret');
    });

    test('is safe on non-string input', function () {
      expect(db.redactConnectionString(undefined)).toBe(undefined);
      expect(db.redactConnectionString(null)).toBe(null);
    });
  });

  describe('isConfigured', function () {
    test('is false when DATABASE_URL is unset', function () {
      expect(db.isConfigured()).toBe(false);
    });

    test('is true when DATABASE_URL is set', function () {
      configureDb('postgresql://u:p@localhost:5432/db');
      expect(db.isConfigured()).toBe(true);
    });
  });

  describe('query', function () {
    test('rejects with "DATABASE_URL not configured" and never constructs a Pool when unset', function () {
      return db.query('select 1').catch(function (err) {
        expect(err.message).toBe('DATABASE_URL not configured');
        expect(pg.Pool).not.toHaveBeenCalled();
      });
    });

    test('delegates to the pool query with the same text and params (parameterised)', function () {
      configureDb('postgresql://u:p@localhost:5432/db');
      return db.query('select $1', [1]).then(function () {
        var instance = pg.Pool.mock.results[0].value;
        expect(instance.query).toHaveBeenCalledWith('select $1', [1]);
      });
    });

    test('constructs the Pool lazily, only once across many calls, and registers the error listener', function () {
      configureDb('postgresql://u:p@localhost:5432/db');
      expect(pg.Pool).not.toHaveBeenCalled();
      return db.query('select 1').then(function () {
        return db.query('select 2');
      }).then(function () {
        expect(pg.Pool).toHaveBeenCalledTimes(1);
        var instance = pg.Pool.mock.results[0].value;
        expect(instance.on).toHaveBeenCalledWith('error', expect.any(Function));
      });
    });
  });

  describe('pool error handling (D-02, T-83-02-01/02)', function () {
    test('emitting "error" on the pool does not throw and the logged message contains no password', function () {
      configureDb('postgresql://user:s3cret@localhost:5432/db');
      return db.query('select 1').then(function () {
        var instance = pg.Pool.mock.results[0].value;
        var errorHandler = instance._handlers.error[0];
        var fakeErr = new Error('connection terminated: postgresql://user:s3cret@localhost:5432/db');
        expect(function () { errorHandler(fakeErr); }).not.toThrow();
        expect(log.error).toHaveBeenCalled();
        var loggedMessage = log.error.mock.calls[0][0];
        expect(loggedMessage).not.toContain('s3cret');
        expect(sentryCapture.captureExceptionSafe).toHaveBeenCalled();
      });
    });
  });

  describe('withTransaction', function () {
    beforeEach(function () {
      configureDb('postgresql://u:p@localhost:5432/db');
    });

    test('fn resolves: BEGIN then COMMIT, result returned, release() called once', function () {
      return db.withTransaction(function (client) {
        expect(client).toBeDefined();
        return Promise.resolve('the-result');
      }).then(function (result) {
        expect(result).toBe('the-result');
        var instance = pg.Pool.mock.results[0].value;
        expect(instance.connect).toHaveBeenCalledTimes(1);
        return instance.connect.mock.results[0].value.then(function (client) {
          expect(client.query.mock.calls.map(function (c) { return c[0]; })).toEqual(['BEGIN', 'COMMIT']);
          expect(client.release).toHaveBeenCalledTimes(1);
        });
      });
    });

    test('fn rejects: BEGIN then ROLLBACK, original error rethrown, release() called once', function () {
      var originalErr = new Error('boom');
      return db.withTransaction(function () {
        return Promise.reject(originalErr);
      }).then(function () {
        throw new Error('expected withTransaction to reject');
      }, function (err) {
        expect(err).toBe(originalErr);
        var instance = pg.Pool.mock.results[0].value;
        return instance.connect.mock.results[0].value.then(function (client) {
          expect(client.query.mock.calls.map(function (c) { return c[0]; })).toEqual(['BEGIN', 'ROLLBACK']);
          expect(client.release).toHaveBeenCalledTimes(1);
        });
      });
    });

    test('ROLLBACK itself failing does not mask the original error; release() still called', function () {
      pg.__setNextClientOverrides({ rollbackRejects: true });
      var originalErr = new Error('boom');
      return db.withTransaction(function () {
        return Promise.reject(originalErr);
      }).then(function () {
        throw new Error('expected withTransaction to reject');
      }, function (err) {
        expect(err).toBe(originalErr);
        var instance = pg.Pool.mock.results[0].value;
        return instance.connect.mock.results[0].value.then(function (client) {
          expect(client.release).toHaveBeenCalledTimes(1);
        });
      });
    });
  });

  describe('close', function () {
    test('ends the pool and a later query() constructs a new one', function () {
      configureDb('postgresql://u:p@localhost:5432/db');
      return db.query('select 1').then(function () {
        var firstInstance = pg.Pool.mock.results[0].value;
        return db.close().then(function () {
          expect(firstInstance.end).toHaveBeenCalledTimes(1);
          return db.query('select 2');
        });
      }).then(function () {
        expect(pg.Pool).toHaveBeenCalledTimes(2);
      });
    });
  });
});
