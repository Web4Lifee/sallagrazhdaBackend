import { withTransaction, type Db } from '../db/pool.js';
import type { Actor, SeasonRecord } from '../domain/types.js';
import { nextSeasonDate, nextSeasonYear } from '../lib/season-rules.js';
import { recordAudit } from '../repositories/audit.js';
import { insertSeason, listSeasons } from '../repositories/seasons.js';
import { getSettings } from '../repositories/settings.js';
import { ensureAnnualTickets } from './annual-tickets.js';

/** Catch up at most this many seasons in one go (same limit as the app). */
const MAX_CATCH_UP = 5;

export function createSeasonsService(db: Db) {
  return {
    list: () => listSeasons(db),

    /** Starts the next season right now (the Settings button) and creates the unpaid yearly tickets. */
    startNext(actor: Actor): Promise<{ season: SeasonRecord; createdTickets: number }> {
      return withTransaction(db, async (tx) => {
        const { settings } = await getSettings(tx, { forUpdate: true });
        const seasons = await listSeasons(tx);
        const season = await insertSeason(tx, {
          year: nextSeasonYear(seasons, settings),
          month: settings.seasonStartMonth,
          startedAt: new Date().toISOString(),
        });
        const created = await ensureAnnualTickets(tx);
        await recordAudit(tx, actor, 'season.start', 'season', String(season.year), {
          createdTickets: created.length,
        });
        return { season, createdTickets: created.length };
      });
    },

    /** Starts every season whose start date (1st of the chosen month) has arrived. Returns the started seasons. */
    startDue(now: Date, actor: Actor): Promise<SeasonRecord[]> {
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

        if (started.length) {
          const created = await ensureAnnualTickets(tx, now);
          await recordAudit(tx, actor, 'season.auto_start', 'season', null, {
            seasons: started.map((s) => s.year),
            createdTickets: created.length,
          });
        }
        return started;
      });
    },
  };
}

export type SeasonsService = ReturnType<typeof createSeasonsService>;
