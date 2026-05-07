import 'server-only';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
// Lee ENCRYPTION_KEY directo de process.env para no acoplar al validation
// de lib/env.ts (que se evalúa eagerly y puede romper imports en tests).

// AES-256-GCM. La clave debe ser exactamente 32 bytes (decodificada de base64).
// Formato del payload cifrado: base64(iv ‖ authTag ‖ ciphertext).
//   iv:        12 bytes (estándar GCM)
//   authTag:   16 bytes
//   ciphertext: variable
// Cualquier sub-componente cambia → la decryption tira "Unsupported state" o
// "Invalid auth tag", lo que detecta cualquier tampering.

const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;

function getKey(): Buffer {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) {
    throw new Error('ENCRYPTION_KEY no está configurada');
  }
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) {
    throw new Error(
      `ENCRYPTION_KEY decodificada debe ser 32 bytes (es ${key.length}). Generala con: openssl rand -base64 32`,
    );
  }
  return key;
}

export function encrypt(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, encrypted]).toString('base64');
}

export function decrypt(payload: string): string {
  const key = getKey();
  const buf = Buffer.from(payload, 'base64');
  if (buf.length < IV_BYTES + AUTH_TAG_BYTES + 1) {
    throw new Error('Payload cifrado demasiado corto');
  }
  const iv = buf.subarray(0, IV_BYTES);
  const authTag = buf.subarray(IV_BYTES, IV_BYTES + AUTH_TAG_BYTES);
  const ciphertext = buf.subarray(IV_BYTES + AUTH_TAG_BYTES);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return decrypted.toString('utf8');
}
