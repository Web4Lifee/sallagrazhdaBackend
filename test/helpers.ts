import type { FastifyInstance, LightMyRequestResponse } from 'fastify';

import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { createPool, type Db } from '../src/db/pool.js';
import { createServices, type Services } from '../src/services/index.js';

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://sallagrazhda:localdev@localhost:5432/sallagrazhda_test';

/** Tests wipe tables, so never let them run against anything but a *_test database. */
export function assertTestDatabase(url: string): void {
  const name = new URL(url).pathname.slice(1);
  if (!name.endsWith('_test')) {
    throw new Error(`Refusing to run tests against database "${name}": its name must end with _test.`);
  }
}

export type TestContext = {
  app: FastifyInstance;
  db: Db;
  services: Services;
  close: () => Promise<void>;
};

export async function createTestContext(env: Record<string, string> = {}): Promise<TestContext> {
  assertTestDatabase(TEST_DATABASE_URL);
  const config = loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: TEST_DATABASE_URL,
    LOG_LEVEL: 'silent',
    AUTO_START_SEASONS: 'false',
    LOGIN_RATE_LIMIT_MAX: '100',
    ...env,
  });
  const db = createPool(config.database);
  const services = createServices(db, config);
  const app = await buildApp({ config, db, services });
  return {
    app,
    db,
    services,
    close: async () => {
      await app.close();
      await db.end();
    },
  };
}

/** Empties all app data and puts the settings back to the app's defaults. Keeps users and sessions. */
export async function resetData(db: Db): Promise<void> {
  await db.query('TRUNCATE people, tickets, seasons, annual_dismissals RESTART IDENTITY CASCADE');
  await db.query(
    `UPDATE settings SET admin_name = 'Administratori', organization = 'Mirëmbajtja e Oborrit',
       goal_cents = 250000, annual_fee_cents = 3500, season_start_month = 9, season_start_year = 2027,
       reasons = ARRAY['Mirëmbajtja e oborrit', 'Kositja e barit', 'Pastrimi'], paper_width = 58,
       next_ticket_number = 1 WHERE id = 1`,
  );
}

export async function resetUsers(db: Db): Promise<void> {
  await db.query('TRUNCATE users, sessions CASCADE');
}

export const ADMIN = { username: 'admin', password: 'correct horse battery staple' };

export async function createAdmin(ctx: TestContext, user = ADMIN): Promise<void> {
  await ctx.services.auth.createUser({ ...user, displayName: 'Test Admin' });
}

export async function login(ctx: TestContext, user = ADMIN): Promise<string> {
  const res = await ctx.app.inject({ method: 'POST', url: '/v1/auth/login', payload: user });
  if (res.statusCode !== 200) throw new Error(`login failed: ${res.statusCode} ${res.body}`);
  return res.json<{ token: string }>().token;
}

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/** Small helper for authenticated requests: `const res = await api(ctx, token)('POST', '/v1/people', body)`. */
export function api(ctx: TestContext, token: string) {
  return (method: Method, url: string, payload?: unknown): Promise<LightMyRequestResponse> =>
    ctx.app.inject({
      method,
      url,
      headers: { authorization: `Bearer ${token}` },
      ...(payload !== undefined && { payload: payload as Record<string, unknown> }),
    });
}
