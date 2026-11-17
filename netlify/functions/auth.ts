/**
 * Login and password changes: the same Fastify app as api.ts, in its own function so Netlify can
 * limit password guessing per IP before the function runs. Fastify's own per-instance limit (10 per
 * 15 minutes) still applies inside, but every new instance starts that count again.
 */
import type { Config, Context } from '@netlify/functions';

import { createNetlifyHandler } from '../../src/netlify.js';

const handle = createNetlifyHandler();

export default (request: Request, context: Context): Promise<Response> => handle(request, context);

export const config: Config = {
  // Netlify reads this config without running the code, so the paths are written out: keep them
  // the same as `excludedPath` in api.ts.
  path: ['/v1/auth/login', '/v1/auth/change-password'],
  // 10 attempts per 3 minutes per IP (the longest window Netlify allows), answered with 429 at the edge.
  rateLimit: { windowLimit: 10, windowSize: 180, aggregateBy: ['ip', 'domain'] },
};
