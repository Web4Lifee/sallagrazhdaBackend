import type { FastifyPluginAsync } from 'fastify';

import type { Db } from '../db/pool.js';

/** Public, unauthenticated checks for Docker, load balancers and uptime monitors. They reveal nothing else. */
export function healthRoutes(db: Db): FastifyPluginAsync {
  return async (app) => {
    // Liveness: the process is up and serving requests.
    app.get('/health', async () => ({ status: 'ok' }));

    // Readiness: the database is reachable too.
    app.get('/ready', async (request, reply) => {
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
