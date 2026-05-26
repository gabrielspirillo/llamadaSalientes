import {
  buildSortedParamsString,
  buildZadarmaSignature,
  verifyZadarmaWebhookSignature,
} from '@/lib/zadarma/signing';
import { createHash, createHmac } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { describe, expect, it } from 'vitest';

const USER_KEY = 'user_abc';
const SECRET = 'secret_xyz';

describe('buildSortedParamsString', () => {
  it('ordena las claves alfabéticamente', () => {
    const s = buildSortedParamsString({ b: '2', a: '1', c: '3' });
    expect(s).toBe('a=1&b=2&c=3');
  });

  it('omite null y undefined', () => {
    const s = buildSortedParamsString({ a: '1', b: null, c: undefined, d: '4' });
    expect(s).toBe('a=1&d=4');
  });

  it('serializa booleanos como "true"/"false"', () => {
    const s = buildSortedParamsString({ predicted: true, foo: false });
    expect(s).toBe('foo=false&predicted=true');
  });

  it('URL-encodea los valores', () => {
    const s = buildSortedParamsString({ from: '+1234', sip: 'foo bar' });
    // URLSearchParams encode "+" as %2B y espacio como "+"
    expect(s).toBe('from=%2B1234&sip=foo+bar');
  });

  it('devuelve string vacío para objeto vacío', () => {
    expect(buildSortedParamsString({})).toBe('');
  });
});

describe('buildZadarmaSignature', () => {
  it('compone Authorization con formato user_key:base64(hmac_hex)', () => {
    const { authorization, paramsString } = buildZadarmaSignature(
      '/v1/info/balance/',
      {},
      USER_KEY,
      SECRET,
    );
    // Calcular firma esperada manualmente con el mismo algoritmo de Zadarma.
    const md5 = createHash('md5').update('').digest('hex');
    const data = `/v1/info/balance/${''}${md5}`;
    const hmacHex = createHmac('sha1', SECRET).update(data).digest('hex');
    const expectedSig = Buffer.from(hmacHex, 'utf8').toString('base64');

    expect(paramsString).toBe('');
    expect(authorization).toBe(`${USER_KEY}:${expectedSig}`);
  });

  it('incluye los params en orden alfabético al firmar', () => {
    const { authorization, paramsString } = buildZadarmaSignature(
      '/v1/request/callback/',
      { to: '+1234', from: '+5678' },
      USER_KEY,
      SECRET,
    );
    expect(paramsString).toBe('from=%2B5678&to=%2B1234');

    const md5 = createHash('md5').update(paramsString).digest('hex');
    const data = `/v1/request/callback/${paramsString}${md5}`;
    const hmacHex = createHmac('sha1', SECRET).update(data).digest('hex');
    const expectedSig = Buffer.from(hmacHex, 'utf8').toString('base64');

    expect(authorization).toBe(`${USER_KEY}:${expectedSig}`);
  });

  it('cambia la firma si cambia el secret', () => {
    const a = buildZadarmaSignature('/v1/info/balance/', {}, USER_KEY, 'secret1');
    const b = buildZadarmaSignature('/v1/info/balance/', {}, USER_KEY, 'secret2');
    expect(a.authorization).not.toBe(b.authorization);
  });
});

describe('verifyZadarmaWebhookSignature', () => {
  it('valida una firma correcta', () => {
    // signature = base64( md5( fields + secret ) )  (Zadarma NOTIFY_START style)
    const fields = '2024-01-01 12:00:00+34611112222+34911234567';
    const secret = 'whsec_abc';
    const md5hex = createHash('md5').update(`${fields}${secret}`).digest('hex');
    const signature = Buffer.from(md5hex, 'utf8').toString('base64');

    expect(verifyZadarmaWebhookSignature(fields, secret, signature)).toBe(true);
  });

  it('rechaza una firma alterada', () => {
    const fields = 'a';
    const secret = 's';
    const md5hex = createHash('md5').update(`${fields}${secret}`).digest('hex');
    const tampered =
      Buffer.from(md5hex, 'utf8').toString('base64').slice(0, -1) + 'X';
    expect(verifyZadarmaWebhookSignature(fields, secret, tampered)).toBe(false);
  });

  it('rechaza con secret incorrecto', () => {
    const fields = 'x';
    const md5hex = createHash('md5').update(`${fields}good`).digest('hex');
    const sig = Buffer.from(md5hex, 'utf8').toString('base64');
    expect(verifyZadarmaWebhookSignature(fields, 'bad', sig)).toBe(false);
  });
});
