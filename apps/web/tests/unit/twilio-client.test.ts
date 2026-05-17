import { TwilioApiError, TwilioRestClient } from '@/lib/twilio/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

const SID = 'ACaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const TOKEN = 'token-test-1234567890';

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

describe('TwilioRestClient', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('ping() devuelve true en 200', async () => {
    vi.stubGlobal('fetch', mockFetch({ status: 200, json: { sid: SID } }));
    const c = new TwilioRestClient({ accountSid: SID, authToken: TOKEN });
    expect(await c.ping()).toBe(true);
  });

  it('ping() devuelve false en 401 sin tirar', async () => {
    vi.stubGlobal('fetch', mockFetch({ status: 401, json: { code: 20003 } }));
    const c = new TwilioRestClient({ accountSid: SID, authToken: TOKEN });
    expect(await c.ping()).toBe(false);
  });

  it('createVerifiedCallerId arma body con PhoneNumber + FriendlyName', async () => {
    const fetchMock = mockFetch({
      status: 201,
      json: {
        validation_code: '654321',
        call_sid: 'CAxxxx',
        account_sid: SID,
        phone_number: '+5491139530968',
        friendly_name: 'Clínica X',
      },
    });
    vi.stubGlobal('fetch', fetchMock);

    const c = new TwilioRestClient({ accountSid: SID, authToken: TOKEN });
    const res = await c.createVerifiedCallerId({
      phoneNumber: '+5491139530968',
      friendlyName: 'Clínica X',
    });
    expect(res.validation_code).toBe('654321');

    const [url, init] = (fetchMock as unknown as { mock: { calls: [string, RequestInit][] } })
      .mock.calls[0]!;
    expect(url).toContain('/OutgoingCallerIds.json');
    expect(init.method).toBe('POST');
    expect(String(init.body)).toContain('PhoneNumber=%2B5491139530968');
    expect(String(init.body)).toContain('FriendlyName=Cl%C3%ADnica+X');
  });

  it('listVerifiedCallerIds parsea el array outgoing_caller_ids', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch({
        status: 200,
        json: {
          outgoing_caller_ids: [
            {
              sid: 'PN111',
              phone_number: '+5491139530968',
              friendly_name: 'foo',
              account_sid: SID,
              date_created: '',
              date_updated: '',
            },
          ],
        },
      }),
    );

    const c = new TwilioRestClient({ accountSid: SID, authToken: TOKEN });
    const items = await c.listVerifiedCallerIds({ phoneNumber: '+5491139530968' });
    expect(items).toHaveLength(1);
    expect(items[0]!.sid).toBe('PN111');
  });

  it('updateIncomingPhoneNumber serializa solo campos provistos', async () => {
    const fetchMock = mockFetch({
      status: 200,
      json: {
        sid: 'PN222',
        phone_number: '+5491100001111',
        friendly_name: 'Tenant clínica',
        voice_url: 'https://x/voice',
        voice_method: 'POST',
        sms_url: 'https://x/sms',
        sms_method: 'POST',
        account_sid: SID,
        capabilities: { voice: true, sms: true, mms: false },
      },
    });
    vi.stubGlobal('fetch', fetchMock);
    const c = new TwilioRestClient({ accountSid: SID, authToken: TOKEN });
    const res = await c.updateIncomingPhoneNumber('PN222', {
      voiceUrl: 'https://x/voice',
      voiceMethod: 'POST',
    });
    expect(res.voice_url).toBe('https://x/voice');
    const [, init] = (fetchMock as unknown as { mock: { calls: [string, RequestInit][] } })
      .mock.calls[0]!;
    const body = String(init.body);
    expect(body).toContain('VoiceUrl=https%3A%2F%2Fx%2Fvoice');
    expect(body).toContain('VoiceMethod=POST');
    expect(body).not.toContain('SmsUrl=');
  });

  it('errores de Twilio se traducen a TwilioApiError', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch({ status: 422, json: { code: 21210, message: 'Caller ID Not Verified' } }),
    );
    const c = new TwilioRestClient({ accountSid: SID, authToken: TOKEN });
    await expect(
      c.createVerifiedCallerId({ phoneNumber: '+0' }),
    ).rejects.toBeInstanceOf(TwilioApiError);
  });
});
