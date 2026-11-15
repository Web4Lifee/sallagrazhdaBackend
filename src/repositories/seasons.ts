import type { Queryable } from '../db/pool.js';
import type { SeasonRecord } from '../domain/types.js';

type SeasonRow = { year: number; month: number; started_at: Date };

const toSeason = (r: SeasonRow): SeasonRecord => ({
  year: r.year,
  month: r.month,
  startedAt: r.started_at.toISOString(),
});

/** Started seasons, oldest first. */
export async function listSeasons(q: Queryable): Promise<SeasonRecord[]> {
  const { rows } = await q.query<SeasonRow>('SELECT year, month, started_at FROM seasons ORDER BY year');
  return rows.map(toSeason);
}

export async function insertSeason(q: Queryable, season: SeasonRecord): Promise<SeasonRecord> {
  const { rows } = await q.query<SeasonRow>(
    'INSERT INTO seasons (year, month, started_at) VALUES ($1, $2, $3) RETURNING year, month, started_at',
    [season.year, season.month, season.startedAt],
  );
  return toSeason(rows[0]!);
}
