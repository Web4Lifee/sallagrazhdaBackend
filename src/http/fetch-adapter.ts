import type { FastifyInstance, InjectOptions } from 'fastify';

/** Headers about one connection, or recomputed from the body, that must not be copied across. */
const CONNECTION_HEADERS = new Set([
  'connection',
  'keep-alive',
  'transfer-encoding',
  'content-length',
  'upgrade',
]);
/** Responses with these statuses never have a body (the Response constructor rejects one). */
const NO_BODY_STATUSES = new Set([101, 204, 205, 304]);

/**
 * Answers a Fetch API Request with the Fastify app, without opening a port. For hosts that hand
 * over requests as Request objects (Netlify Functions) instead of HTTP connections.
 * `clientIp` becomes request.ip, which the rate limits use.
 */
export async function handleFetchRequest(
  app: FastifyInstance,
  request: Request,
  clientIp?: string,
): Promise<Response> {
  const url = new URL(request.url);
  const headers: Record<string, string> = {};
  request.headers.forEach((value, name) => {
    if (!CONNECTION_HEADERS.has(name)) headers[name] = value;
  });
  const body =
    request.method === 'GET' || request.method === 'HEAD'
      ? undefined
      : Buffer.from(await request.arrayBuffer());

  const res = await app.inject({
    method: request.method as InjectOptions['method'],
    url: url.pathname + url.search,
    headers,
    ...(body && body.length > 0 ? { payload: body } : {}),
    ...(clientIp ? { remoteAddress: clientIp } : {}),
  });

  const responseHeaders = new Headers();
  for (const [name, value] of Object.entries(res.headers)) {
    if (value === undefined || CONNECTION_HEADERS.has(name)) continue;
    for (const item of Array.isArray(value) ? value : [value]) responseHeaders.append(name, String(item));
  }
  const hasBody =
    res.rawPayload.length > 0 && !NO_BODY_STATUSES.has(res.statusCode) && request.method !== 'HEAD';
  return new Response(hasBody ? new Uint8Array(res.rawPayload) : null, {
    status: res.statusCode,
    headers: responseHeaders,
  });
}
