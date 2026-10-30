'use strict';

// Quick task 261029-zq1 Task 4 — every Zoho Inventory request feeds the quota
// guard, and once the daily quota is exhausted (429 code 45) no further
// Inventory call is attempted until the reset. Zoho Books calls (separate
// limit) are unaffected.

jest.mock('../lib/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));
jest.mock('../lib/zohoAuth', () => ({ getAccessToken: jest.fn().mockResolvedValue('mock-token') }));
jest.mock('axios', () => ({ get: jest.fn(), post: jest.fn(), put: jest.fn() }));
jest.mock('../lib/cache', () => ({
  get: jest.fn().mockResolvedValue(null),
  set: jest.fn().mockResolvedValue(),
  del: jest.fn().mockResolvedValue(),
  acquireLock: jest.fn().mockResolvedValue(true),
  releaseLock: jest.fn().mockResolvedValue(),
  isConnected: jest.fn().mockReturnValue(true)
}));

var axios;
var zohoApi;
var quota;

function okResponse(data, h) {
  return Promise.resolve({ data: data, headers: h || {} });
}

function code45() {
  var err = new Error('Request failed with status code 429');
  err.response = {
    status: 429,
    headers: { 'x-rate-limit-limit': '1000', 'x-rate-limit-remaining': '0', 'x-rate-limit-reset': '22210' },
    data: { code: 45, message: 'The API call for this organization has exceeded the maximum call rate limit of 1,000' }
  };
  return err;
}

beforeEach(() => {
  jest.resetModules();
  process.env.ZOHO_ORG_ID = 'org-123';
  axios = require('axios');
  zohoApi = require('../lib/zoho-api');
  quota = require('../lib/zoho-quota');
});

test('inventoryGet records x-rate-limit-* headers from a successful response', async () => {
  axios.get.mockImplementation(function () {
    return okResponse({ items: [] }, { 'x-rate-limit-limit': '1000', 'x-rate-limit-remaining': '612', 'x-rate-limit-reset': '3600' });
  });
  await zohoApi.inventoryGet('/items');
  expect(quota.snapshot().remaining).toBe(612);
  expect(quota.snapshot().limit).toBe(1000);
});

test('inventoryPost / inventoryPut record headers too', async () => {
  axios.post.mockImplementation(function () { return okResponse({}, { 'x-rate-limit-remaining': '500' }); });
  await zohoApi.inventoryPost('/purchaseorders', {});
  expect(quota.snapshot().remaining).toBe(500);
  axios.put.mockImplementation(function () { return okResponse({}, { 'x-rate-limit-remaining': '499' }); });
  await zohoApi.inventoryPut('/items/1', {});
  expect(quota.snapshot().remaining).toBe(499);
});

test('a response with no rate-limit headers is fine', async () => {
  axios.get.mockImplementation(function () { return Promise.resolve({ data: { ok: 1 } }); });
  await expect(zohoApi.inventoryGet('/items')).resolves.toEqual({ ok: 1 });
});

test('429 code 45: rejects once, is not retried, then blocks further Inventory calls', async () => {
  axios.get.mockImplementation(function () { return Promise.reject(code45()); });
  await expect(zohoApi.inventoryGet('/items')).rejects.toThrow();
  expect(axios.get).toHaveBeenCalledTimes(1); // never retried
  expect(quota.isExhausted()).toBe(true);

  axios.get.mockClear();
  var err = await zohoApi.inventoryGet('/items').catch(function (e) { return e; });
  expect(err.quotaExhausted).toBe(true);
  expect(err.response.status).toBe(429);
  expect(axios.get).not.toHaveBeenCalled();

  // fetchAllItems / fetchItemDetailsBulk go through inventoryGet as well
  await expect(zohoApi.fetchAllItems({ status: 'active' })).rejects.toMatchObject({ quotaExhausted: true });
  await expect(zohoApi.fetchItemDetailsBulk(['a'])).rejects.toMatchObject({ quotaExhausted: true });
  expect(axios.get).not.toHaveBeenCalled();
});

test('exhausted Inventory quota does not block Zoho Books calls', async () => {
  axios.get.mockImplementationOnce(function () { return Promise.reject(code45()); });
  await expect(zohoApi.inventoryGet('/items')).rejects.toThrow();
  axios.get.mockImplementationOnce(function () { return okResponse({ invoices: [] }); });
  await expect(zohoApi.zohoGet('/invoices')).resolves.toEqual({ invoices: [] });
});
