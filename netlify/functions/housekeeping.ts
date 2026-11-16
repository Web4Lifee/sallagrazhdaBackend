/**
 * Netlify scheduled function, every hour: starts any season whose date has arrived and removes
 * expired sessions, even if nobody opens the app (Netlify Functions can't run background timers).
 * The database queries also count as activity for Supabase, which pauses free projects after
 * 7 days without any.
 */
import type { Config } from '@netlify/functions';

import { runNetlifyHousekeeping } from '../../src/netlify.js';

export default async (): Promise<void> => {
  await runNetlifyHousekeeping({
    info: (details, message) => console.log(JSON.stringify({ level: 'info', msg: message, ...details })),
    error: (details, message) => console.error(JSON.stringify({ level: 'error', msg: message, ...details })),
  });
};

export const config: Config = {
  schedule: '@hourly',
};
