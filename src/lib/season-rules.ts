/**
 * Season rules, kept identical to the app (src/lib/season.ts there).
 * Dates use the server's local time zone, so set TZ (e.g. Europe/Tirane) on the server.
 */
import type { SeasonRecord, Settings } from '../domain/types.js';

type SeasonSettings = Pick<Settings, 'seasonStartMonth' | 'seasonStartYear'>;

/** Midnight on the 1st of the season's start month. */
export function seasonStart(season: number, startMonth: number): Date {
  return new Date(season, startMonth, 1);
}

/** The latest started season, if any. */
export function currentSeason(seasons: SeasonRecord[]): SeasonRecord | undefined {
  let latest: SeasonRecord | undefined;
  for (const s of seasons) if (!latest || s.year > latest.year) latest = s;
  return latest;
}

/** Year of the next season to start: the one after the current, or the configured first season. */
export function nextSeasonYear(seasons: SeasonRecord[], settings: SeasonSettings): number {
  const current = currentSeason(seasons);
  return current ? current.year + 1 : settings.seasonStartYear;
}

/** When the next season starts automatically: the 1st of the chosen month. */
export function nextSeasonDate(seasons: SeasonRecord[], settings: SeasonSettings): Date {
  return seasonStart(nextSeasonYear(seasons, settings), settings.seasonStartMonth);
}

/** The season new payments belong to: the current one, or the upcoming first season. */
export function activeSeasonYear(seasons: SeasonRecord[], settings: SeasonSettings): number {
  return currentSeason(seasons)?.year ?? settings.seasonStartYear;
}

export type PersonForAnnual = { id: string; createdAt: string };
export type PlannedAnnualTicket = { personId: string; season: number; createdAt: string };

/**
 * Which yearly tickets are missing: one per person per started season, except for
 * seasons that ended before the person was registered and person/season pairs that
 * already have a yearly ticket or were dismissed (`taken` holds "personId:season").
 */
export function planAnnualTickets(
  seasons: SeasonRecord[],
  people: PersonForAnnual[],
  taken: Set<string>,
  now: Date,
): PlannedAnnualTicket[] {
  const sorted = [...seasons].sort((a, b) => a.year - b.year);
  const nowIso = now.toISOString();
  const planned: PlannedAnnualTicket[] = [];

  sorted.forEach((season, i) => {
    const endsAt = sorted[i + 1]?.startedAt;
    for (const person of people) {
      // People registered after this season ended don't owe for it.
      if (endsAt && Date.parse(person.createdAt) >= Date.parse(endsAt)) continue;
      if (taken.has(annualKey(person.id, season.year))) continue;
      planned.push({
        personId: person.id,
        season: season.year,
        createdAt: Date.parse(person.createdAt) > Date.parse(season.startedAt) ? nowIso : season.startedAt,
      });
    }
  });
  return planned;
}

export const annualKey = (personId: string, season: number) => `${personId}:${season}`;
