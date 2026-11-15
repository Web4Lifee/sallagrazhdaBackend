import type { FastifyPluginAsync } from 'fastify';

import type { Db } from '../db/pool.js';

/**
 * Public, unauthenticated checks for Docker, load balancers and uptime monitors. They reveal nothing else.
 * Docker calls /health every 30 seconds, so successful checks are not logged (only warnings and errors);
 * otherwise they would bury the real requests and fill the rotated log files.
 */
const QUIET = { logLevel: 'warn' } as const;

export function healthRoutes(db: Db): FastifyPluginAsync {
  return async (app) => {
    // Liveness: the process is up and serving requests.
    app.get('/health', QUIET, async () => ({ status: 'ok' }));

    // Readiness: the database is reachable too. A failure is still logged as an error.
    app.get('/ready', QUIET, async (request, reply) => {
      try {
        await db.query('SELECT 1');
        return { status: 'ok' };
      } catch (error) {
        request.log.error({ err: error }, 'readiness check failed');
        return reply.status(503).send({ status: 'unavailable' });
      }
    });
  };
}
