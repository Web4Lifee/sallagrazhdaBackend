import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  ADMIN,
  api,
  createAdmin,
  createTestContext,
  login,
  resetData,
  resetUsers,
  type TestContext,
} from './helpers.js';

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestContext();
});
afterAll(async () => {
  await ctx.close();
});
beforeEach(async () => {
  await resetData(ctx.db);
  await resetUsers(ctx.db);
  await createAdmin(ctx);
});

describe('public endpoints', () => {
  it('reports health and readiness', async () => {
    expect((await ctx.app.inject({ method: 'GET', url: '/health' })).json()).toEqual({ status: 'ok' });
    expect((await ctx.app.inject({ method: 'GET', url: '/ready' })).json()).toEqual({ status: 'ok' });
  });

  it('sends security headers and forbids caching', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/health' });
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toContain("default-src 'none'");
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['x-request-id']).toBeTruthy();
  });

  it('returns a JSON 404 for unknown routes', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/nope' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: { code: 'NOT_FOUND', message: 'Route not found' } });
  });
});

describe('authentication', () => {
  it('rejects data requests without a valid token', async () => {
    for (const authorization of [
      undefined,
      'Bearer nope',
      'Basic YWRtaW46YWRtaW4=',
      `Bearer ${'a'.repeat(43)}`,
    ]) {
      const res = await ctx.app.inject({
        method: 'GET',
        url: '/v1/people',
        headers: authorization ? { authorization } : {},
      });
      expect(res.statusCode).toBe(401);
      expect(res.headers['www-authenticate']).toBe('Bearer');
    }
  });

  it('gives the same answer for a wrong password and an unknown user', async () => {
    const wrong = await ctx.app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { username: ADMIN.username, password: 'wrong password!!' },
    });
    const unknown = await ctx.app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { username: 'nobody', password: 'wrong password!!' },
    });
    expect(wrong.statusCode).toBe(401);
    expect(unknown.statusCode).toBe(401);
    expect(wrong.json()).toEqual(unknown.json());
  });

  it('logs in (username is case-insensitive) and returns the user', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { username: 'ADMIN', password: ADMIN.password },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ token: string; expiresAt: string; user: { username: string } }>();
    expect(body.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(new Date(body.expiresAt).getTime()).toBeGreaterThan(Date.now());
    expect(body.user).toEqual(expect.objectContaining({ username: 'admin' }));
    expect(JSON.stringify(body)).not.toContain('scrypt');

    const me = await api(ctx, body.token)('GET', '/v1/auth/me');
    expect(me.json()).toEqual({
      user: expect.objectContaining({ username: 'admin', displayName: 'Test Admin' }),
    });
  });

  it('stores only a hash of the session token', async () => {
    const token = await login(ctx);
    const { rows } = await ctx.db.query<{ token_hash: Buffer }>('SELECT token_hash FROM sessions');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.token_hash.toString('base64url')).not.toBe(token);
    expect(rows[0]!.token_hash).toHaveLength(32);
  });

  it('logout ends the session', async () => {
    const token = await login(ctx);
    expect((await api(ctx, token)('POST', '/v1/auth/logout')).statusCode).toBe(204);
    expect((await api(ctx, token)('GET', '/v1/people')).statusCode).toBe(401);
  });

  it('rejects expired sessions', async () => {
    const token = await login(ctx);
    await ctx.db.query("UPDATE sessions SET expires_at = now() - interval '1 second'");
    expect((await api(ctx, token)('GET', '/v1/people')).statusCode).toBe(401);
  });

  it('rejects disabled users', async () => {
    const token = await login(ctx);
    await ctx.db.query('UPDATE users SET is_active = false');
    expect((await api(ctx, token)('GET', '/v1/people')).statusCode).toBe(401);
  });

  it('changing the password signs out other devices but keeps this one', async () => {
    const phone = await login(ctx);
    const laptop = await login(ctx);
    const newPassword = 'another long passphrase';

    const weak = await api(ctx, phone)('POST', '/v1/auth/change-password', {
      currentPassword: ADMIN.password,
      newPassword: 'short',
    });
    expect(weak.statusCode).toBe(400);

    const wrong = await api(ctx, phone)('POST', '/v1/auth/change-password', {
      currentPassword: 'not my password',
      newPassword,
    });
    expect(wrong.statusCode).toBe(400);
    expect(wrong.json().error.code).toBe('INVALID_PASSWORD');

    const ok = await api(ctx, phone)('POST', '/v1/auth/change-password', {
      currentPassword: ADMIN.password,
      newPassword,
    });
    expect(ok.statusCode).toBe(204);
    expect((await api(ctx, phone)('GET', '/v1/people')).statusCode).toBe(200);
    expect((await api(ctx, laptop)('GET', '/v1/people')).statusCode).toBe(401);
    await expect(login(ctx)).rejects.toThrow();
    await expect(login(ctx, { username: 'admin', password: newPassword })).resolves.toBeTruthy();
  });
});

describe('abuse protection', () => {
  it('rate-limits login attempts per IP', async () => {
    const limited = await createTestContext({ LOGIN_RATE_LIMIT_MAX: '3' });
    try {
      const attempt = () =>
        limited.app.inject({
          method: 'POST',
          url: '/v1/auth/login',
          payload: { username: 'admin', password: 'wrong password!!' },
        });
      for (let i = 0; i < 3; i++) expect((await attempt()).statusCode).toBe(401);
      const blocked = await attempt();
      expect(blocked.statusCode).toBe(429);
      expect(blocked.json().error.code).toBe('RATE_LIMITED');
    } finally {
      await limited.close();
    }
  });

  it('rejects unknown fields and oversized bodies', async () => {
    const extra = await ctx.app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { ...ADMIN, isAdmin: true },
    });
    expect(extra.statusCode).toBe(400);

    const token = await login(ctx);
    const huge = await ctx.app.inject({
      method: 'POST',
      url: '/v1/people',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: JSON.stringify({ firstName: 'x'.repeat(2 * 1024 * 1024), fatherName: 'a', lastName: 'b' }),
    });
    expect(huge.statusCode).toBe(413);
  });

  it('rejects malicious ids before they reach the database', async () => {
    const token = await login(ctx);
    const res = await api(ctx, token)('GET', `/v1/people/${encodeURIComponent("1' OR '1'='1")}`);
    expect(res.statusCode).toBe(400);
  });
});
