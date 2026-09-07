/**
 * Bootstrap smoke test for POST /file-upload: the endpoint accepts an MP3 upload
 * and answers with the response contract. Frame-counting correctness tests
 * arrive with the parser (see docs/TASKS.md).
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { loadConfig } from '../../src/config.js';
import { buildApp } from '../../src/http/app.js';

const SAMPLE = readFileSync(
  fileURLToPath(new URL('../fixtures/foundationhealth-sample-mp3.mp3', import.meta.url)),
);

function multipartBody(file: Buffer): { payload: Buffer; headers: Record<string, string> } {
  const boundary = '----file-upload-test-boundary';
  const head = Buffer.from(
    `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="file"; filename="audio.mp3"\r\n` +
      `Content-Type: audio/mpeg\r\n\r\n`,
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return {
    payload: Buffer.concat([head, file, tail]),
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  };
}

describe('POST /file-upload', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp({ ...loadConfig(), logLevel: 'silent' });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('accepts an MP3 and responds with the frameCount contract', async () => {
    const { payload, headers } = multipartBody(SAMPLE);
    const response = await app.inject({ method: 'POST', url: '/file-upload', payload, headers });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('application/json');
    // Stub value until the parser lands.
    expect(response.json()).toEqual({ frameCount: 0 });
  });

  it('rejects a request that is not multipart/form-data', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/file-upload',
      payload: 'not a file',
      headers: { 'content-type': 'text/plain' },
    });

    expect(response.statusCode).toBe(415);
  });
});
