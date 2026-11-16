import { startApi } from './start.js';

async function main() {
  const api = await startApi();
  const log = api.app.log;

  process.on('unhandledRejection', (reason) => log.error({ err: reason }, 'unhandled promise rejection'));

  // Graceful shutdown: stop taking requests, let running ones finish, then close the database.
  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info({ signal }, 'shutting down');
    const force = setTimeout(() => {
      log.error('shutdown took too long; exiting');
      process.exit(1);
    }, 15_000);
    force.unref();
    try {
      await api.stop();
      process.exit(0);
    } catch (error) {
      log.error({ err: error }, 'error during shutdown');
      process.exit(1);
    }
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
