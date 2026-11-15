import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

/**
 * Password hashing with Node's built-in scrypt (no native add-ons to compile).
 * Parameters follow the OWASP recommendation N=2^16, r=8, p=2 (64 MiB, ~0.2–0.5 s per hash).
 * Stored format: scrypt$<log2 N>$<r>$<p>$<salt base64>$<hash base64>
 */
const PARAMS = { log2N: 16, r: 8, p: 2 } as const;
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;

export const PASSWORD_MIN_LENGTH = 12;
/** Upper bound so nobody can make the server hash megabytes of input. */
export const PASSWORD_MAX_LENGTH = 256;

function derive(password: string, salt: Buffer, log2N: number, r: number, p: number): Promise<Buffer> {
  const N = 2 ** log2N;
  return new Promise((resolve, reject) => {
    scrypt(password.normalize('NFKC'), salt, KEY_LENGTH, { N, r, p, maxmem: 256 * N * r }, (err, key) =>
      err ? reject(err) : resolve(key),
    );
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const key = await derive(password, salt, PARAMS.log2N, PARAMS.r, PARAMS.p);
  return ['scrypt', PARAMS.log2N, PARAMS.r, PARAMS.p, salt.toString('base64'), key.toString('base64')].join(
    '$',
  );
}

type Parsed = { log2N: number; r: number; p: number; salt: Buffer; key: Buffer };

function parse(stored: string): Parsed | null {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return null;
  const [log2N, r, p] = parts.slice(1, 4).map(Number) as [number, number, number];
  // Refuse absurd parameters so a corrupted row cannot exhaust memory.
  if (
    ![log2N, r, p].every(Number.isInteger) ||
    log2N < 10 ||
    log2N > 20 ||
    r < 1 ||
    r > 32 ||
    p < 1 ||
    p > 16
  ) {
    return null;
  }
  return { log2N, r, p, salt: Buffer.from(parts[4]!, 'base64'), key: Buffer.from(parts[5]!, 'base64') };
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parsed = parse(stored);
  if (!parsed || parsed.key.length !== KEY_LENGTH) return false;
  const key = await derive(password, parsed.salt, parsed.log2N, parsed.r, parsed.p);
  return timingSafeEqual(key, parsed.key);
}

/** True when the hash was made with older/weaker parameters and should be replaced at next login. */
export function needsRehash(stored: string): boolean {
  const parsed = parse(stored);
  return !parsed || parsed.log2N !== PARAMS.log2N || parsed.r !== PARAMS.r || parsed.p !== PARAMS.p;
}

/** A real hash of a random password, used to spend the same time when a username does not exist. */
let dummyHash: Promise<string> | undefined;
export function getDummyHash(): Promise<string> {
  dummyHash ??= hashPassword(randomBytes(32).toString('hex'));
  return dummyHash;
}

/** Returns a problem description, or null when the password is acceptable. */
export function checkPasswordStrength(password: string, username?: string): string | null {
  if (password.length < PASSWORD_MIN_LENGTH)
    return `Password must be at least ${PASSWORD_MIN_LENGTH} characters`;
  if (password.length > PASSWORD_MAX_LENGTH)
    return `Password must be at most ${PASSWORD_MAX_LENGTH} characters`;
  if (new Set(password).size < 5) return 'Password is too repetitive';
  if (username && password.toLowerCase().includes(username.toLowerCase())) {
    return 'Password must not contain the username';
  }
  return null;
}
