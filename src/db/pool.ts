import pg from 'pg';

import type { Config } from '../config.js';

// Return BIGINT (int8) values, e.g. COUNT(*) and money in cents, as JS numbers.
// Every bigint we store is far below Number.MAX_SAFE_INTEGER (checked by table constraints).
pg.types.setTypeParser(pg.types.builtins.INT8, (value) => Number(value));

export type Db = pg.Pool;
export type DbClient = pg.PoolClient;
/** Anything that can run a query: the pool or a client inside a transaction. */
export type Queryable = Pick<pg.Pool, 'query'> | Pick<pg.PoolClient, 'query'>;

/** Stop runaway queries and forgotten transactions instead of letting them hold connections forever. */
const SESSION_SETTINGS = 'SET statement_timeout = 15000; SET idle_in_transaction_session_timeout = 30000';

export function createPool(database: Config['database']): Db {
  const pool = new pg.Pool({
    connectionString: database.url,
    max: database.poolMax,
    // Below the 60 s after which some hosts (e.g. Netlify Server) cut silent outbound connections.
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    application_name: 'sallagrazhda-backend',
    ssl: database.ssl === 'disable' ? false : { rejectUnauthorized: database.ssl === 'verify-full' },
    // Set on each new connection, before it is handed out, rather than as connection parameters,
    // which poolers such as Supabase's ignore. A failure here fails that checkout.
    onConnect: async (client) => {
      await client.query(SESSION_SETTINGS);
    },
  });
  return pool;
}

/** Runs `fn` inside a transaction; commits on success, rolls back on any error. */
export async function withTransaction<T>(db: Db, fn: (client: DbClient) => Promise<T>): Promise<T> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
