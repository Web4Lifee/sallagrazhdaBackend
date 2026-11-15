import { createPool } from '../src/db/pool.js';
import { migrate } from '../src/db/migrate.js';
import { TEST_DATABASE_URL, assertTestDatabase } from './helpers.js';

/** Rebuilds the test database from the migrations once per test run. */
export default async function setup(): Promise<void> {
  assertTestDatabase(TEST_DATABASE_URL);
  const db = createPool({ url: TEST_DATABASE_URL, ssl: 'disable', poolMax: 2 });
  try {
    await db.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    await migrate(db);
  } catch (error) {
    throw new Error(
      `Could not prepare the test database at ${new URL(TEST_DATABASE_URL).host}. ` +
        `Is it running? Start it with: docker compose up -d db\n${(error as Error).message}`,
      { cause: error },
    );
  } finally {
    await db.end();
  }
}
