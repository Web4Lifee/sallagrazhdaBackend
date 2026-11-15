import { createHash, randomBytes, randomUUID } from 'node:crypto';

/** 256-bit random session token, sent to the client once and never stored in plain text. */
export function newSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

export const SESSION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function hashToken(token: string): Buffer {
  return createHash('sha256').update(token).digest();
}

/** IDs for new people and tickets. Imported records keep the IDs the app gave them. */
export function newId(): string {
  return randomUUID();
}
