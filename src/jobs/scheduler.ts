import type { Services } from '../services/index.js';

/** The part of a logger the jobs use (Fastify's logger fits). */
export type JobLog = {
  info: (details: object, message: string) => void;
  error: (details: object, message: string) => void;
};

/**
 * Housekeeping: starts seasons whose date has arrived (so yearly tickets appear even if nobody
 * opens the app) and removes expired sessions. Throws if a job fails. Safe to run on several
 * instances at once: season starts are serialised by a row lock and seasons are unique by year.
 */
export async function runHousekeeping(
  services: Services,
  log: JobLog,
  options: { autoStartSeasons: boolean },
  now = new Date(),
): Promise<void> {
  if (options.autoStartSeasons) {
    const started = await services.seasons.startDue(now);
    if (started.length) log.info({ seasons: started.map((s) => s.year) }, 'started due seasons');
  }
  const removed = await services.auth.deleteExpiredSessions();
  if (removed) log.info({ removed }, 'removed expired sessions');
}

/** Runs the housekeeping shortly after start and then every `intervalMinutes`, in this process. */
export function startScheduler(
  services: Services,
  log: JobLog,
  options: { autoStartSeasons: boolean; intervalMinutes: number },
): () => void {
  let running = false;

  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await runHousekeeping(services, log, options);
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
