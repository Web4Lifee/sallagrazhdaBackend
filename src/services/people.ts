import { withTransaction, type Db } from '../db/pool.js';
import type { Person, PersonInput, Ticket } from '../domain/types.js';
import { notFound } from '../lib/errors.js';
import { capitalize } from '../lib/text.js';
import { newId } from '../lib/tokens.js';
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
    create(input: PersonInput): Promise<{ person: Person; createdTickets: Ticket[] }> {
      return withTransaction(db, async (tx) => {
        const person = await people.insertPerson(tx, {
          id: newId(),
          ...clean(input),
          createdAt: new Date().toISOString(),
        });
        const createdTickets = await ensureAnnualTickets(tx);
        return { person, createdTickets };
      });
    },

    async update(id: string, input: PersonInput): Promise<Person> {
      const person = await people.updatePerson(db, id, clean(input));
      if (!person) throw notFound('Person');
      return person;
    },

    /** Deletes the person together with all their tickets (like the app). */
    async remove(id: string): Promise<void> {
      if (!(await people.deletePerson(db, id))) throw notFound('Person');
    },
  };
}

export type PeopleService = ReturnType<typeof createPeopleService>;
