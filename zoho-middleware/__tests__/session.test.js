'use strict';

/**
 * Unit tests for lib/session.js — Redis-backed opaque session store with
 * in-process fallback (D-46-04 / Finding #5).
 *
 * Mocks ../lib/cache entirely (get/set/del/isConnected) so these tests
 * exercise only session.js's own logic: id generation, write-through to the
 * in-process Map, the Redis-vs-in-process dispatch in getSession, destroy,
 * and touchSession's coarse (>1h) sliding-expiry refresh.
 */

jest.mock('../lib/cache', function () {
  return {
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
    isConnected: jest.fn(),
  };
});

var cache = require('../lib/cache');
var session = require('../lib/session');

var SEVEN_DAYS_SECONDS = 7 * 24 * 3600;

describe('lib/session — Redis-backed session store with in-process fallback', function () {
  beforeEach(function () {
    jest.clearAllMocks();
    cache.isConnected.mockReturnValue(true);
    cache.set.mockResolvedValue();
    cache.get.mockResolvedValue(null);
    cache.del.mockResolvedValue();
  });

  test('createSession returns a 64-hex-char opaque id', function () {
    return session.createSession('staff@example.com').then(function (sid) {
      expect(typeof sid).toBe('string');
      expect(sid).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  test('createSession writes session:<id> to cache with { email, createdAt } at 7-day TTL', function () {
    return session.createSession('staff@example.com').then(function (sid) {
      expect(cache.set).toHaveBeenCalledTimes(1);
      var args = cache.set.mock.calls[0];
      expect(args[0]).toBe('session:' + sid);
      expect(args[1].email).toBe('staff@example.com');
      expect(typeof args[1].createdAt).toBe('number');
      expect(args[2]).toBe(SEVEN_DAYS_SECONDS);
    });
  });

  test('getSession(id) returns the payload from Redis when connected', function () {
    cache.isConnected.mockReturnValue(true);
    cache.get.mockResolvedValue({ email: 'staff@example.com', createdAt: 123 });
    return session.getSession('some-id').then(function (payload) {
      expect(cache.get).toHaveBeenCalledWith('session:some-id');
      expect(payload).toEqual({ email: 'staff@example.com', createdAt: 123 });
    });
  });

  test('getSession(unknownId) returns null when Redis has no entry', function () {
    cache.isConnected.mockReturnValue(true);
    cache.get.mockResolvedValue(null);
    return session.getSession('unknown-id').then(function (payload) {
      expect(payload).toBeNull();
    });
  });

  test('getSession falls back to the in-process Map when Redis is disconnected (survives a blip)', function () {
    return session.createSession('kiosk-staff@example.com').then(function (sid) {
      // Redis blips mid-lifetime
      cache.isConnected.mockReturnValue(false);
      return session.getSession(sid).then(function (payload) {
        expect(cache.get).not.toHaveBeenCalled();
        expect(payload).not.toBeNull();
        expect(payload.email).toBe('kiosk-staff@example.com');
      });
    });
  });

  test('getSession(unknownId) returns null when Redis is disconnected and no in-process entry exists', function () {
    cache.isConnected.mockReturnValue(false);
    return session.getSession('never-created').then(function (payload) {
      expect(payload).toBeNull();
    });
  });

  test('destroySession removes the session from both Redis and the in-process Map', function () {
    return session.createSession('staff@example.com').then(function (sid) {
      return session.destroySession(sid).then(function () {
        expect(cache.del).toHaveBeenCalledWith('session:' + sid);
        // Now simulate a Redis blip — in-process copy must also be gone (signed out)
        cache.isConnected.mockReturnValue(false);
        return session.getSession(sid).then(function (payload) {
          expect(payload).toBeNull();
        });
      });
    });
  });

  test('touchSession does NOT re-write when lastRefresh is less than 1 hour old', function () {
    return session.createSession('staff@example.com').then(function (sid) {
      cache.set.mockClear();
      cache.get.mockResolvedValue({
        email: 'staff@example.com',
        createdAt: Date.now() - 1000,
        lastRefresh: Date.now() - 1000, // 1 second ago — well under 1h
      });
      return session.touchSession(sid).then(function () {
        expect(cache.set).not.toHaveBeenCalled();
      });
    });
  });

  test('touchSession re-sets the same TTL when lastRefresh is older than 1 hour', function () {
    return session.createSession('staff@example.com').then(function (sid) {
      cache.set.mockClear();
      var twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000;
      cache.get.mockResolvedValue({
        email: 'staff@example.com',
        createdAt: twoHoursAgo,
        lastRefresh: twoHoursAgo,
      });
      return session.touchSession(sid).then(function () {
        expect(cache.set).toHaveBeenCalledTimes(1);
        var args = cache.set.mock.calls[0];
        expect(args[0]).toBe('session:' + sid);
        expect(args[1].email).toBe('staff@example.com');
        expect(args[1].lastRefresh).toBeGreaterThan(twoHoursAgo);
        expect(args[2]).toBe(SEVEN_DAYS_SECONDS);
      });
    });
  });
});
