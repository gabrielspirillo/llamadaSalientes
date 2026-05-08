import 'server-only';
import Retell from 'retell-sdk';

let _client: Retell | null = null;

export function getRetellClient(): Retell {
  if (_client) return _client;
  const apiKey = process.env.RETELL_API_KEY;
  if (!apiKey) throw new Error('RETELL_API_KEY no está configurada');
  _client = new Retell({ apiKey });
  return _client;
}
