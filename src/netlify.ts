/**
 * Running on Netlify Functions (netlify/functions/). Netlify runs each function on AWS Lambda:
 * an instance handles one request at a time, is frozen between requests and is discarded after a
 * while, so nothing runs in the background and the instance's memory is not shared.
 */
import { loadConfig } from './config.js';
import { closeIdleConnections, createPool } from './db/pool.js';
import { handleFetchRequest } from './http/fetch-adapter.js';
import { runHousekeeping, type JobLog } from './jobs/scheduler.js';
import { createServices } from './services/index.js';
import { createApi, type Api } from './start.js';

/**
 * Settings for Supabase on Netlify. Only DATABASE_URL must be set in the Netlify UI; an
 * environment variable with the same name overrides each default here.
 */
export function applyNetlifyDefaults(env: NodeJS.ProcessEnv = process.env): void {
  env.NODE_ENV ??= 'production';
  // Seasons start at midnight on the 1st of the month in this time zone. Lambda sets TZ to ":UTC".
  if (!env.TZ || env.TZ.startsWith(':')) env.TZ = 'Europe/Tirane';
  // Encrypted and verified: Supabase's certificates chain to its own root CA, bundled in src/db/supabase-ca.ts.
  env.DATABASE_SSL ??= 'verify-full';
  env.DATABASE_SSL_CA ??= 'supabase';
  // One request at a time per instance; 2 leaves room for a query beside an open transaction.
  env.DATABASE_POOL_MAX ??= '2';
}

/** Reuse connections between requests that follow each other; after a longer pause, open new ones. */
const MAX_IDLE_REUSE_MS = 60_000;

export type FunctionContext = { ip?: string };

/** The request handler for netlify/functions/api.ts. The API is built once per instance. */
export function createNetlifyHandler(): (request: Request, context: FunctionContext) => Promise<Response> {
  let api: Promise<Api> | undefined;
  let lastRequestAt = 0;

  return async (request, context) => {
    applyNetlifyDefaults();
    // Build on the first request; if that fails (e.g. a bad setting), try again on the next one.
    api ??= createApi().then(
      (created) => {
        created.app.log.info({ node: process.version }, 'function instance started');
        return created;
      },
      (error: unknown) => {
        api = undefined;
        throw error;
      },
    );
    const { app, db } = await api;

    // While the instance was frozen its connections may have been cut on the way to the database.
    if (Date.now() - lastRequestAt > MAX_IDLE_REUSE_MS) await closeIdleConnections(db);
    try {
      return await handleFetchRequest(app, request, context.ip);
    } finally {
      lastRequestAt = Date.now();
    }
  };
}

/** The scheduled housekeeping for netlify/functions/housekeeping.ts. Throws if a job fails. */
export async function runNetlifyHousekeeping(log: JobLog): Promise<void> {
  applyNetlifyDefaults();
  const config = loadConfig();
  const db = createPool(config.database);
  try {
    await runHousekeeping(createServices(db, config), log, { autoStartSeasons: config.autoStartSeasons });
  } finally {
    await db.end();
  }
}
