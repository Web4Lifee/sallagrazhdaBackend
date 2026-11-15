import type { Config } from '../config.js';
import type { Db } from '../db/pool.js';
import { createAuthService } from './auth.js';
import { createPeopleService } from './people.js';
import { createSeasonsService } from './seasons.js';
import { createSettingsService } from './settings.js';
import { createSyncService } from './sync.js';
import { createTicketsService } from './tickets.js';

export function createServices(db: Db, config: Pick<Config, 'sessionTtlDays'>) {
  return {
    auth: createAuthService(db, { sessionTtlDays: config.sessionTtlDays }),
    people: createPeopleService(db),
    tickets: createTicketsService(db),
    seasons: createSeasonsService(db),
    settings: createSettingsService(db),
    sync: createSyncService(db),
  };
}

export type Services = ReturnType<typeof createServices>;
