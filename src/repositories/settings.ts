import type { Queryable } from '../db/pool.js';
import type { PaperWidth, Settings } from '../domain/types.js';
import { fromCents, toCents } from '../lib/money.js';

type SettingsRow = {
  admin_name: string;
  organization: string;
  goal_cents: number;
  annual_fee_cents: number;
  season_start_month: number;
  season_start_year: number;
  reasons: string[];
  paper_width: number;
  next_ticket_number: number;
};

const toSettings = (r: SettingsRow): Settings => ({
  adminName: r.admin_name,
  organization: r.organization,
  goal: fromCents(r.goal_cents),
  annualFee: fromCents(r.annual_fee_cents),
  seasonStartMonth: r.season_start_month,
  seasonStartYear: r.season_start_year,
  reasons: r.reasons,
  paperWidth: r.paper_width as PaperWidth,
});

/**
 * Reads the single settings row. With `forUpdate` the row stays locked until the transaction ends;
 * every operation that creates tickets takes this lock, so receipt numbers are handed out one at a time.
 */
export async function getSettings(
  q: Queryable,
  { forUpdate = false } = {},
): Promise<{ settings: Settings; nextTicketNumber: number }> {
  const { rows } = await q.query<SettingsRow>(
    `SELECT admin_name, organization, goal_cents, annual_fee_cents, season_start_month, season_start_year,
            reasons, paper_width, next_ticket_number
       FROM settings WHERE id = 1 ${forUpdate ? 'FOR UPDATE' : ''}`,
  );
  const row = rows[0];
  if (!row) throw new Error('Settings row is missing; run the database migrations.');
  return { settings: toSettings(row), nextTicketNumber: row.next_ticket_number };
}

export async function saveSettings(q: Queryable, s: Settings): Promise<void> {
  await q.query(
    `UPDATE settings
        SET admin_name = $1, organization = $2, goal_cents = $3, annual_fee_cents = $4,
            season_start_month = $5, season_start_year = $6, reasons = $7, paper_width = $8, updated_at = now()
      WHERE id = 1`,
    [
      s.adminName,
      s.organization,
      toCents(s.goal),
      toCents(s.annualFee),
      s.seasonStartMonth,
      s.seasonStartYear,
      s.reasons,
      s.paperWidth,
    ],
  );
}

/** Reserves `count` consecutive receipt numbers and returns the first. Call after getSettings({ forUpdate: true }). */
export async function reserveTicketNumbers(q: Queryable, count: number): Promise<number> {
  const { rows } = await q.query<{ first: number }>(
    `UPDATE settings SET next_ticket_number = next_ticket_number + $1, updated_at = now()
      WHERE id = 1 RETURNING next_ticket_number - $1 AS first`,
    [count],
  );
  return rows[0]!.first;
}

export async function setNextTicketNumber(q: Queryable, next: number): Promise<void> {
  await q.query('UPDATE settings SET next_ticket_number = $1, updated_at = now() WHERE id = 1', [next]);
}
