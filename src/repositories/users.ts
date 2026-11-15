import type { Queryable } from '../db/pool.js';
import type { User } from '../domain/types.js';

type UserRow = {
  id: string;
  username: string;
  display_name: string;
  password_hash: string;
  is_active: boolean;
};

export type UserWithHash = User & { passwordHash: string; isActive: boolean };

const toUser = (r: UserRow): UserWithHash => ({
  id: r.id,
  username: r.username,
  displayName: r.display_name,
  passwordHash: r.password_hash,
  isActive: r.is_active,
});

const COLUMNS = 'id, username, display_name, password_hash, is_active';

/** Usernames are case-insensitive. */
export async function findUserByUsername(q: Queryable, username: string): Promise<UserWithHash | null> {
  const { rows } = await q.query<UserRow>(`SELECT ${COLUMNS} FROM users WHERE lower(username) = lower($1)`, [
    username,
  ]);
  return rows[0] ? toUser(rows[0]) : null;
}

export async function findUserById(q: Queryable, id: string): Promise<UserWithHash | null> {
  const { rows } = await q.query<UserRow>(`SELECT ${COLUMNS} FROM users WHERE id = $1`, [id]);
  return rows[0] ? toUser(rows[0]) : null;
}

export async function insertUser(
  q: Queryable,
  input: { username: string; displayName: string; passwordHash: string },
): Promise<UserWithHash> {
  const { rows } = await q.query<UserRow>(
    `INSERT INTO users (username, display_name, password_hash) VALUES ($1, $2, $3) RETURNING ${COLUMNS}`,
    [input.username, input.displayName, input.passwordHash],
  );
  return toUser(rows[0]!);
}

export async function updatePasswordHash(q: Queryable, userId: string, passwordHash: string): Promise<void> {
  await q.query(
    `UPDATE users SET password_hash = $2, password_changed_at = now(), updated_at = now() WHERE id = $1`,
    [userId, passwordHash],
  );
}

export async function setUserActive(q: Queryable, userId: string, isActive: boolean): Promise<void> {
  await q.query('UPDATE users SET is_active = $2, updated_at = now() WHERE id = $1', [userId, isActive]);
}
