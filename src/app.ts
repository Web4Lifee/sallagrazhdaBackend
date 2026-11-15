import { randomUUID } from 'node:crypto';

import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance } from 'fastify';

import type { Config } from './config.js';
import type { Db } from './db/pool.js';
import { requireAuth } from './http/context.js';
import { registerErrorHandling } from './http/error-handler.js';
import { authRoutes } from './routes/auth.js';
import { healthRoutes } from './routes/health.js';
import { peopleRoutes } from './routes/people.js';
import { seasonRoutes } from './routes/seasons.js';
import { settingsRoutes } from './routes/settings.js';
import { syncRoutes } from './routes/sync.js';
import { ticketRoutes } from './routes/tickets.js';
import { createServices, type Services } from './services/index.js';

export type AppDeps = { config: Config; db: Db; services?: Services };

const LOCAL_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1)(:\d{1,5})?$/;

/**
 * Which browser origins may read API responses. Listed CORS_ORIGINS always; in development also
 * http://localhost:<any port>, because Expo picks another port when 8081 is busy.
 * Never in production. Requests without an Origin (the native app, curl) don't use CORS at all.
 */
export function isAllowedOrigin(
  origin: string | undefined,
  config: Pick<Config, 'corsOrigins' | 'isProduction'>,
): boolean {
  if (!origin) return false;
  return config.corsOrigins.includes(origin) || (!config.isProduction && LOCAL_ORIGIN.test(origin));
}

/** Builds the HTTP app without listening, so tests can drive it with app.inject(). */
export async function buildApp({
  config,
  db,
  services = createServices(db, config),
}: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: config.logLevel,
      // Never write credentials to the logs.
      redact: { paths: ['req.headers.authorization', 'req.headers.cookie'], censor: '[redacted]' },
      ...(config.logPretty && {
        transport: {
          target: 'pino-pretty',
          options: { translateTime: 'SYS:HH:MM:ss', ignore: 'pid,hostname' },
        },
      }),
    },
    trustProxy: config.trustProxy,
    bodyLimit: 1024 * 1024,
    // Drop clients that send requests too slowly (slowloris-style attacks).
    requestTimeout: 30_000,
    genReqId: () => randomUUID(),
  });

  app.decorateRequest('auth', null);

  await app.register(helmet, {
    contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
  });

  // Native apps don't need CORS. Only listed browser origins (e.g. the web build) may call the API,
  // plus, outside production, the app's web preview on localhost (any port).
  if (config.corsOrigins.length || !config.isProduction) {
    await app.register(cors, {
      origin: (origin, callback) => callback(null, isAllowedOrigin(origin, config)),
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
      allowedHeaders: ['Authorization', 'Content-Type'],
      maxAge: 600,
    });
  }

  await app.register(rateLimit, { global: true, max: config.rateLimitMax, timeWindow: '1 minute' });

  app.addHook('onSend', async (request, reply) => {
    void reply.header('x-request-id', request.id);
    // Responses hold personal data: never let browsers or proxies cache them.
    void reply.header('cache-control', 'no-store');
  });

  registerErrorHandling(app);

  await app.register(healthRoutes(db));
  await app.register(authRoutes(services.auth, { loginRateLimitMax: config.loginRateLimitMax }));

  // Data routes: every request needs a valid session.
  await app.register(async (secured) => {
    secured.addHook('onRequest', requireAuth(services.auth));
    await secured.register(syncRoutes(services.sync));
    await secured.register(peopleRoutes(services.people));
    await secured.register(ticketRoutes(services.tickets));
    await secured.register(settingsRoutes(services.settings));
    await secured.register(seasonRoutes(services.seasons));
  });

  return app;
}
