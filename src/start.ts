import type { FastifyInstance } from 'fastify';

import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { createPool } from './db/pool.js';
import { startScheduler } from './jobs/scheduler.js';
import { createServices } from './services/index.js';

export type RunningApi = {
  app: FastifyInstance;
  /** Stops the background jobs, lets running requests finish, then closes the database. */
  stop: () => Promise<void>;
};

/**
 * Starts the API from the environment: database pool, HTTP server on HOST:PORT and the
 * background jobs. Used by src/server.ts (Docker, `npm run dev`) and netlify/server/index.ts.
 */
export async function startApi(): Promise<RunningApi> {
  const config = loadConfig();
  const db = createPool(config.database);
  const services = createServices(db, config);
  const app = await buildApp({ config, db, services });

  // A failed database connection should never crash the process (pg emits these on idle clients).
  db.on('error', (error) => app.log.error({ err: error }, 'database pool error'));

  const stopScheduler = startScheduler(services, app.log, {
    autoStartSeasons: config.autoStartSeasons,
    intervalMinutes: config.seasonCheckIntervalMinutes,
  });

  await app.listen({ host: config.host, port: config.port });

  return {
    app,
    async stop() {
      stopScheduler();
      await app.close();
      await db.end();
    },
  };
}
