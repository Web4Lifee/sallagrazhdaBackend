import { withTransaction, type Db } from '../db/pool.js';
import type { Snapshot } from '../domain/types.js';
import { AppError, badRequest } from '../lib/errors.js';
import { capitalize, cleanReasons } from '../lib/text.js';
import { countPeople, insertPeople, listPeople } from '../repositories/people.js';
import { insertSeason, listSeasons } from '../repositories/seasons.js';
import { getSettings, saveSettings, setNextTicketNumber } from '../repositories/settings.js';
import {
  countTickets,
  insertDismissals,
  insertTickets,
  listDismissals,
  listTickets,
} from '../repositories/tickets.js';

export type ImportResult = { people: number; tickets: number; seasons: number; dismissedAnnual: number };

export function createSyncService(db: Db) {
  return {
    /** Everything in one consistent read, in the same shape as the app's saved store. */
    async snapshot(): Promise<Snapshot & { serverTime: string }> {
      const client = await db.connect();
      try {
        await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
        const [people, tickets, { settings, nextTicketNumber }, seasons, dismissedAnnual] = [
          await listPeople(client),
          await listTickets(client),
          await getSettings(client),
          await listSeasons(client),
          await listDismissals(client),
        ];
        await client.query('COMMIT');
        return {
          people,
          tickets,
          settings,
          seasons,
          nextTicketNumber,
          dismissedAnnual,
          serverTime: new Date().toISOString(),
        };
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    },

    /**
     * One-time move of the data saved on the phone to the server.
     * Only works while the server has no people, tickets or seasons, so it can never overwrite live data.
     */
    import(data: Snapshot): Promise<ImportResult> {
      return withTransaction(db, async (tx) => {
        await getSettings(tx, { forUpdate: true });
        const existing = (await countPeople(tx)) + (await countTickets(tx)) + (await listSeasons(tx)).length;
        if (existing > 0) {
          throw new AppError(
            409,
            'SERVER_NOT_EMPTY',
            'The server already has data; import only works on an empty server',
          );
        }

        const problems = findProblems(data);
        if (problems.length)
          throw badRequest('The data has problems and was not imported', problems.slice(0, 50));

        const personIds = new Set(data.people.map((p) => p.id));
        const dismissals = data.dismissedAnnual
          .map(parseAnnualKey)
          .filter((d): d is { personId: string; season: number } => d !== null && personIds.has(d.personId));

        await insertPeople(
          tx,
          data.people.map((p) => ({
            ...p,
            firstName: capitalize(p.firstName),
            fatherName: capitalize(p.fatherName),
            lastName: capitalize(p.lastName),
          })),
        );
        for (const season of [...data.seasons].sort((a, b) => a.year - b.year))
          await insertSeason(tx, season);
        await insertTickets(
          tx,
          data.tickets.map((t) => ({
            ...t,
            reasons: cleanReasons(t.reasons),
            ...(t.note !== undefined && { note: t.note.trim() }),
          })),
        );
        await insertDismissals(tx, dismissals);
        await saveSettings(tx, { ...data.settings, reasons: cleanReasons(data.settings.reasons) });

        const highest = data.tickets.reduce((max, t) => Math.max(max, t.number), 0);
        await setNextTicketNumber(tx, Math.max(data.nextTicketNumber, highest + 1));

        return {
          people: data.people.length,
          tickets: data.tickets.length,
          seasons: data.seasons.length,
          dismissedAnnual: dismissals.length,
        };
      });
    },
  };
}

function parseAnnualKey(key: string): { personId: string; season: number } | null {
  const at = key.lastIndexOf(':');
  if (at <= 0) return null;
  const season = Number(key.slice(at + 1));
  return Number.isInteger(season) ? { personId: key.slice(0, at), season } : null;
}

/** Checks the relationships the schema can't express per record. */
function findProblems(data: Snapshot): string[] {
  const problems: string[] = [];
  const duplicates = <T>(items: T[], key: (item: T) => string | number, label: string) => {
    const seen = new Set<string | number>();
    for (const item of items) {
      const k = key(item);
      if (seen.has(k)) problems.push(`Duplicate ${label}: ${k}`);
      seen.add(k);
    }
  };

  duplicates(data.people, (p) => p.id, 'person id');
  duplicates(data.tickets, (t) => t.id, 'ticket id');
  duplicates(data.tickets, (t) => t.number, 'ticket number');
  duplicates(data.seasons, (s) => s.year, 'season');
  duplicates(
    data.tickets.filter((t) => t.kind === 'annual'),
    (t) => `${t.personId}:${t.season}`,
    'yearly ticket for person:season',
  );

  const personIds = new Set(data.people.map((p) => p.id));
  for (const t of data.tickets) {
    if (!personIds.has(t.personId))
      problems.push(`Ticket ${t.number} belongs to unknown person ${t.personId}`);
    if ((t.status === 'paid') !== (t.paidAt !== undefined)) {
      problems.push(`Ticket ${t.number}: paidAt must be set exactly when the ticket is paid`);
    }
  }
  return problems;
}

export type SyncService = ReturnType<typeof createSyncService>;
