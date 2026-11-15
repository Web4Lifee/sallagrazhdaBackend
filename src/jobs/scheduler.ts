import type { FastifyBaseLogger } from 'fastify';

import type { Services } from '../services/index.js';

/**
 * Background housekeeping: starts seasons whose date has arrived (so yearly tickets appear
 * even if nobody opens the app) and removes expired sessions. Safe to run on several
 * instances at once: season starts are serialised by a row lock and seasons are unique by year.
 */
export function startScheduler(
  services: Services,
  log: FastifyBaseLogger,
  options: { autoStartSeasons: boolean; intervalMinutes: number },
): () => void {
  let running = false;

  const tick = async () => {
    if (running) return;
    running = true;
    try {
      if (options.autoStartSeasons) {
        const started = await services.seasons.startDue(new Date(), { userId: null, ip: null });
        if (started.length) log.info({ seasons: started.map((s) => s.year) }, 'started due seasons');
      }
      const removed = await services.auth.deleteExpiredSessions();
      if (removed) log.info({ removed }, 'removed expired sessions');
    } catch (error) {
      log.error({ err: error }, 'scheduled job failed');
    } finally {
      running = false;
    }
  };

  const first = setTimeout(tick, 5_000);
  const interval = setInterval(tick, options.intervalMinutes * 60_000);
  first.unref();
  interval.unref();

  return () => {
    clearTimeout(first);
    clearInterval(interval);
  };
}
