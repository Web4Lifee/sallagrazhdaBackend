import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { createPool } from './db/pool.js';
import { startScheduler } from './jobs/scheduler.js';
import { createServices } from './services/index.js';

async function main() {
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

  // Graceful shutdown: stop taking requests, let running ones finish, then close the database.
  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    app.log.info({ signal }, 'shutting down');
    const force = setTimeout(() => {
      app.log.error('shutdown took too long; exiting');
      process.exit(1);
    }, 15_000);
    force.unref();
    try {
      stopScheduler();
      await app.close();
      await db.end();
      process.exit(0);
    } catch (error) {
      app.log.error({ err: error }, 'error during shutdown');
      process.exit(1);
    }
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('unhandledRejection', (reason) => app.log.error({ err: reason }, 'unhandled promise rejection'));

  await app.listen({ host: config.host, port: config.port });
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
