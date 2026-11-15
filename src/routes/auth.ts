import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { actorOf, authOf, requireAuth } from '../http/context.js';
import { PASSWORD_MAX_LENGTH } from '../lib/password.js';
import { parse } from '../lib/validation.js';
import type { AuthService } from '../services/auth.js';

const LoginBody = z.strictObject({
  username: z.string().trim().min(1).max(50),
  password: z.string().min(1).max(PASSWORD_MAX_LENGTH),
});

const ChangePasswordBody = z.strictObject({
  currentPassword: z.string().min(1).max(PASSWORD_MAX_LENGTH),
  newPassword: z.string().min(1).max(PASSWORD_MAX_LENGTH),
});

export function authRoutes(auth: AuthService, options: { loginRateLimitMax: number }): FastifyPluginAsync {
  return async (app) => {
    app.post(
      '/v1/auth/login',
      // Much stricter limit than the rest of the API, to slow down password guessing.
      { config: { rateLimit: { max: options.loginRateLimitMax, timeWindow: '15 minutes' } } },
      async (request) => {
        const body = parse(LoginBody, request.body);
        return auth.login(body.username, body.password, {
          ip: request.ip ?? null,
          userAgent: request.headers['user-agent'] ?? null,
        });
      },
    );

    // Everything below needs a valid session.
    await app.register(async (secured) => {
      secured.addHook('onRequest', requireAuth(auth));

      secured.get('/v1/auth/me', async (request) => ({ user: authOf(request).user }));

      secured.post('/v1/auth/logout', async (request, reply) => {
        await auth.logout(authOf(request), actorOf(request));
        return reply.status(204).send();
      });

      secured.post(
        '/v1/auth/change-password',
        { config: { rateLimit: { max: options.loginRateLimitMax, timeWindow: '15 minutes' } } },
        async (request, reply) => {
          const body = parse(ChangePasswordBody, request.body);
          await auth.changePassword(
            authOf(request),
            body.currentPassword,
            body.newPassword,
            actorOf(request),
          );
          return reply.status(204).send();
        },
      );
    });
  };
}
