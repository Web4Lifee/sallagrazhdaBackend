import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import {
  EurosSchema,
  IdParamsSchema,
  IdSchema,
  NoteSchema,
  ReasonsSchema,
  parse,
} from '../lib/validation.js';
import type { TicketsService } from '../services/tickets.js';

const ListQuery = z.strictObject({
  personId: IdSchema.optional(),
  season: z.coerce.number().int().min(2000).max(2200).optional(),
  status: z.enum(['paid', 'unpaid']).optional(),
  kind: z.enum(['annual', 'payment']).optional(),
});

const PaymentBody = z
  .strictObject({
    personId: IdSchema,
    amount: EurosSchema.refine((v) => v > 0, 'Amount must be more than 0'),
    reasons: ReasonsSchema,
    note: NoteSchema.optional(),
    settleTicketId: IdSchema.optional(),
    asAnnual: z.boolean().optional(),
  })
  .refine((b) => !(b.settleTicketId && b.asAnnual), 'Use either settleTicketId or asAnnual, not both');

// Body is optional: POST /pay with no body keeps the ticket's amount.
const PayBody = z.strictObject({ amount: EurosSchema.optional() }).optional();

/** Protected routes: register inside a scope that has the auth hook. */
export function ticketRoutes(tickets: TicketsService): FastifyPluginAsync {
  return async (app) => {
    app.get('/v1/tickets', async (request) => tickets.list(parse(ListQuery, request.query)));

    app.get('/v1/tickets/:id', async (request) => tickets.get(parse(IdParamsSchema, request.params).id));

    app.post('/v1/payments', async (request, reply) => {
      const ticket = await tickets.createPayment(parse(PaymentBody, request.body));
      return reply.status(201).send(ticket);
    });

    app.post('/v1/tickets/:id/pay', async (request) => {
      const { id } = parse(IdParamsSchema, request.params);
      const body = parse(PayBody, request.body ?? undefined);
      return tickets.markPaid(id, body?.amount);
    });

    app.post('/v1/tickets/:id/unpay', async (request) =>
      tickets.markUnpaid(parse(IdParamsSchema, request.params).id),
    );

    app.delete('/v1/tickets/:id', async (request, reply) => {
      await tickets.remove(parse(IdParamsSchema, request.params).id);
      return reply.status(204).send();
    });
  };
}
