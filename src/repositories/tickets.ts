import type { Queryable } from '../db/pool.js';
import type { Ticket, TicketKind, TicketStatus } from '../domain/types.js';
import { fromCents, toCents } from '../lib/money.js';

type TicketRow = {
  id: string;
  number: number;
  person_id: string;
  kind: TicketKind;
  season: number;
  amount_cents: number;
  due_cents: number | null;
  reasons: string[];
  status: TicketStatus;
  note: string | null;
  created_at: Date;
  paid_at: Date | null;
};

const COLUMNS =
  'id, number, person_id, kind, season, amount_cents, due_cents, reasons, status, note, created_at, paid_at';

/** Optional fields are left out (not null), exactly like the app's Ticket type. */
const toTicket = (r: TicketRow): Ticket => ({
  id: r.id,
  number: r.number,
  personId: r.person_id,
  kind: r.kind,
  season: r.season,
  amount: fromCents(r.amount_cents),
  ...(r.due_cents !== null && { due: fromCents(r.due_cents) }),
  reasons: r.reasons,
  status: r.status,
  ...(r.note !== null && { note: r.note }),
  createdAt: r.created_at.toISOString(),
  ...(r.paid_at !== null && { paidAt: r.paid_at.toISOString() }),
});

export type TicketFilter = {
  personId?: string;
  season?: number;
  status?: TicketStatus;
  kind?: TicketKind;
};

export async function listTickets(q: Queryable, filter: TicketFilter = {}): Promise<Ticket[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  const add = (column: string, value: unknown) => {
    params.push(value);
    where.push(`${column} = $${params.length}`);
  };
  if (filter.personId !== undefined) add('person_id', filter.personId);
  if (filter.season !== undefined) add('season', filter.season);
  if (filter.status !== undefined) add('status', filter.status);
  if (filter.kind !== undefined) add('kind', filter.kind);

  const { rows } = await q.query<TicketRow>(
    `SELECT ${COLUMNS} FROM tickets ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY number`,
    params,
  );
  return rows.map(toTicket);
}

export async function getTicket(
  q: Queryable,
  id: string,
  { forUpdate = false } = {},
): Promise<Ticket | null> {
  const { rows } = await q.query<TicketRow>(
    `SELECT ${COLUMNS} FROM tickets WHERE id = $1 ${forUpdate ? 'FOR UPDATE' : ''}`,
    [id],
  );
  return rows[0] ? toTicket(rows[0]) : null;
}

export async function findAnnualTicket(
  q: Queryable,
  personId: string,
  season: number,
  { forUpdate = false } = {},
): Promise<Ticket | null> {
  const { rows } = await q.query<TicketRow>(
    `SELECT ${COLUMNS} FROM tickets WHERE person_id = $1 AND season = $2 AND kind = 'annual'
     ${forUpdate ? 'FOR UPDATE' : ''}`,
    [personId, season],
  );
  return rows[0] ? toTicket(rows[0]) : null;
}

/** Inserts tickets (in batches, to stay under PostgreSQL's parameter limit) and returns them by receipt number. */
export async function insertTickets(q: Queryable, tickets: Ticket[]): Promise<Ticket[]> {
  const BATCH = 1000;
  const inserted: Ticket[] = [];
  for (let i = 0; i < tickets.length; i += BATCH) {
    inserted.push(...(await insertBatch(q, tickets.slice(i, i + BATCH))));
  }
  return inserted.sort((a, b) => a.number - b.number);
}

async function insertBatch(q: Queryable, tickets: Ticket[]): Promise<Ticket[]> {
  if (!tickets.length) return [];
  const values: string[] = [];
  const params: unknown[] = [];
  for (const t of tickets) {
    const row = [
      t.id,
      t.number,
      t.personId,
      t.kind,
      t.season,
      toCents(t.amount),
      t.due === undefined ? null : toCents(t.due),
      t.reasons,
      t.status,
      t.note ?? null,
      t.createdAt,
      t.paidAt ?? null,
    ];
    const start = params.length;
    params.push(...row);
    values.push(`(${row.map((_, i) => `$${start + i + 1}`).join(', ')})`);
  }
  const { rows } = await q.query<TicketRow>(
    `INSERT INTO tickets (${COLUMNS}) VALUES ${values.join(', ')} RETURNING ${COLUMNS}`,
    params,
  );
  return rows.map(toTicket);
}

/** Saves the editable fields of an existing ticket. */
export async function saveTicket(q: Queryable, t: Ticket): Promise<Ticket> {
  const { rows } = await q.query<TicketRow>(
    `UPDATE tickets
        SET amount_cents = $2, reasons = $3, status = $4, note = $5, paid_at = $6, updated_at = now()
      WHERE id = $1 RETURNING ${COLUMNS}`,
    [t.id, toCents(t.amount), t.reasons, t.status, t.note ?? null, t.paidAt ?? null],
  );
  return toTicket(rows[0]!);
}

export async function deleteTicket(q: Queryable, id: string): Promise<void> {
  await q.query('DELETE FROM tickets WHERE id = $1', [id]);
}

export async function countTickets(q: Queryable): Promise<number> {
  const { rows } = await q.query<{ count: number }>('SELECT count(*) AS count FROM tickets');
  return rows[0]!.count;
}

/** "personId:season" for every existing yearly ticket and every dismissed one. */
export async function takenAnnualKeys(q: Queryable): Promise<Set<string>> {
  const { rows } = await q.query<{ key: string }>(
    `SELECT person_id || ':' || season AS key FROM tickets WHERE kind = 'annual'
     UNION
     SELECT person_id || ':' || season FROM annual_dismissals`,
  );
  return new Set(rows.map((r) => r.key));
}

export async function listDismissals(q: Queryable): Promise<string[]> {
  const { rows } = await q.query<{ key: string }>(
    `SELECT person_id || ':' || season AS key FROM annual_dismissals ORDER BY created_at, person_id, season`,
  );
  return rows.map((r) => r.key);
}

export async function insertDismissals(
  q: Queryable,
  items: { personId: string; season: number }[],
): Promise<void> {
  if (!items.length) return;
  await q.query(
    `INSERT INTO annual_dismissals (person_id, season)
     SELECT * FROM unnest($1::text[], $2::int[]) ON CONFLICT DO NOTHING`,
    [items.map((i) => i.personId), items.map((i) => i.season)],
  );
}

export async function addDismissal(q: Queryable, personId: string, season: number): Promise<void> {
  await q.query('INSERT INTO annual_dismissals (person_id, season) VALUES ($1, $2) ON CONFLICT DO NOTHING', [
    personId,
    season,
  ]);
}
