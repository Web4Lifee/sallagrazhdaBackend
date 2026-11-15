import type { Queryable } from '../db/pool.js';
import type { Person, PersonInput } from '../domain/types.js';

type PersonRow = {
  id: string;
  first_name: string;
  father_name: string;
  last_name: string;
  created_at: Date;
};

const COLUMNS = 'id, first_name, father_name, last_name, created_at';

const toPerson = (r: PersonRow): Person => ({
  id: r.id,
  firstName: r.first_name,
  fatherName: r.father_name,
  lastName: r.last_name,
  createdAt: r.created_at.toISOString(),
});

export async function listPeople(q: Queryable): Promise<Person[]> {
  const { rows } = await q.query<PersonRow>(`SELECT ${COLUMNS} FROM people ORDER BY created_at, id`);
  return rows.map(toPerson);
}

export async function getPerson(q: Queryable, id: string): Promise<Person | null> {
  const { rows } = await q.query<PersonRow>(`SELECT ${COLUMNS} FROM people WHERE id = $1`, [id]);
  return rows[0] ? toPerson(rows[0]) : null;
}

export async function insertPerson(q: Queryable, person: Person): Promise<Person> {
  const { rows } = await q.query<PersonRow>(
    `INSERT INTO people (id, first_name, father_name, last_name, created_at)
     VALUES ($1, $2, $3, $4, $5) RETURNING ${COLUMNS}`,
    [person.id, person.firstName, person.fatherName, person.lastName, person.createdAt],
  );
  return toPerson(rows[0]!);
}

/** Bulk insert used by the import (one statement, no parameter-count limit). */
export async function insertPeople(q: Queryable, people: Person[]): Promise<void> {
  if (!people.length) return;
  await q.query(
    `INSERT INTO people (id, first_name, father_name, last_name, created_at)
     SELECT * FROM unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::timestamptz[])`,
    [
      people.map((p) => p.id),
      people.map((p) => p.firstName),
      people.map((p) => p.fatherName),
      people.map((p) => p.lastName),
      people.map((p) => p.createdAt),
    ],
  );
}

export async function updatePerson(q: Queryable, id: string, input: PersonInput): Promise<Person | null> {
  const { rows } = await q.query<PersonRow>(
    `UPDATE people SET first_name = $2, father_name = $3, last_name = $4, updated_at = now()
      WHERE id = $1 RETURNING ${COLUMNS}`,
    [id, input.firstName, input.fatherName, input.lastName],
  );
  return rows[0] ? toPerson(rows[0]) : null;
}

/** Deletes the person; their tickets and dismissals go with them (ON DELETE CASCADE). */
export async function deletePerson(q: Queryable, id: string): Promise<boolean> {
  const { rowCount } = await q.query('DELETE FROM people WHERE id = $1', [id]);
  return (rowCount ?? 0) > 0;
}

export async function countPeople(q: Queryable): Promise<number> {
  const { rows } = await q.query<{ count: number }>('SELECT count(*) AS count FROM people');
  return rows[0]!.count;
}
