/**
 * Unknown routes and wrong methods use the same `{ error: { code, message } }`
 * shape as every other failure, not Fastify's default 404 body.
 */

import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { loadConfig } from '../../src/config.js';
import { buildApp } from '../../src/http/app.js';

describe('not found', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp({ ...loadConfig(), logLevel: 'silent' });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it.each([
    ['GET', '/nope'],
    ['GET', '/file-upload'], // wrong method for a real route
    ['DELETE', '/health'],
  ] as const)('%s %s → 404 in the error-body shape', async (method, url) => {
    const response = await app.inject({ method, url });
    const body = response.json<{ error: { code: string; message: string } }>();

    expect(response.statusCode).toBe(404);
    expect(body.error.code).toBe('NOT_FOUND');
    expect(body.error.message).toContain(url);
  });
});
