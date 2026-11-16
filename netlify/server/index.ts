/**
 * The API on Netlify Server (https://docs.netlify.com/build/server/). Netlify bundles this file,
 * runs it in the region set in netlify.toml and sends it every request that isn't a static file.
 * It stops after 5 idle minutes and starts again on the next request.
 *
 * Only DATABASE_URL must be set in the Netlify UI (Project configuration → Environment variables).
 * The defaults below suit Supabase; an environment variable with the same name overrides each one.
 */
import { onShutdown } from '@netlify/server';

import { startApi } from '../../src/start.js';

process.env.NODE_ENV ??= 'production';
// Seasons start at midnight on the 1st of the month in this time zone.
process.env.TZ ??= 'Europe/Tirane';
// Supabase only accepts encrypted connections.
process.env.DATABASE_SSL ??= 'require';
// Supabase's free connection pooler has room for only a few connections per project.
process.env.DATABASE_POOL_MAX ??= '5';

const api = await startApi();

onShutdown(async ({ drained }) => {
  await drained;
  await api.stop();
});
