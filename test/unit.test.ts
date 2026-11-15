import { describe, expect, it } from 'vitest';

import { loadConfig } from '../src/config.js';
import { checkPasswordStrength, hashPassword, needsRehash, verifyPassword } from '../src/lib/password.js';
import { hasAtMostTwoDecimals, toCents } from '../src/lib/money.js';
import {
  activeSeasonYear,
  nextSeasonDate,
  nextSeasonYear,
  planAnnualTickets,
  seasonStart,
} from '../src/lib/season-rules.js';
import { capitalize, cleanReasons } from '../src/lib/text.js';

const settings = { seasonStartMonth: 9, seasonStartYear: 2027 };

describe('season rules (same as the app)', () => {
  it('starts with the configured first season', () => {
    expect(nextSeasonYear([], settings)).toBe(2027);
    expect(activeSeasonYear([], settings)).toBe(2027);
    expect(nextSeasonDate([], settings)).toEqual(new Date(2027, 9, 1));
  });

  it('follows the latest started season', () => {
    const seasons = [
      { year: 2027, month: 9, startedAt: seasonStart(2027, 9).toISOString() },
      { year: 2028, month: 9, startedAt: seasonStart(2028, 9).toISOString() },
    ];
    expect(nextSeasonYear(seasons, settings)).toBe(2029);
    expect(activeSeasonYear(seasons, settings)).toBe(2028);
  });

  it('plans one yearly ticket per person per season they belong to', () => {
    const seasons = [
      { year: 2027, month: 9, startedAt: '2027-09-30T22:00:00.000Z' },
      { year: 2028, month: 9, startedAt: '2028-09-30T22:00:00.000Z' },
    ];
    const people = [
      { id: 'old', createdAt: '2027-01-01T00:00:00.000Z' },
      // Registered after season 2027 ended: owes only for 2028.
      { id: 'new', createdAt: '2028-11-01T00:00:00.000Z' },
    ];
    const now = new Date('2028-12-01T00:00:00.000Z');
    const plan = planAnnualTickets(seasons, people, new Set(['old:2028']), now);

    expect(plan).toEqual([
      { personId: 'old', season: 2027, createdAt: '2027-09-30T22:00:00.000Z' },
      { personId: 'new', season: 2028, createdAt: now.toISOString() },
    ]);
  });
});

describe('passwords', () => {
  it('hashes and verifies with scrypt', async () => {
    const hash = await hashPassword('a long enough password');
    expect(hash).toMatch(/^scrypt\$16\$8\$2\$/);
    expect(await verifyPassword('a long enough password', hash)).toBe(true);
    expect(await verifyPassword('a long enough passworD', hash)).toBe(false);
    expect(needsRehash(hash)).toBe(false);
  });

  it('salts every hash differently', async () => {
    expect(await hashPassword('same password here')).not.toBe(await hashPassword('same password here'));
  });

  it('rejects malformed or tampered hashes instead of crashing', async () => {
    expect(await verifyPassword('x', 'not-a-hash')).toBe(false);
    expect(await verifyPassword('x', 'scrypt$30$8$1$AAAA$AAAA')).toBe(false);
    expect(needsRehash('scrypt$14$8$1$AAAA$AAAA')).toBe(true);
  });

  it('enforces a minimum strength', () => {
    expect(checkPasswordStrength('short')).toMatch(/at least 12/);
    expect(checkPasswordStrength('aaaaaaaaaaaaaaaa')).toMatch(/repetitive/);
    expect(checkPasswordStrength('admin-is-my-password', 'admin')).toMatch(/username/);
    expect(checkPasswordStrength('correct horse battery staple', 'admin')).toBeNull();
  });
});

describe('helpers', () => {
  it('capitalizes names like the app', () => {
    expect(capitalize('  arben   hoxha ')).toBe('Arben Hoxha');
  });

  it('cleans reasons', () => {
    expect(cleanReasons([' Pastrimi ', 'pastrimi', '', 'Kositja  e barit'])).toEqual([
      'Pastrimi',
      'Kositja e barit',
    ]);
  });

  it('converts euros to cents without float errors', () => {
    expect(toCents(19.99)).toBe(1999);
    expect(toCents(0.1 + 0.2)).toBe(30);
    expect(hasAtMostTwoDecimals(12.5)).toBe(true);
    expect(hasAtMostTwoDecimals(12.555)).toBe(false);
  });
});

describe('config', () => {
  const base = { DATABASE_URL: 'postgres://u:strongpassword@db:5432/app' };

  it('has safe defaults', () => {
    const config = loadConfig(base);
    expect(config.trustProxy).toBe(false);
    expect(config.corsOrigins).toEqual([]);
    expect(config.isProduction).toBe(false);
  });

  it('refuses placeholder passwords in production', () => {
    expect(() =>
      loadConfig({ NODE_ENV: 'production', DATABASE_URL: 'postgres://u:CHANGE_ME@db:5432/app' }),
    ).toThrow(/placeholder/);
    expect(() =>
      loadConfig({ NODE_ENV: 'production', DATABASE_URL: 'postgres://u:localdev@db:5432/app' }),
    ).toThrow(/placeholder/);
  });

  it('refuses spoofable proxy settings', () => {
    expect(() => loadConfig({ ...base, TRUST_PROXY: 'true' })).toThrow(/TRUST_PROXY/);
    expect(() => loadConfig({ ...base, TRUST_PROXY: '1' })).toThrow(/TRUST_PROXY/);
    expect(loadConfig({ ...base, TRUST_PROXY: 'uniquelocal' }).trustProxy).toEqual(['uniquelocal']);
  });

  it('requires https CORS origins in production', () => {
    expect(() => loadConfig({ ...base, NODE_ENV: 'production', CORS_ORIGINS: 'http://example.com' })).toThrow(
      /https/,
    );
  });
});
