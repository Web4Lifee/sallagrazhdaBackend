import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { loadConfig } from '../config.js';
import { createPool, type Db } from './pool.js';

/** Works from both src/db (tsx) and dist/db (compiled). */
export const MIGRATIONS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../migrations');

/** Arbitrary constant so only one migration run can happen at a time, even across containers. */
const MIGRATION_LOCK_ID = 727_001;

export type MigrationResult = { applied: string[]; skipped: number };

/**
 * Applies every `migrations/*.sql` file that has not been applied yet, in name order,
 * each in its own transaction. Refuses to continue if an already-applied file was edited.
 */
export async function migrate(
  db: Db,
  log: (msg: string) => void = () => undefined,
): Promise<MigrationResult> {
  const client = await db.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_ID]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name text PRIMARY KEY,
        checksum text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )`);

    const { rows } = await client.query<{ name: string; checksum: string }>(
      'SELECT name, checksum FROM schema_migrations',
    );
    const done = new Map(rows.map((r) => [r.name, r.checksum]));

    const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();
    const applied: string[] = [];

    for (const file of files) {
      // Normalise line endings so a Windows checkout produces the same checksum as Linux.
      const sql = (await readFile(path.join(MIGRATIONS_DIR, file), 'utf8')).replace(/\r\n/g, '\n');
      const checksum = createHash('sha256').update(sql).digest('hex');
      const previous = done.get(file);

      if (previous) {
        if (previous !== checksum) {
          throw new Error(
            `Migration ${file} was changed after it was applied. Never edit applied migrations; add a new file instead.`,
          );
        }
        continue;
      }

      log(`Applying ${file}…`);
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)', [
          file,
          checksum,
        ]);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw new Error(`Migration ${file} failed: ${(error as Error).message}`, { cause: error });
      }
      applied.push(file);
    }

    return { applied, skipped: files.length - applied.length };
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_ID]).catch(() => undefined);
    client.release();
  }
}

// CLI: `npm run migrate` (compiled) or `npm run migrate:dev` (tsx).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const config = loadConfig();
  const db = createPool(config.database);
  migrate(db, (msg) => console.log(msg))
    .then(({ applied, skipped }) => {
      console.log(
        applied.length
          ? `Applied ${applied.length} migration(s); ${skipped} already up to date.`
          : `Database is up to date (${skipped} migration(s)).`,
      );
    })
    .catch((error: unknown) => {
      console.error((error as Error).message);
      process.exitCode = 1;
    })
    .finally(() => db.end());
}
