'use strict';

// ---------------------------------------------------------------------------
// redis-guard contract test — 52-01 (RESIL-01)
//
// Defines the discriminated-result contract for the shared
// closed-on-Redis-error helper BEFORE it exists (RED step of TDD).
//
// Mirrors the discriminated-result shape of lib/money-path.js
// (acquireIdempotencyLock / assertTxnNotReplayed): the helper never throws
// on the guarded path, it returns { status: ... } instead.
//
// No real Redis — fn is injected directly (resolve for happy path,
// reject for the failclosed / dev-fallback paths).
// ---------------------------------------------------------------------------

jest.mock('../lib/logger', function () {
  return { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
});

var redisGuard = require('../lib/redis-guard');

describe('closedOnRedisError', function () {
  test('resolves value → { status: "value", value }', async function () {
    var fn = jest.fn().mockResolvedValue('the-value');
    var result = await redisGuard.closedOnRedisError(fn);
    expect(result).toEqual({ status: 'value', value: 'the-value' });
  });

  test('opts.isProd:true + fn throws → { status: "failclosed" } (prod fails closed)', async function () {
    var fn = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    var result = await redisGuard.closedOnRedisError(fn, { isProd: true });
    expect(result).toEqual({ status: 'failclosed' });
  });

  test('opts.alwaysClosed:true + fn throws → { status: "failclosed" } regardless of isProd', async function () {
    var fn = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    var result = await redisGuard.closedOnRedisError(fn, { alwaysClosed: true, isProd: false });
    expect(result).toEqual({ status: 'failclosed' });
  });

  test('opts.isProd:false + fn throws → { status: "value", value: opts.devFallback } (dev fail-open convenience)', async function () {
    var fn = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    var result = await redisGuard.closedOnRedisError(fn, { isProd: false, devFallback: 'fallback-value' });
    expect(result).toEqual({ status: 'value', value: 'fallback-value' });
  });
});
