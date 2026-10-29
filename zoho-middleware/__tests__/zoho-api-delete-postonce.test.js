'use strict';

jest.mock('../lib/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn()
}));

jest.mock('../lib/zohoAuth', () => ({
  getAccessToken: jest.fn().mockResolvedValue('mock-token')
}));

jest.mock('axios', () => ({
  get: jest.fn(),
  post: jest.fn(),
  put: jest.fn(),
  delete: jest.fn()
}));

const { zohoDelete, zohoPostOnce, zohoPost, ZOHO_API_BASE } = require('../lib/zoho-api');
const axios = require('axios');

beforeEach(() => {
  jest.resetAllMocks();
  require('../lib/zohoAuth').getAccessToken.mockResolvedValue('mock-token');
  process.env.ZOHO_ORG_ID = 'org-123';
});

function err(status, code) {
  var e = new Error('boom');
  if (status) e.response = { status: status };
  if (code) e.code = code;
  return e;
}

describe('zohoDelete', () => {
  test('calls axios.delete with auth header, organization_id, timeout and resolves data', async () => {
    axios.delete.mockResolvedValue({ data: { code: 0 } });
    const out = await zohoDelete('/customerpayments/123');
    expect(out).toEqual({ code: 0 });
    expect(axios.delete).toHaveBeenCalledWith(ZOHO_API_BASE + '/customerpayments/123', {
      headers: { Authorization: 'Zoho-oauthtoken mock-token' },
      params: { organization_id: 'org-123' },
      timeout: 15000
    });
  });

  test('retries a 5xx like zohoPut', async () => {
    jest.useFakeTimers();
    axios.delete
      .mockRejectedValueOnce(err(503))
      .mockResolvedValueOnce({ data: { ok: true } });
    const p = zohoDelete('/customerpayments/9');
    await jest.advanceTimersByTimeAsync(1000);
    await expect(p).resolves.toEqual({ ok: true });
    expect(axios.delete).toHaveBeenCalledTimes(2);
    jest.useRealTimers();
  });
});

describe('zohoPostOnce', () => {
  test('posts once and resolves data', async () => {
    axios.post.mockResolvedValue({ data: { salesorder: { id: 1 } } });
    const out = await zohoPostOnce('/salesorders', { a: 1 });
    expect(out).toEqual({ salesorder: { id: 1 } });
    expect(axios.post).toHaveBeenCalledTimes(1);
    expect(axios.post.mock.calls[0][0]).toBe(ZOHO_API_BASE + '/salesorders');
    expect(axios.post.mock.calls[0][2].params).toEqual({ organization_id: 'org-123' });
  });

  test('does not retry a 503; error propagates', async () => {
    axios.post.mockRejectedValue(err(503));
    await expect(zohoPostOnce('/salesorders', {})).rejects.toThrow('boom');
    expect(axios.post).toHaveBeenCalledTimes(1);
  });

  test('does not retry a timeout (ECONNABORTED)', async () => {
    axios.post.mockRejectedValue(err(null, 'ECONNABORTED'));
    await expect(zohoPostOnce('/salesorders', {})).rejects.toThrow('boom');
    expect(axios.post).toHaveBeenCalledTimes(1);
  });

  test('zohoPost still retries a 503', async () => {
    jest.useFakeTimers();
    axios.post
      .mockRejectedValueOnce(err(503))
      .mockResolvedValueOnce({ data: { ok: 1 } });
    const p = zohoPost('/x', {});
    await jest.advanceTimersByTimeAsync(1000);
    await expect(p).resolves.toEqual({ ok: 1 });
    expect(axios.post).toHaveBeenCalledTimes(2);
    jest.useRealTimers();
  });
});
