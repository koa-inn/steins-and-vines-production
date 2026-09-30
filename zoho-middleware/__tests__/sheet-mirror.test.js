'use strict';

// Tests for lib/sheet-mirror.js — Phase 83 Plan 04 Task 1 (D-07).
//
// Environment-name values below are the RECORDED values from
// docs/RUNBOOK.md's "Railway Postgres (staging + production)" provisioning
// record (Plan 83-01): RAILWAY_ENVIRONMENT_NAME = 'production' in production,
// 'staging' in staging — NOT assumed.

jest.mock('../lib/logger', function () {
  return { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
});

var mockCaptureExceptionSafe = jest.fn();
jest.mock('../lib/sentry-capture', function () {
  return { captureExceptionSafe: function (err, opts) { return mockCaptureExceptionSafe(err, opts); } };
});

var RECORDED_PRODUCTION_NAME = 'production';
var RECORDED_STAGING_NAME = 'staging';

describe('sheet-mirror', function () {
  var sheetMirror;
  var log;
  var SAVED_ENV;

  beforeEach(function () {
    SAVED_ENV = Object.assign({}, process.env);
    jest.resetModules();

    delete process.env.NODE_ENV;
    delete process.env.RAILWAY_ENVIRONMENT_NAME;
    delete process.env.MIRROR_ENABLED;
    delete process.env.SHEET_MIRROR;
    delete process.env.FORCE_MIRROR;

    mockCaptureExceptionSafe.mockReset();

    sheetMirror = require('../lib/sheet-mirror');
    log = require('../lib/logger');
  });

  afterEach(function () {
    Object.keys(process.env).forEach(function (k) {
      if (!(k in SAVED_ENV)) delete process.env[k];
    });
    Object.keys(SAVED_ENV).forEach(function (k) {
      process.env[k] = SAVED_ENV[k];
    });
  });

  test('PRODUCTION_ENVIRONMENT_NAME is the recorded production value', function () {
    expect(sheetMirror.PRODUCTION_ENVIRONMENT_NAME).toBe(RECORDED_PRODUCTION_NAME);
  });

  describe('isProductionEnvironment / isMirrorEnabled', function () {
    test('NODE_ENV=production + RAILWAY_ENVIRONMENT_NAME=<recorded production> -> true', function () {
      process.env.NODE_ENV = 'production';
      process.env.RAILWAY_ENVIRONMENT_NAME = RECORDED_PRODUCTION_NAME;
      expect(sheetMirror.isProductionEnvironment()).toBe(true);
      expect(sheetMirror.isMirrorEnabled()).toBe(true);
    });

    test('NODE_ENV=production + RAILWAY_ENVIRONMENT_NAME=<recorded staging> -> false', function () {
      process.env.NODE_ENV = 'production';
      process.env.RAILWAY_ENVIRONMENT_NAME = RECORDED_STAGING_NAME;
      expect(sheetMirror.isMirrorEnabled()).toBe(false);
    });

    test('RAILWAY_ENVIRONMENT_NAME unset -> false', function () {
      process.env.NODE_ENV = 'production';
      expect(sheetMirror.isMirrorEnabled()).toBe(false);
    });

    test('NODE_ENV != production with the production name -> false', function () {
      process.env.RAILWAY_ENVIRONMENT_NAME = RECORDED_PRODUCTION_NAME;
      expect(sheetMirror.isMirrorEnabled()).toBe(false);
    });

    test('different case -> false (no lowercasing)', function () {
      process.env.NODE_ENV = 'production';
      process.env.RAILWAY_ENVIRONMENT_NAME = 'Production';
      expect(sheetMirror.isMirrorEnabled()).toBe(false);
    });

    test('leading whitespace -> false (no trimming)', function () {
      process.env.NODE_ENV = 'production';
      process.env.RAILWAY_ENVIRONMENT_NAME = ' production';
      expect(sheetMirror.isMirrorEnabled()).toBe(false);
    });

    test('trailing whitespace -> false (no trimming)', function () {
      process.env.NODE_ENV = 'production';
      process.env.RAILWAY_ENVIRONMENT_NAME = 'production ';
      expect(sheetMirror.isMirrorEnabled()).toBe(false);
    });

    test('plausible override vars on staging do not enable the mirror', function () {
      process.env.NODE_ENV = 'production';
      process.env.RAILWAY_ENVIRONMENT_NAME = RECORDED_STAGING_NAME;
      process.env.MIRROR_ENABLED = 'true';
      process.env.SHEET_MIRROR = 'on';
      process.env.FORCE_MIRROR = '1';
      expect(sheetMirror.isMirrorEnabled()).toBe(false);
    });
  });

  describe('mirrorFireAndForget', function () {
    test('disabled -> fn never called, returns undefined', function () {
      var fn = jest.fn();
      var result = sheetMirror.mirrorFireAndForget('test-mirror', fn);
      expect(fn).not.toHaveBeenCalled();
      expect(result).toBeUndefined();
    });

    test('enabled -> fn called once, returns undefined synchronously', function () {
      process.env.NODE_ENV = 'production';
      process.env.RAILWAY_ENVIRONMENT_NAME = RECORDED_PRODUCTION_NAME;
      var fn = jest.fn().mockResolvedValue('ok');
      var result = sheetMirror.mirrorFireAndForget('test-mirror', fn);
      expect(fn).toHaveBeenCalledTimes(1);
      expect(result).toBeUndefined();
    });

    test('enabled -> a rejected promise from fn is swallowed and reported', function () {
      process.env.NODE_ENV = 'production';
      process.env.RAILWAY_ENVIRONMENT_NAME = RECORDED_PRODUCTION_NAME;
      var err = new Error('boom');
      var fn = jest.fn().mockRejectedValue(err);

      sheetMirror.mirrorFireAndForget('test-mirror', fn);

      return new Promise(function (resolve) { setImmediate(resolve); }).then(function () {
        expect(mockCaptureExceptionSafe).toHaveBeenCalledWith(err, expect.objectContaining({
          level: 'warning',
          tags: { component: 'sheet-mirror', mirror: 'test-mirror' }
        }));
        expect(log.warn).toHaveBeenCalled();
      });
    });

    test('enabled -> a synchronous throw from fn is swallowed and reported', function () {
      process.env.NODE_ENV = 'production';
      process.env.RAILWAY_ENVIRONMENT_NAME = RECORDED_PRODUCTION_NAME;
      var err = new Error('sync boom');
      var fn = jest.fn(function () { throw err; });

      var result = sheetMirror.mirrorFireAndForget('test-mirror', fn);

      expect(result).toBeUndefined();
      expect(mockCaptureExceptionSafe).toHaveBeenCalledWith(err, expect.objectContaining({
        level: 'warning',
        tags: { component: 'sheet-mirror', mirror: 'test-mirror' }
      }));
    });
  });

  describe('logMirrorStatus', function () {
    test('logs exactly one info line containing ENABLED and the environment name', function () {
      process.env.NODE_ENV = 'production';
      process.env.RAILWAY_ENVIRONMENT_NAME = RECORDED_PRODUCTION_NAME;
      sheetMirror.logMirrorStatus();
      expect(log.info).toHaveBeenCalledTimes(1);
      var msg = log.info.mock.calls[0][0];
      expect(msg).toEqual(expect.stringContaining('ENABLED'));
      expect(msg).toEqual(expect.stringContaining(RECORDED_PRODUCTION_NAME));
    });

    test('logs exactly one info line containing DISABLED when not in production', function () {
      process.env.NODE_ENV = 'production';
      process.env.RAILWAY_ENVIRONMENT_NAME = RECORDED_STAGING_NAME;
      sheetMirror.logMirrorStatus();
      expect(log.info).toHaveBeenCalledTimes(1);
      var msg = log.info.mock.calls[0][0];
      expect(msg).toEqual(expect.stringContaining('DISABLED'));
      expect(msg).toEqual(expect.stringContaining(RECORDED_STAGING_NAME));
    });
  });
});
