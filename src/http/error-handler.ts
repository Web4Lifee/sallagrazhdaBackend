import type { FastifyError, FastifyInstance } from 'fastify';

import { AppError } from '../lib/errors.js';

type ErrorBody = { error: { code: string; message: string; details?: unknown } };

/** PostgreSQL errors that mean "bad or conflicting data", not "server broken". */
const PG_ERRORS: Record<string, { status: number; code: string; message: string }> = {
  '23505': { status: 409, code: 'CONFLICT', message: 'This conflicts with existing data' },
  '23503': { status: 409, code: 'CONFLICT', message: 'This refers to data that does not exist' },
  '23514': { status: 400, code: 'BAD_REQUEST', message: 'A value is out of the allowed range' },
  '22P02': { status: 400, code: 'BAD_REQUEST', message: 'A value has the wrong format' },
  '22001': { status: 400, code: 'BAD_REQUEST', message: 'A value is too long' },
};

/**
 * Turns every error into `{ error: { code, message } }`. Client errors keep their message;
 * server errors are logged in full and the client only gets a generic message (no stack traces, no SQL).
 */
export function registerErrorHandling(app: FastifyInstance): void {
  app.setErrorHandler<FastifyError | AppError>((error, request, reply) => {
    let status: number;
    let body: ErrorBody;

    const pg = 'code' in error && typeof error.code === 'string' ? PG_ERRORS[error.code] : undefined;

    if (error instanceof AppError) {
      status = error.statusCode;
      body = {
        error: {
          code: error.code,
          message: error.message,
          ...(error.details !== undefined && { details: error.details }),
        },
      };
    } else if (pg) {
      status = pg.status;
      body = { error: { code: pg.code, message: pg.message } };
      request.log.warn({ err: error }, 'database rejected the request');
    } else if (error.statusCode && error.statusCode >= 400 && error.statusCode < 500) {
      // Fastify's own client errors (bad JSON, body too large, rate limit, wrong content type…).
      status = error.statusCode;
      const code = status === 429 ? 'RATE_LIMITED' : status === 413 ? 'PAYLOAD_TOO_LARGE' : 'BAD_REQUEST';
      body = { error: { code, message: error.message } };
    } else {
      status = 500;
      body = { error: { code: 'INTERNAL', message: 'Something went wrong. Please try again.' } };
      request.log.error({ err: error }, 'unhandled error');
    }

    if (status === 401) void reply.header('www-authenticate', 'Bearer');
    return reply.status(status).send(body);
  });

  app.setNotFoundHandler((_request, reply) =>
    reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Route not found' } }),
  );
}
