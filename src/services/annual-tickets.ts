import type { DbClient } from '../db/pool.js';
import type { Ticket } from '../domain/types.js';
import { planAnnualTickets } from '../lib/season-rules.js';
import { newId } from '../lib/tokens.js';
import { listPeople } from '../repositories/people.js';
import { listSeasons } from '../repositories/seasons.js';
import { getSettings, reserveTicketNumbers } from '../repositories/settings.js';
import { insertTickets, takenAnnualKeys } from '../repositories/tickets.js';

const FALLBACK_REASON = 'Mirëmbajtja e oborrit';

/**
 * Makes sure every person has an unpaid yearly ticket for each started season they belong to
 * (same rules as the app's ensureAnnualTickets). Must run inside a transaction.
 * Returns the tickets it created.
 */
export async function ensureAnnualTickets(tx: DbClient, now = new Date()): Promise<Ticket[]> {
  // Lock the settings row first: ticket numbers are handed out under this lock.
  const { settings } = await getSettings(tx, { forUpdate: true });
  const seasons = await listSeasons(tx);
  if (!seasons.length) return [];

  const people = await listPeople(tx);
  const planned = planAnnualTickets(seasons, people, await takenAnnualKeys(tx), now);
  if (!planned.length) return [];

  const first = await reserveTicketNumbers(tx, planned.length);
  const reason = settings.reasons[0] ?? FALLBACK_REASON;

  return insertTickets(
    tx,
    planned.map((p, i) => ({
      id: newId(),
      number: first + i,
      personId: p.personId,
      kind: 'annual',
      season: p.season,
      amount: settings.annualFee,
      due: settings.annualFee,
      reasons: [reason],
      status: 'unpaid',
      createdAt: p.createdAt,
    })),
  );
}
