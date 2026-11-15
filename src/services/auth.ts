import { withTransaction, type Db } from '../db/pool.js';
import type { Actor, User } from '../domain/types.js';
import { AppError, badRequest, conflict, unauthorized } from '../lib/errors.js';
import {
  checkPasswordStrength,
  getDummyHash,
  hashPassword,
  needsRehash,
  verifyPassword,
} from '../lib/password.js';
import { SESSION_TOKEN_PATTERN, hashToken, newSessionToken } from '../lib/tokens.js';
import { recordAudit } from '../repositories/audit.js';
import * as sessions from '../repositories/sessions.js';
import * as users from '../repositories/users.js';

/** Don't write last_used_at on every request; once every few minutes is enough. */
const TOUCH_INTERVAL_MS = 5 * 60 * 1000;

export type LoginResult = { token: string; expiresAt: string; user: User };
export type AuthContext = { sessionId: string; user: User };

const publicUser = (u: User): User => ({ id: u.id, username: u.username, displayName: u.displayName });

export function createAuthService(db: Db, options: { sessionTtlDays: number }) {
  return {
    async login(
      username: string,
      password: string,
      meta: { ip: string | null; userAgent: string | null },
    ): Promise<LoginResult> {
      const user = await users.findUserByUsername(db, username);

      if (!user || !user.isActive) {
        // Spend the same time as a real check so response times don't reveal which usernames exist.
        await verifyPassword(password, await getDummyHash());
        throw unauthorized('Invalid username or password');
      }
      if (!(await verifyPassword(password, user.passwordHash))) {
        throw unauthorized('Invalid username or password');
      }

      const token = newSessionToken();
      const expiresAt = new Date(Date.now() + options.sessionTtlDays * 24 * 60 * 60 * 1000);
      const newHash = needsRehash(user.passwordHash) ? await hashPassword(password) : null;

      await withTransaction(db, async (tx) => {
        if (newHash) await users.updatePasswordHash(tx, user.id, newHash);
        await sessions.insertSession(tx, {
          userId: user.id,
          tokenHash: hashToken(token),
          expiresAt,
          userAgent: meta.userAgent?.slice(0, 300) ?? null,
          ip: meta.ip,
        });
        await recordAudit(tx, { userId: user.id, ip: meta.ip }, 'auth.login', 'user', user.id);
      });

      return { token, expiresAt: expiresAt.toISOString(), user: publicUser(user) };
    },

    /** Returns who owns the token, or null if it is malformed, unknown, expired or the user is disabled. */
    async authenticate(token: string): Promise<AuthContext | null> {
      if (!SESSION_TOKEN_PATTERN.test(token)) return null;
      const session = await sessions.findActiveSession(db, hashToken(token));
      if (!session) return null;
      if (Date.now() - session.lastUsedAt.getTime() > TOUCH_INTERVAL_MS) {
        await sessions.touchSession(db, session.sessionId);
      }
      return { sessionId: session.sessionId, user: session.user };
    },

    async logout(auth: AuthContext, actor: Actor): Promise<void> {
      await withTransaction(db, async (tx) => {
        await sessions.deleteSession(tx, auth.sessionId);
        await recordAudit(tx, actor, 'auth.logout', 'user', auth.user.id);
      });
    },

    /** Changes the password and signs out every other device. */
    async changePassword(auth: AuthContext, currentPassword: string, newPassword: string, actor: Actor) {
      const user = await users.findUserById(db, auth.user.id);
      if (!user) throw unauthorized();
      if (!(await verifyPassword(currentPassword, user.passwordHash))) {
        // 400, not 401: the session is still valid, only the typed password is wrong.
        throw new AppError(400, 'INVALID_PASSWORD', 'Current password is incorrect');
      }
      const problem = checkPasswordStrength(newPassword, user.username);
      if (problem) throw badRequest(problem);
      if (currentPassword === newPassword) throw badRequest('The new password must be different');

      const hash = await hashPassword(newPassword);
      await withTransaction(db, async (tx) => {
        await users.updatePasswordHash(tx, user.id, hash);
        const revoked = await sessions.deleteUserSessions(tx, user.id, auth.sessionId);
        await recordAudit(tx, actor, 'auth.change_password', 'user', user.id, { revokedSessions: revoked });
      });
    },

    /** Used by the create-admin CLI. */
    async createUser(input: { username: string; displayName: string; password: string }): Promise<User> {
      const problem = checkPasswordStrength(input.password, input.username);
      if (problem) throw badRequest(problem);
      if (await users.findUserByUsername(db, input.username))
        throw conflict('That username is already taken');
      const user = await withTransaction(db, async (tx) => {
        const created = await users.insertUser(tx, {
          username: input.username,
          displayName: input.displayName,
          passwordHash: await hashPassword(input.password),
        });
        await recordAudit(tx, { userId: null, ip: null }, 'user.create', 'user', created.id, {
          username: created.username,
          via: 'cli',
        });
        return created;
      });
      return publicUser(user);
    },

    /** Used by the create-admin CLI (--reset). Signs the user out everywhere and re-enables the account. */
    async resetPassword(username: string, password: string): Promise<User> {
      const user = await users.findUserByUsername(db, username);
      if (!user) throw badRequest(`No user named "${username}"`);
      const problem = checkPasswordStrength(password, user.username);
      if (problem) throw badRequest(problem);
      const hash = await hashPassword(password);
      await withTransaction(db, async (tx) => {
        await users.updatePasswordHash(tx, user.id, hash);
        await users.setUserActive(tx, user.id, true);
        await sessions.deleteUserSessions(tx, user.id);
        await recordAudit(tx, { userId: null, ip: null }, 'user.reset_password', 'user', user.id, {
          via: 'cli',
        });
      });
      return publicUser(user);
    },

    deleteExpiredSessions: () => sessions.deleteExpiredSessions(db),
  };
}

export type AuthService = ReturnType<typeof createAuthService>;
