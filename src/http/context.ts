import type { FastifyRequest } from 'fastify';

import type { Actor } from '../domain/types.js';
import { unauthorized } from '../lib/errors.js';
import type { AuthContext, AuthService } from '../services/auth.js';

declare module 'fastify' {
  interface FastifyRequest {
    /** Set by the auth hook on protected routes. */
    auth: AuthContext | null;
  }
}

/** onRequest hook for protected routes: runs before the body is read, so anonymous uploads are rejected early. */
export function requireAuth(auth: AuthService) {
  return async (request: FastifyRequest): Promise<void> => {
    const match = /^Bearer ([A-Za-z0-9_-]{1,128})$/.exec(request.headers.authorization ?? '');
    const context = match ? await auth.authenticate(match[1]!) : null;
    if (!context) throw unauthorized();
    request.auth = context;
  };
}

/** The signed-in user on a protected route. */
export function authOf(request: FastifyRequest): AuthContext {
  if (!request.auth) throw unauthorized();
  return request.auth;
}

export function actorOf(request: FastifyRequest): Actor {
  return { userId: request.auth?.user.id ?? null, ip: request.ip ?? null };
}
