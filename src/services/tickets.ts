import { withTransaction, type Db } from '../db/pool.js';
import type { Ticket } from '../domain/types.js';
import { AppError, badRequest, conflict, notFound } from '../lib/errors.js';
import { activeSeasonYear } from '../lib/season-rules.js';
import { cleanReasons } from '../lib/text.js';
import { newId } from '../lib/tokens.js';
import { getPerson } from '../repositories/people.js';
import { listSeasons } from '../repositories/seasons.js';
import { getSettings, reserveTicketNumbers } from '../repositories/settings.js';
import * as tickets from '../repositories/tickets.js';

export type NewPaymentInput = {
  personId: string;
  amount: number;
  reasons: string[];
  note?: string;
  /** Pay this existing unpaid yearly ticket instead of creating a new one. */
  settleTicketId?: string;
  /** Record the payment as this person's yearly fee for the active season. */
  asAnnual?: boolean;
};

export function createTicketsService(db: Db) {
  return {
    list: (filter: tickets.TicketFilter) => tickets.listTickets(db, filter),

    async get(id: string): Promise<Ticket> {
      const ticket = await tickets.getTicket(db, id);
      if (!ticket) throw notFound('Ticket');
      return ticket;
    },

    /** Same behaviour as the app's createPayment, with stricter checks. */
    createPayment(input: NewPaymentInput): Promise<Ticket> {
      return withTransaction(db, async (tx) => {
        const { settings } = await getSettings(tx, { forUpdate: true });
        if (!(await getPerson(tx, input.personId))) throw notFound('Person');

        const now = new Date().toISOString();
        const reasons = cleanReasons(input.reasons);
        const note = input.note?.trim() || undefined;

        if (input.settleTicketId) {
          const existing = await tickets.getTicket(tx, input.settleTicketId, { forUpdate: true });
          if (!existing) throw notFound('Ticket');
          if (existing.personId !== input.personId) throw badRequest('The ticket belongs to another person');
          if (existing.status === 'paid') throw conflict('This ticket is already paid');

          return tickets.saveTicket(tx, {
            ...existing,
            amount: input.amount,
            reasons,
            note,
            status: 'paid',
            paidAt: now,
          });
        }

        const season = activeSeasonYear(await listSeasons(tx), settings);
        if (input.asAnnual) {
          const existing = await tickets.findAnnualTicket(tx, input.personId, season, { forUpdate: true });
          if (existing) {
            throw new AppError(
              409,
              'ANNUAL_TICKET_EXISTS',
              `This person already has a yearly ticket for season ${season}`,
              { ticketId: existing.id, status: existing.status },
            );
          }
        }

        const number = await reserveTicketNumbers(tx, 1);
        const [ticket] = await tickets.insertTickets(tx, [
          {
            id: newId(),
            number,
            personId: input.personId,
            kind: input.asAnnual ? 'annual' : 'payment',
            season,
            amount: input.amount,
            ...(input.asAnnual && { due: settings.annualFee }),
            reasons,
            status: 'paid',
            ...(note && { note }),
            createdAt: now,
            paidAt: now,
          },
        ]);
        return ticket!;
      });
    },

    /** Marks a ticket paid now, optionally with a different amount. */
    markPaid(id: string, amount: number | undefined): Promise<Ticket> {
      return withTransaction(db, async (tx) => {
        const ticket = await tickets.getTicket(tx, id, { forUpdate: true });
        if (!ticket) throw notFound('Ticket');
        return tickets.saveTicket(tx, {
          ...ticket,
          status: 'paid',
          paidAt: new Date().toISOString(),
          amount: amount ?? ticket.amount,
        });
      });
    },

    /** Marks a ticket unpaid again; the amount goes back to what was due. */
    markUnpaid(id: string): Promise<Ticket> {
      return withTransaction(db, async (tx) => {
        const ticket = await tickets.getTicket(tx, id, { forUpdate: true });
        if (!ticket) throw notFound('Ticket');
        const { paidAt: _paidAt, ...rest } = ticket;
        return tickets.saveTicket(tx, {
          ...rest,
          status: 'unpaid',
          amount: ticket.due ?? ticket.amount,
        });
      });
    },

    /** Deletes a ticket. A deleted yearly ticket is remembered so it is not generated again. */
    remove(id: string): Promise<void> {
      return withTransaction(db, async (tx) => {
        const ticket = await tickets.getTicket(tx, id, { forUpdate: true });
        if (!ticket) throw notFound('Ticket');
        await tickets.deleteTicket(tx, id);
        if (ticket.kind === 'annual') await tickets.addDismissal(tx, ticket.personId, ticket.season);
      });
    },
  };
}

export type TicketsService = ReturnType<typeof createTicketsService>;
