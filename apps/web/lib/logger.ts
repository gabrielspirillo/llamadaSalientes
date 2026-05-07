import { env } from '@/lib/env';

// Logger estructurado. Si AXIOM_TOKEN/AXIOM_DATASET están seteados, envía a Axiom.
// Si no, fallback a console.log con JSON. Nunca crashea por falta de credenciales.

type Level = 'debug' | 'info' | 'warn' | 'error';
type Fields = Record<string, unknown>;

async function send(level: Level, msg: string, fields: Fields) {
  const entry = {
    _time: new Date().toISOString(),
    level,
    msg,
    ...fields,
  };

  if (!env.AXIOM_TOKEN || !env.AXIOM_DATASET) {
    // dev/local fallback
    const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
    fn(JSON.stringify(entry));
    return;
  }

  try {
    await fetch(`https://api.axiom.co/v1/datasets/${env.AXIOM_DATASET}/ingest`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.AXIOM_TOKEN}`,
      },
      body: JSON.stringify([entry]),
    });
  } catch (err) {
    console.error('axiom_ingest_failed', err);
    console.log(JSON.stringify(entry));
  }
}

export const logger = {
  debug: (msg: string, fields: Fields = {}) => send('debug', msg, fields),
  info: (msg: string, fields: Fields = {}) => send('info', msg, fields),
  warn: (msg: string, fields: Fields = {}) => send('warn', msg, fields),
  error: (msg: string, fields: Fields = {}) => send('error', msg, fields),
};
