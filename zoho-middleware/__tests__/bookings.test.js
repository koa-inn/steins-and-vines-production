'use strict';

jest.mock('express', () => {
  var router = { get: jest.fn(), post: jest.fn() };
  var express = function () {};
  express.Router = function () { return router; };
  return express;
});
jest.mock('../lib/zoho-api', () => ({
  bookingsGet: jest.fn(),
  bookingsPost: jest.fn(),
  zohoGet: jest.fn(),
  zohoPost: jest.fn(),
  normalizeTimeTo24h: jest.fn()
}));
jest.mock('../lib/cache', () => ({
  get: jest.fn(),
  set: jest.fn().mockResolvedValue('OK')
}));
jest.mock('../lib/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn()
}));
jest.mock('../lib/constants', () => ({
  CACHE_KEYS: {
    AVAILABILITY_PREFIX: 'test:avail:',
    BOOKING_SERVICES: 'test:booking-services',
    SLOTS_PREFIX: 'test:slots:'
  }
}));

describe('bookings routes — cache handling', () => {
  var cache, router, handlers;

  beforeEach(() => {
    jest.resetModules();
    cache = require('../lib/cache');
    require('../routes/bookings');
    router = require('express').Router();
    handlers = {};
    router.get.mock.calls.forEach(function (call) {
      handlers[call[0]] = call[call.length - 1];
    });
  });

  function mockRes() {
    var res = { json: jest.fn(), status: jest.fn() };
    res.status.mockReturnValue(res);
    return res;
  }

  test('/api/bookings/services returns cached data without double-parsing', async () => {
    var payload = { services: [{ id: 1 }], staff: [{ id: 2 }] };
    cache.get.mockResolvedValue(payload);

    var res = mockRes();
    await handlers['/api/bookings/services']({}, res);

    expect(res.json).toHaveBeenCalledWith(payload);
    expect(res.json.mock.calls[0][0]).toEqual(payload);
    expect(typeof res.json.mock.calls[0][0]).toBe('object');
  });

  test('/api/bookings/slots returns cached data without double-parsing', async () => {
    var payload = { date: '2026-04-18', slots: [{ time: '10:00' }] };
    cache.get.mockResolvedValue(payload);

    var res = mockRes();
    var req = { query: { date: '2026-04-18' } };
    await handlers['/api/bookings/slots'](req, res);

    expect(res.json).toHaveBeenCalledWith(payload);
    expect(typeof res.json.mock.calls[0][0]).toBe('object');
  });
});
