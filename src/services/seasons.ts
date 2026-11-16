import { withTransaction, type Db } from '../db/pool.js';
import type { SeasonRecord } from '../domain/types.js';
import { nextSeasonDate, nextSeasonYear } from '../lib/season-rules.js';
import { insertSeason, listSeasons } from '../repositories/seasons.js';
import { getSettings } from '../repositories/settings.js';
import { ensureAnnualTickets } from './annual-tickets.js';

/** Catch up at most this many seasons in one go (same limit as the app). */
const MAX_CATCH_UP = 5;

export function createSeasonsService(db: Db) {
  return {
    list: () => listSeasons(db),

    /** Starts the next season right now (the Settings button) and creates the unpaid yearly tickets. */
    startNext(): Promise<{ season: SeasonRecord; createdTickets: number }> {
      return withTransaction(db, async (tx) => {
        const { settings } = await getSettings(tx, { forUpdate: true });
        const seasons = await listSeasons(tx);
        const season = await insertSeason(tx, {
          year: nextSeasonYear(seasons, settings),
          month: settings.seasonStartMonth,
          startedAt: new Date().toISOString(),
        });
        const created = await ensureAnnualTickets(tx);
        return { season, createdTickets: created.length };
      });
    },

    /** Starts every season whose start date (1st of the chosen month) has arrived. Returns the started seasons. */
    startDue(now: Date): Promise<SeasonRecord[]> {
      return withTransaction(db, async (tx) => {
        const { settings } = await getSettings(tx, { forUpdate: true });
        const seasons = await listSeasons(tx);
        const started: SeasonRecord[] = [];

        while (started.length < MAX_CATCH_UP) {
          const start = nextSeasonDate(seasons, settings);
          if (start > now) break;
          const season = await insertSeason(tx, {
            year: nextSeasonYear(seasons, settings),
            month: settings.seasonStartMonth,
            startedAt: start.toISOString(),
          });
          seasons.push(season);
          started.push(season);
        }

        if (started.length) await ensureAnnualTickets(tx, now);
        return started;
      });
    },
  };
}

export type SeasonsService = ReturnType<typeof createSeasonsService>;
