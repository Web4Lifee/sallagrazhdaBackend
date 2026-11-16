/**
 * The whole API as one Netlify Function: every request that isn't a static file from public/
 * goes to the Fastify app. See src/netlify.ts and docs/NETLIFY.md.
 */
import type { Config, Context } from '@netlify/functions';

import { createNetlifyHandler } from '../../src/netlify.js';

const handle = createNetlifyHandler();

export default (request: Request, context: Context): Promise<Response> => handle(request, context);

export const config: Config = {
  path: '/*',
  preferStatic: true,
};
