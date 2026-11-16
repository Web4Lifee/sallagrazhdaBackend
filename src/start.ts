import type { FastifyInstance } from 'fastify';

import { buildApp } from './app.js';
import { loadConfig, type Config } from './config.js';
import { createPool, type Db } from './db/pool.js';
import { startScheduler } from './jobs/scheduler.js';
import { createServices, type Services } from './services/index.js';

export type Api = {
  config: Config;
  db: Db;
  services: Services;
  app: FastifyInstance;
  /** Lets running requests finish, then closes the database. */
  stop: () => Promise<void>;
};

/** Builds the API from the environment without listening: Netlify Functions hand it requests directly. */
export async function createApi(): Promise<Api> {
  const config = loadConfig();
  const db = createPool(config.database);
  const services = createServices(db, config);
  const app = await buildApp({ config, db, services });

  // A failed database connection should never crash the process (pg emits these on idle clients).
  db.on('error', (error) => app.log.error({ err: error }, 'database pool error'));

  return {
    config,
    db,
    services,
    app,
    async stop() {
      await app.close();
      await db.end();
    },
  };
}

/** Builds the API, listens on HOST:PORT and runs the background jobs (Docker, `npm run dev`). */
export async function startApi(): Promise<Api> {
  const api = await createApi();
  const stopScheduler = startScheduler(api.services, api.app.log, {
    autoStartSeasons: api.config.autoStartSeasons,
    intervalMinutes: api.config.seasonCheckIntervalMinutes,
  });
  await api.app.listen({ host: api.config.host, port: api.config.port });
  return {
    ...api,
    async stop() {
      stopScheduler();
      await api.stop();
    },
  };
}
