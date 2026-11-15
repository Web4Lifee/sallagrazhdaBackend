import { withTransaction, type Db } from '../db/pool.js';
import type { Actor, Person, PersonInput, Ticket } from '../domain/types.js';
import { notFound } from '../lib/errors.js';
import { capitalize } from '../lib/text.js';
import { newId } from '../lib/tokens.js';
import { recordAudit } from '../repositories/audit.js';
import * as people from '../repositories/people.js';
import { ensureAnnualTickets } from './annual-tickets.js';

const clean = (input: PersonInput): PersonInput => ({
  firstName: capitalize(input.firstName),
  fatherName: capitalize(input.fatherName),
  lastName: capitalize(input.lastName),
});

export function createPeopleService(db: Db) {
  return {
    list: () => people.listPeople(db),

    async get(id: string): Promise<Person> {
      const person = await people.getPerson(db, id);
      if (!person) throw notFound('Person');
      return person;
    },

    /** Adds a person and creates their yearly ticket for the current season (like the app). */
    create(input: PersonInput, actor: Actor): Promise<{ person: Person; createdTickets: Ticket[] }> {
      return withTransaction(db, async (tx) => {
        const person = await people.insertPerson(tx, {
          id: newId(),
          ...clean(input),
          createdAt: new Date().toISOString(),
        });
        const createdTickets = await ensureAnnualTickets(tx);
        await recordAudit(tx, actor, 'person.create', 'person', person.id, {
          name: `${person.firstName} ${person.fatherName} ${person.lastName}`,
          createdTickets: createdTickets.length,
        });
        return { person, createdTickets };
      });
    },

    update(id: string, input: PersonInput, actor: Actor): Promise<Person> {
      return withTransaction(db, async (tx) => {
        const before = await people.getPerson(tx, id);
        if (!before) throw notFound('Person');
        const person = (await people.updatePerson(tx, id, clean(input)))!;
        await recordAudit(tx, actor, 'person.update', 'person', id, { before, after: person });
        return person;
      });
    },

    /** Deletes the person together with all their tickets (like the app). */
    remove(id: string, actor: Actor): Promise<void> {
      return withTransaction(db, async (tx) => {
        const person = await people.getPerson(tx, id);
        if (!person) throw notFound('Person');
        await people.deletePerson(tx, id);
        await recordAudit(tx, actor, 'person.delete', 'person', id, { person });
      });
    },
  };
}

export type PeopleService = ReturnType<typeof createPeopleService>;
