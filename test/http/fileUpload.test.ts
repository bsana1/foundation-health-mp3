/**
 * POST /file-upload — the endpoint, end to end, over `app.inject()`.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { loadConfig } from '../../src/config.js';
import { buildApp } from '../../src/http/app.js';
import { SAMPLE_FRAME_COUNT, SAMPLE_MP3 } from '../helpers/sample.js';
import { makeFrames } from '../helpers/syntheticMp3.js';

interface ErrorResponse {
  error: { code: string; message: string };
}

const BOUNDARY = '----file-upload-test';

function filePart(
  bytes: Buffer,
  filename = 'audio.mp3',
): { payload: Buffer; headers: Record<string, string> } {
  const head = Buffer.from(
    `--${BOUNDARY}\r\n` +
      `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
      `Content-Type: audio/mpeg\r\n\r\n`,
  );
  return {
    payload: Buffer.concat([head, bytes, Buffer.from(`\r\n--${BOUNDARY}--\r\n`)]),
    headers: { 'content-type': `multipart/form-data; boundary=${BOUNDARY}` },
  };
}

function fieldOnly(): { payload: Buffer; headers: Record<string, string> } {
  return {
    payload: Buffer.from(
      `--${BOUNDARY}\r\nContent-Disposition: form-data; name="notafile"\r\n\r\nhello\r\n--${BOUNDARY}--\r\n`,
    ),
    headers: { 'content-type': `multipart/form-data; boundary=${BOUNDARY}` },
  };
}

function mpeg2Fixture(): Buffer {
  return readFileSync(
    fileURLToPath(new URL('../fixtures/corpus/generated/mpeg2-lsf-22050.mp3', import.meta.url)),
  );
}

describe('POST /file-upload', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp({ ...loadConfig(), logLevel: 'silent', maxUploadBytes: 16 * 1024 * 1024 });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns the frame count for the provided sample', async () => {
    const { payload, headers } = filePart(SAMPLE_MP3);
    const response = await app.inject({ method: 'POST', url: '/file-upload', payload, headers });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('application/json');
    expect(response.json()).toEqual({ frameCount: SAMPLE_FRAME_COUNT });
  });

  it('returns the frame count for a synthetic CBR stream', async () => {
    const { payload, headers } = filePart(makeFrames(120));
    const response = await app.inject({ method: 'POST', url: '/file-upload', payload, headers });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ frameCount: 120 });
  });

  it('415 when the request is not multipart/form-data', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/file-upload',
      payload: 'plain text',
      headers: { 'content-type': 'text/plain' },
    });

    expect(response.statusCode).toBe(415);
    const body = response.json<ErrorResponse>();
    expect(body.error.code).toBe('UNSUPPORTED_MEDIA_TYPE');
    expect(typeof body.error.message).toBe('string');
  });

  it('400 when there is no file part', async () => {
    const { payload, headers } = fieldOnly();
    const response = await app.inject({ method: 'POST', url: '/file-upload', payload, headers });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: { code: 'NO_FILE' } });
  });

  it('422 NOT_AN_MP3 for a non-MPEG upload', async () => {
    const { payload, headers } = filePart(Buffer.alloc(4096, 0x2a));
    const response = await app.inject({ method: 'POST', url: '/file-upload', payload, headers });

    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({ error: { code: 'NOT_AN_MP3' } });
  });

  it('422 UNSUPPORTED_MPEG_FORMAT for an MPEG-2 file', async () => {
    const { payload, headers } = filePart(mpeg2Fixture());
    const response = await app.inject({ method: 'POST', url: '/file-upload', payload, headers });

    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({ error: { code: 'UNSUPPORTED_MPEG_FORMAT' } });
  });

  it('every error response uses the { error: { code, message } } shape', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/file-upload',
      payload: 'x',
      headers: { 'content-type': 'text/plain' },
    });
    const body = response.json<ErrorResponse>();
    expect(Object.keys(body)).toEqual(['error']);
    expect(typeof body.error.code).toBe('string');
    expect(typeof body.error.message).toBe('string');
  });
});

describe('POST /file-upload — size limit', () => {
  it('413 when the upload exceeds MAX_UPLOAD_BYTES', async () => {
    const app = await buildApp({ ...loadConfig(), logLevel: 'silent', maxUploadBytes: 4096 });
    await app.ready();

    const { payload, headers } = filePart(makeFrames(200)); // ~83 KB > 4 KB
    const response = await app.inject({ method: 'POST', url: '/file-upload', payload, headers });

    expect(response.statusCode).toBe(413);
    expect(response.json()).toMatchObject({ error: { code: 'FILE_TOO_LARGE' } });
    await app.close();
  });
});
