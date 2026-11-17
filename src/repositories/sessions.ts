import type { Queryable } from '../db/pool.js';
import type { User } from '../domain/types.js';

export type SessionWithUser = { sessionId: string; expiresAt: Date; lastUsedAt: Date; user: User };

export async function insertSession(
  q: Queryable,
  input: { userId: string; tokenHash: Buffer; expiresAt: Date; userAgent: string | null; ip: string | null },
): Promise<{ id: string }> {
  const { rows } = await q.query<{ id: string }>(
    `INSERT INTO sessions (user_id, token_hash, expires_at, user_agent, ip)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [input.userId, input.tokenHash, input.expiresAt, input.userAgent, input.ip],
  );
  return rows[0]!;
}

/** Finds an unexpired session for an active user. */
export async function findActiveSession(q: Queryable, tokenHash: Buffer): Promise<SessionWithUser | null> {
  const { rows } = await q.query<{
    session_id: string;
    expires_at: Date;
    last_used_at: Date;
    user_id: string;
    username: string;
    display_name: string;
  }>(
    `SELECT s.id AS session_id, s.expires_at, s.last_used_at, u.id AS user_id, u.username, u.display_name
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1 AND s.expires_at > now() AND u.is_active`,
    [tokenHash],
  );
  const r = rows[0];
  if (!r) return null;
  return {
    sessionId: r.session_id,
    expiresAt: r.expires_at,
    lastUsedAt: r.last_used_at,
    user: { id: r.user_id, username: r.username, displayName: r.display_name },
  };
}

/** Records that the session was used and moves its end to `expiresAt`. */
export async function touchSession(q: Queryable, sessionId: string, expiresAt: Date): Promise<void> {
  await q.query('UPDATE sessions SET last_used_at = now(), expires_at = $2 WHERE id = $1', [
    sessionId,
    expiresAt,
  ]);
}

export async function deleteSession(q: Queryable, sessionId: string): Promise<void> {
  await q.query('DELETE FROM sessions WHERE id = $1', [sessionId]);
}

/** Signs the user out everywhere, optionally keeping one session (the one changing the password). */
export async function deleteUserSessions(
  q: Queryable,
  userId: string,
  exceptSessionId?: string,
): Promise<number> {
  const { rowCount } = await q.query(
    'DELETE FROM sessions WHERE user_id = $1 AND ($2::uuid IS NULL OR id <> $2::uuid)',
    [userId, exceptSessionId ?? null],
  );
  return rowCount ?? 0;
}

export async function deleteExpiredSessions(q: Queryable): Promise<number> {
  const { rowCount } = await q.query('DELETE FROM sessions WHERE expires_at <= now()');
  return rowCount ?? 0;
}
