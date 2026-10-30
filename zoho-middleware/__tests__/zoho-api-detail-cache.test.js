'use strict';

// Quick task 261029-zq1 Task 3 — cheaper catalog refresh.
//
// Every kiosk/website catalog rebuild re-fetched /itemdetails for ~540 items
// (6 calls) even though detail fields (tax, custom fields, brand, image) almost
// never change; only stock does, and stock comes from the list endpoint. Item
// details are now cached per item_id in Redis for 6 h, so fetchItemDetailsBulk
// only asks Zoho for ids it has not seen recently. { force: true } (the
// explicit ?bust=1 / admin cache-clear path) bypasses the cache.

jest.mock('../lib/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));
jest.mock('../lib/zohoAuth', () => ({ getAccessToken: jest.fn().mockResolvedValue('mock-token') }));
jest.mock('axios', () => ({ get: jest.fn(), post: jest.fn(), put: jest.fn() }));

var mockStore = {};
jest.mock('../lib/cache', () => ({
  get: jest.fn(function (k) {
    return Promise.resolve(Object.prototype.hasOwnProperty.call(mockStore, k) ? mockStore[k] : null);
  }),
  set: jest.fn(function (k, v) { mockStore[k] = v; return Promise.resolve(); }),
  del: jest.fn(function (k) { delete mockStore[k]; return Promise.resolve(); }),
  acquireLock: jest.fn().mockResolvedValue(true),
  releaseLock: jest.fn().mockResolvedValue(),
  isConnected: jest.fn().mockReturnValue(true)
}));

const axios = require('axios');
const cache = require('../lib/cache');
const C = require('../lib/constants');
const { fetchItemDetailsBulk } = require('../lib/zoho-api');

function detailsResponse(ids) {
  return { data: { items: ids.map(function (id) { return { item_id: id, tax_percentage: 12, name: 'Item ' + id }; }) } };
}

function requestedIds(callIdx) {
  return axios.get.mock.calls[callIdx][1].params.item_ids.split(',');
}

beforeEach(() => {
  jest.clearAllMocks();
  mockStore = {};
  process.env.ZOHO_ORG_ID = 'org-123';
  axios.get.mockImplementation(function (url, cfg) {
    return Promise.resolve(detailsResponse(cfg.params.item_ids.split(',')));
  });
});

describe('fetchItemDetailsBulk detail cache', () => {
  test('constant: per-item detail key prefix', () => {
    expect(C.CACHE_KEYS.ITEM_DETAIL_PREFIX).toBe('zoho:itemdetail:');
  });

  test('cold cache: fetches all ids and caches each detail for 6 h', async () => {
    var map = await fetchItemDetailsBulk(['a', 'b']);
    expect(axios.get).toHaveBeenCalledTimes(1);
    expect(Object.keys(map).sort()).toEqual(['a', 'b']);
    var writes = cache.set.mock.calls.filter(function (c) { return c[0].indexOf('zoho:itemdetail:') === 0; });
    expect(writes.map(function (c) { return c[0]; }).sort()).toEqual(['zoho:itemdetail:a', 'zoho:itemdetail:b']);
    writes.forEach(function (c) { expect(c[2]).toBe(6 * 3600); });
  });

  test('warm cache: no Zoho call at all, details returned from Redis', async () => {
    mockStore['zoho:itemdetail:a'] = { item_id: 'a', tax_percentage: 5 };
    mockStore['zoho:itemdetail:b'] = { item_id: 'b', tax_percentage: 0 };
    var map = await fetchItemDetailsBulk(['a', 'b']);
    expect(axios.get).not.toHaveBeenCalled();
    expect(map.a.tax_percentage).toBe(5);
    expect(map.b.tax_percentage).toBe(0);
  });

  test('partial cache: only missing ids are requested; result is merged', async () => {
    mockStore['zoho:itemdetail:a'] = { item_id: 'a', name: 'cached A' };
    var map = await fetchItemDetailsBulk(['a', 'b', 'c']);
    expect(axios.get).toHaveBeenCalledTimes(1);
    expect(requestedIds(0)).toEqual(['b', 'c']);
    expect(map.a.name).toBe('cached A');
    expect(map.b.name).toBe('Item b');
    expect(map.c.name).toBe('Item c');
  });

  test('chunking (100 per call) applies to the missing ids only', async () => {
    var ids = [];
    for (var i = 0; i < 250; i++) ids.push('i' + i);
    for (var j = 0; j < 150; j++) mockStore['zoho:itemdetail:i' + j] = { item_id: 'i' + j };
    var map = await fetchItemDetailsBulk(ids);
    expect(axios.get).toHaveBeenCalledTimes(1);
    expect(requestedIds(0)).toHaveLength(100);
    expect(Object.keys(map)).toHaveLength(250);
  });

  test('{ force: true } bypasses the cache and refreshes it', async () => {
    mockStore['zoho:itemdetail:a'] = { item_id: 'a', name: 'old A' };
    var map = await fetchItemDetailsBulk(['a'], { force: true });
    expect(axios.get).toHaveBeenCalledTimes(1);
    expect(map.a.name).toBe('Item a');
    expect(mockStore['zoho:itemdetail:a'].name).toBe('Item a');
  });

  test('a cached detail with null tax_percentage is returned unchanged (CR-02 null semantics)', async () => {
    mockStore['zoho:itemdetail:a'] = { item_id: 'a', tax_percentage: null };
    var map = await fetchItemDetailsBulk(['a']);
    expect(map.a.tax_percentage).toBeNull();
  });

  test('Redis read failure degrades to a full fetch', async () => {
    cache.get.mockImplementationOnce(function () { return Promise.reject(new Error('redis down')); });
    var map = await fetchItemDetailsBulk(['a', 'b']);
    expect(axios.get).toHaveBeenCalledTimes(1);
    expect(requestedIds(0)).toEqual(['a', 'b']);
    expect(Object.keys(map).sort()).toEqual(['a', 'b']);
  });

  test('empty id list: no Zoho call', async () => {
    var map = await fetchItemDetailsBulk([]);
    expect(axios.get).not.toHaveBeenCalled();
    expect(map).toEqual({});
  });
});
