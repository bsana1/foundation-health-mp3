/**
 * The endpoint under concurrent load: many overlapping uploads — different
 * files, different sizes, some that must fail — every response must be correct
 * for *its own* request, with no count or error bleeding between them.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { loadConfig } from '../../src/config.js';
import { buildApp } from '../../src/http/app.js';
import { SAMPLE_FRAME_COUNT, SAMPLE_MP3 } from '../helpers/sample.js';
import { makeFrame, makeFrames } from '../helpers/syntheticMp3.js';

const BOUNDARY = '----concurrency-test';

function multipart(bytes: Buffer): { payload: Buffer; headers: Record<string, string> } {
  return {
    payload: Buffer.concat([
      Buffer.from(
        `--${BOUNDARY}\r\nContent-Disposition: form-data; name="file"; filename="a.mp3"\r\n` +
          `Content-Type: audio/mpeg\r\n\r\n`,
      ),
      bytes,
      Buffer.from(`\r\n--${BOUNDARY}--\r\n`),
    ]),
    headers: { 'content-type': `multipart/form-data; boundary=${BOUNDARY}` },
  };
}

interface Case {
  readonly name: string;
  readonly bytes: Buffer;
  readonly expect: { status: 200; frameCount: number } | { status: 422; code: string };
}

const xingThenAudio = Buffer.concat([
  (() => {
    const f = makeFrame({ bitrateKbps: 64 });
    f.write('Xing', 4 + 32, 'ascii');
    return f;
  })(),
  makeFrames(200, { bitrateKbps: 160 }),
]);

const CASES: readonly Case[] = [
  { name: 'sample', bytes: SAMPLE_MP3, expect: { status: 200, frameCount: SAMPLE_FRAME_COUNT } },
  { name: 'cbr-50', bytes: makeFrames(50), expect: { status: 200, frameCount: 50 } },
  { name: 'cbr-137', bytes: makeFrames(137), expect: { status: 200, frameCount: 137 } },
  { name: 'cbr-901', bytes: makeFrames(901), expect: { status: 200, frameCount: 901 } },
  {
    name: 'mono-64',
    bytes: makeFrames(64, { channelMode: 'mono' }),
    expect: { status: 200, frameCount: 64 },
  },
  { name: 'xing+200', bytes: xingThenAudio, expect: { status: 200, frameCount: 200 } },
  { name: 'garbage', bytes: Buffer.alloc(4096, 0x2a), expect: { status: 422, code: 'NOT_AN_MP3' } },
  {
    name: 'mpeg2',
    bytes: readFileSync(
      fileURLToPath(new URL('../fixtures/corpus/generated/mpeg2-lsf-22050.mp3', import.meta.url)),
    ),
    expect: { status: 422, code: 'UNSUPPORTED_MPEG_FORMAT' },
  },
];

describe('POST /file-upload under concurrency', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp({ ...loadConfig(), logLevel: 'silent', maxUploadBytes: 8 * 1024 * 1024 });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('serves 48 overlapping requests, each with its own correct result', async () => {
    // 6 copies of the cases, shuffled, all in flight at once.
    const jobs = Array.from({ length: 6 }, () => CASES)
      .flat()
      .sort(() => Math.random() - 0.5);

    const results = await Promise.all(
      jobs.map(async (c) => {
        const { payload, headers } = multipart(c.bytes);
        const response = await app.inject({
          method: 'POST',
          url: '/file-upload',
          payload,
          headers,
        });
        return { c, response };
      }),
    );

    for (const { c, response } of results) {
      const body = response.json<{ frameCount?: number; error?: { code: string } }>();
      if (c.expect.status === 200) {
        expect(response.statusCode, c.name).toBe(200);
        expect(body.frameCount, c.name).toBe(c.expect.frameCount);
      } else {
        expect(response.statusCode, c.name).toBe(422);
        expect(body.error?.code, c.name).toBe(c.expect.code);
      }
    }
  });

  it('returns the same count for many concurrent uploads of the same file', async () => {
    const { payload, headers } = multipart(SAMPLE_MP3);
    const responses = await Promise.all(
      Array.from({ length: 24 }, () =>
        app.inject({ method: 'POST', url: '/file-upload', payload, headers }),
      ),
    );
    for (const response of responses) {
      expect(response.statusCode).toBe(200);
      expect(response.json<{ frameCount: number }>().frameCount).toBe(SAMPLE_FRAME_COUNT);
    }
  });
});
