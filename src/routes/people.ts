import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { IdParamsSchema, NameSchema, parse } from '../lib/validation.js';
import type { PeopleService } from '../services/people.js';

const PersonBody = z.strictObject({
  firstName: NameSchema,
  fatherName: NameSchema,
  lastName: NameSchema,
});

/** Protected routes: register inside a scope that has the auth hook. */
export function peopleRoutes(people: PeopleService): FastifyPluginAsync {
  return async (app) => {
    app.get('/v1/people', async () => people.list());

    app.get('/v1/people/:id', async (request) => people.get(parse(IdParamsSchema, request.params).id));

    // Returns the person plus any yearly tickets created for them.
    app.post('/v1/people', async (request, reply) => {
      const result = await people.create(parse(PersonBody, request.body));
      return reply.status(201).send(result);
    });

    app.put('/v1/people/:id', async (request) =>
      people.update(parse(IdParamsSchema, request.params).id, parse(PersonBody, request.body)),
    );

    app.delete('/v1/people/:id', async (request, reply) => {
      await people.remove(parse(IdParamsSchema, request.params).id);
      return reply.status(204).send();
    });
  };
}
