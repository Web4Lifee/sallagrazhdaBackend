import type { FastifyPluginAsync } from 'fastify';

import { actorOf } from '../http/context.js';
import type { SeasonsService } from '../services/seasons.js';

/** Protected routes: register inside a scope that has the auth hook. */
export function seasonRoutes(seasons: SeasonsService): FastifyPluginAsync {
  return async (app) => {
    app.get('/v1/seasons', async () => seasons.list());

    // The "start next season" button. Creates the unpaid yearly tickets.
    app.post('/v1/seasons/start', async (request, reply) => {
      const result = await seasons.startNext(actorOf(request));
      return reply.status(201).send(result);
    });
  };
}
