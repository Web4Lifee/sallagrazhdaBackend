/**
 * The whole API as one Netlify Function: every request that isn't a static file from public/
 * goes to the Fastify app. Login and password changes go through auth.ts, which has a stricter
 * rate limit. See src/netlify.ts and docs/NETLIFY.md.
 */
import type { Config, Context } from '@netlify/functions';

import { createNetlifyHandler } from '../../src/netlify.js';

const handle = createNetlifyHandler();

export default (request: Request, context: Context): Promise<Response> => handle(request, context);

export const config: Config = {
  path: '/*',
  // Netlify reads this config without running the code, so the paths are written out: keep them
  // the same as `path` in auth.ts.
  excludedPath: ['/v1/auth/login', '/v1/auth/change-password'],
  preferStatic: true,
  // Enforced by Netlify before the function runs (429), so floods cost no function time.
  // Per IP; the app makes a handful of requests per screen.
  rateLimit: { windowLimit: 300, windowSize: 60, aggregateBy: ['ip', 'domain'] },
};
