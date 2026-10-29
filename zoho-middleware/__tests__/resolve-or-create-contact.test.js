'use strict';

jest.mock('../lib/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn()
}));
jest.mock('../lib/zoho-api', () => ({
  zohoGet: jest.fn(),
  zohoPost: jest.fn()
}));
jest.mock('../lib/cache', () => ({
  get: jest.fn(),
  set: jest.fn()
}));

const zohoApi = require('../lib/zoho-api');
const cache = require('../lib/cache');
const C = require('../lib/constants');
const helpers = require('../lib/checkout-helpers');

const ARGS = { name: 'Jane Doe', email: 'Jane@Example.com', phone: '604-555-0100' };
const KEY = C.CACHE_KEYS.CONTACT_PREFIX + 'jane@example.com';

beforeEach(() => {
  jest.resetAllMocks();
  cache.get.mockResolvedValue(null);
  cache.set.mockResolvedValue();
});

describe('resolveOrCreateContact', () => {
  test('cache hit returns cached id without calling Zoho', async () => {
    cache.get.mockResolvedValue('c-cached');
    const out = await helpers.resolveOrCreateContact(ARGS);
    expect(out).toEqual({ contactId: 'c-cached', freshlyCreated: false });
    expect(cache.get).toHaveBeenCalledWith(KEY);
    expect(zohoApi.zohoGet).not.toHaveBeenCalled();
  });

  test('found by email is cached and not created', async () => {
    zohoApi.zohoGet.mockResolvedValue({ contacts: [{ contact_id: 'c-1' }] });
    const out = await helpers.resolveOrCreateContact(ARGS);
    expect(out).toEqual({ contactId: 'c-1', freshlyCreated: false });
    expect(zohoApi.zohoGet).toHaveBeenCalledWith('/contacts', { email: 'Jane@Example.com' });
    expect(cache.set).toHaveBeenCalledWith(KEY, 'c-1', 600);
    expect(zohoApi.zohoPost).not.toHaveBeenCalled();
  });

  test('created uses buildContactPayload and reports freshlyCreated', async () => {
    zohoApi.zohoGet.mockResolvedValue({ contacts: [] });
    zohoApi.zohoPost.mockResolvedValue({ contact: { contact_id: 'c-new' } });
    const out = await helpers.resolveOrCreateContact(ARGS);
    expect(out).toEqual({ contactId: 'c-new', freshlyCreated: true });
    expect(zohoApi.zohoPost).toHaveBeenCalledWith(
      '/contacts',
      helpers.buildContactPayload(ARGS.name, ARGS.email, ARGS.phone)
    );
    expect(cache.set).toHaveBeenCalledWith(KEY, 'c-new', 600);
  });

  test('400 on create falls back to name search', async () => {
    const e = new Error('dup');
    e.response = { status: 400 };
    zohoApi.zohoGet
      .mockResolvedValueOnce({ contacts: [] })
      .mockResolvedValueOnce({ contacts: [{ contact_id: 'c-byname' }] });
    zohoApi.zohoPost.mockRejectedValue(e);
    const out = await helpers.resolveOrCreateContact(ARGS);
    expect(out).toEqual({ contactId: 'c-byname', freshlyCreated: false });
    expect(zohoApi.zohoGet).toHaveBeenLastCalledWith('/contacts', { contact_name: 'Jane Doe' });
  });

  test('400 with empty name search rethrows the original error', async () => {
    const e = new Error('dup');
    e.response = { status: 400 };
    zohoApi.zohoGet.mockResolvedValue({ contacts: [] });
    zohoApi.zohoPost.mockRejectedValue(e);
    await expect(helpers.resolveOrCreateContact(ARGS)).rejects.toBe(e);
  });

  test('non-400 create error rethrows', async () => {
    const e = new Error('server');
    e.response = { status: 500 };
    zohoApi.zohoGet.mockResolvedValue({ contacts: [] });
    zohoApi.zohoPost.mockRejectedValue(e);
    await expect(helpers.resolveOrCreateContact(ARGS)).rejects.toBe(e);
    expect(zohoApi.zohoGet).toHaveBeenCalledTimes(1);
  });
});
