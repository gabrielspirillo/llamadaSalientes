import { ZadarmaApiError, ZadarmaRestClient } from '@/lib/zadarma/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

const USER_KEY = 'user_key_test';
const SECRET = 'secret_test';

function mockFetch(response: { status: number; json?: unknown; text?: string }) {
  return vi.fn(async () => {
    const body =
      response.json !== undefined ? JSON.stringify(response.json) : (response.text ?? '');
    return new Response(body, {
      status: response.status,
      headers: { 'content-type': 'application/json' },
    });
  });
}

describe('ZadarmaRestClient', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('ping() devuelve true cuando status=success', async () => {
    vi.stubGlobal('fetch', mockFetch({ status: 200, json: { status: 'success', balance: 10 } }));
    const c = new ZadarmaRestClient({ userKey: USER_KEY, secret: SECRET });
    expect(await c.ping()).toBe(true);
  });

  it('ping() devuelve false en 401 sin tirar', async () => {
    vi.stubGlobal('fetch', mockFetch({ status: 401, json: { status: 'error' } }));
    const c = new ZadarmaRestClient({ userKey: USER_KEY, secret: SECRET });
    expect(await c.ping()).toBe(false);
  });

  it('GET añade Authorization signed y manda params en query string', async () => {
    const fetchMock = mockFetch({
      status: 200,
      json: { status: 'success', balance: 5, currency: 'EUR' },
    });
    vi.stubGlobal('fetch', fetchMock);

    const c = new ZadarmaRestClient({ userKey: USER_KEY, secret: SECRET });
    const balance = await c.getBalance();
    expect(balance).toEqual({ balance: 5, currency: 'EUR' });

    const [url, init] = (fetchMock as unknown as {
      mock: { calls: [string, RequestInit][] };
    }).mock.calls[0]!;
    expect(url).toBe('https://api.zadarma.com/v1/info/balance/');
    expect(init.method).toBe('GET');
    const authHeader = (init.headers as Record<string, string>).Authorization;
    expect(authHeader).toMatch(new RegExp(`^${USER_KEY}:`));
  });

  it('listDirectNumbers parsea el array `info`', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch({
        status: 200,
        json: {
          status: 'success',
          info: [
            { number: '34911112222', type: 'direct', country: 'ES', status: 'active' },
          ],
        },
      }),
    );
    const c = new ZadarmaRestClient({ userKey: USER_KEY, secret: SECRET });
    const items = await c.listDirectNumbers();
    expect(items).toHaveLength(1);
    expect(items[0]!.number).toBe('34911112222');
  });

  it('listVerifiedCallerIds devuelve [] cuando endpoint 404', async () => {
    vi.stubGlobal('fetch', mockFetch({ status: 404 }));
    const c = new ZadarmaRestClient({ userKey: USER_KEY, secret: SECRET });
    expect(await c.listVerifiedCallerIds()).toEqual([]);
  });

  it('createCallback arma URL con from/to ordenados alfabéticamente', async () => {
    const fetchMock = mockFetch({
      status: 200,
      json: {
        status: 'success',
        pbx_call_id: 'pbx_123',
        from: '34911112222',
        to: '5491139530968',
      },
    });
    vi.stubGlobal('fetch', fetchMock);

    const c = new ZadarmaRestClient({ userKey: USER_KEY, secret: SECRET });
    const res = await c.createCallback({
      from: '34911112222',
      to: '5491139530968',
    });
    expect(res.pbx_call_id).toBe('pbx_123');

    const [url] = (fetchMock as unknown as {
      mock: { calls: [string, RequestInit][] };
    }).mock.calls[0]!;
    expect(url).toContain('/v1/request/callback/?from=34911112222&to=5491139530968');
  });

  it('setNotificationUrl manda POST form-urlencoded', async () => {
    const fetchMock = mockFetch({ status: 200, json: { status: 'success' } });
    vi.stubGlobal('fetch', fetchMock);

    const c = new ZadarmaRestClient({ userKey: USER_KEY, secret: SECRET });
    await c.setNotificationUrl('https://example.com/zd/webhook');

    const [url, init] = (fetchMock as unknown as {
      mock: { calls: [string, RequestInit][] };
    }).mock.calls[0]!;
    expect(url).toBe('https://api.zadarma.com/v1/webhook/notification/');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['content-type']).toBe(
      'application/x-www-form-urlencoded',
    );
    expect(String(init.body)).toContain('webhook_url=https%3A%2F%2Fexample.com%2Fzd%2Fwebhook');
  });

  it('errores Zadarma se traducen a ZadarmaApiError', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch({ status: 422, json: { status: 'error', message: 'Invalid number' } }),
    );
    const c = new ZadarmaRestClient({ userKey: USER_KEY, secret: SECRET });
    await expect(c.createCallback({ from: 'x', to: 'y' })).rejects.toBeInstanceOf(
      ZadarmaApiError,
    );
  });

  it('status=error con 200 también lanza ZadarmaApiError', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch({
        status: 200,
        json: { status: 'error', message: 'Insufficient balance' },
      }),
    );
    const c = new ZadarmaRestClient({ userKey: USER_KEY, secret: SECRET });
    await expect(c.createCallback({ from: 'a', to: 'b' })).rejects.toBeInstanceOf(
      ZadarmaApiError,
    );
  });
});
