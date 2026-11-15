/**
 * Creates an admin account, or resets its password.
 *
 *   npm run create-admin -- <username> [--name "Display Name"] [--reset]
 *
 * The password is read from the ADMIN_PASSWORD environment variable, or asked for
 * (hidden) when run in a terminal. With neither, a strong password is generated and shown once.
 */
import { randomBytes } from 'node:crypto';
import { createInterface } from 'node:readline';
import { parseArgs } from 'node:util';

import { loadConfig } from '../config.js';
import { createPool } from '../db/pool.js';
import { AppError } from '../lib/errors.js';
import { createAuthService } from '../services/auth.js';

const USAGE = 'Usage: create-admin <username> [--name "Display Name"] [--reset]';

function askHidden(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const output = rl as unknown as { _writeToOutput: (s: string) => void };
    let prompted = false;
    output._writeToOutput = (s: string) => {
      // Show the question once, then hide everything typed.
      if (!prompted) {
        process.stdout.write(s);
        prompted = true;
      }
    };
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });
  });
}

async function readPassword(): Promise<{ password: string; generated: boolean }> {
  if (process.env.ADMIN_PASSWORD) return { password: process.env.ADMIN_PASSWORD, generated: false };
  if (process.stdin.isTTY) {
    const first = await askHidden('Password (at least 12 characters): ');
    const second = await askHidden('Repeat password: ');
    if (first !== second) throw new Error('The passwords do not match.');
    return { password: first, generated: false };
  }
  return { password: randomBytes(18).toString('base64url'), generated: true };
}

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { name: { type: 'string' }, reset: { type: 'boolean', default: false } },
  });
  const username = positionals[0];
  if (!username || !/^[A-Za-z0-9._-]{3,50}$/.test(username)) {
    throw new Error(`${USAGE}\nUsername: 3–50 letters, digits, dots, dashes or underscores.`);
  }

  const config = loadConfig();
  const db = createPool(config.database);
  try {
    const auth = createAuthService(db, { sessionTtlDays: config.sessionTtlDays });
    const { password, generated } = await readPassword();

    const user = values.reset
      ? await auth.resetPassword(username, password)
      : await auth.createUser({ username, displayName: values.name?.trim() ?? username, password });

    console.log(
      values.reset
        ? `Password reset for "${user.username}". All their sessions were signed out.`
        : `Created admin "${user.username}".`,
    );
    if (generated) {
      console.log(`Generated password (shown only now, store it in a password manager):\n\n  ${password}\n`);
    }
  } finally {
    await db.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof AppError || error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
