import Fastify from 'fastify';
import { afterAll, describe, expect, it } from 'vitest';

import { handleFetchRequest } from '../src/http/fetch-adapter.js';

const app = Fastify();
app.post('/echo', async (request, reply) =>
  reply
    .header('set-cookie', ['a=1', 'b=2'])
    .send({ body: request.body, ip: request.ip, query: request.query }),
);
app.delete('/thing', async (_request, reply) => reply.status(204).send());
app.get('/hello', async () => ({ hello: 'world' }));

afterAll(() => app.close());

describe('handleFetchRequest (Netlify Functions)', () => {
  it('passes method, path, query, JSON body and client IP to Fastify', async () => {
    const res = await handleFetchRequest(
      app,
      new Request('https://api.example.com/echo?x=1', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Ëlira' }),
      }),
      '203.0.113.7',
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(res.headers.getSetCookie()).toEqual(['a=1', 'b=2']);
    expect(await res.json()).toEqual({ body: { name: 'Ëlira' }, ip: '203.0.113.7', query: { x: '1' } });
  });

  it('answers 204 and HEAD without a body', async () => {
    const deleted = await handleFetchRequest(
      app,
      new Request('https://api.example.com/thing', { method: 'DELETE' }),
    );
    expect(deleted.status).toBe(204);
    expect(deleted.body).toBeNull();

    const head = await handleFetchRequest(
      app,
      new Request('https://api.example.com/hello', { method: 'HEAD' }),
    );
    expect(head.status).toBe(200);
    expect(head.body).toBeNull();
  });

  it('returns Fastify 404s for unknown paths', async () => {
    const res = await handleFetchRequest(app, new Request('https://api.example.com/nope'));
    expect(res.status).toBe(404);
  });
});
