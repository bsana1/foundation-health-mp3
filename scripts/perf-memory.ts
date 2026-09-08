/**
 * Demonstrates that `countMp3Frames` runs in constant memory regardless of file
 * size — the basis of the "handles large files" claim.
 *
 *   npx tsx scripts/perf-memory.ts            # stream ~1 GB through the counter directly
 *   npx tsx scripts/perf-memory.ts 4          # ~4 GB
 *   npx tsx scripts/perf-memory.ts 1 --http   # same, but through POST /file-upload
 *
 * Reports peak RSS growth vs bytes streamed, and throughput. Add
 * `node --expose-gc` (via `NODE_OPTIONS`) for tighter numbers.
 */

import { performance } from 'node:perf_hooks';
import { Readable } from 'node:stream';

import { loadConfig } from '../src/config.js';
import { buildApp } from '../src/http/app.js';
import { countMp3Frames } from '../src/mp3/countMp3Frames.js';
import { frameChunks, frameLengthOf } from '../test/helpers/syntheticMp3.js';

const gib = 1024 ** 3;
const mib = 1024 ** 2;

function rssMib(): number {
  return process.memoryUsage().rss / mib;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const gigabytes = Number(args.find((a) => !a.startsWith('--')) ?? '1');
  const http = args.includes('--http');

  const frameBytes = frameLengthOf({ bitrateKbps: 128 });
  const frameCount = Math.floor((gigabytes * gib) / frameBytes);
  const streamedBytes = frameCount * frameBytes;

  console.log(
    `streaming ${(streamedBytes / gib).toFixed(2)} GB (${frameCount.toLocaleString()} frames, 64 KiB chunks) ` +
      `through ${http ? 'POST /file-upload' : 'countMp3Frames'}\n`,
  );

  const source = (): Generator<Buffer> => frameChunks(frameCount, 64 * 1024, { bitrateKbps: 128 });

  const baseRss = rssMib();
  let peakRss = baseRss;
  const sampler = setInterval(() => {
    peakRss = Math.max(peakRss, rssMib());
  }, 5);
  sampler.unref();

  const start = performance.now();
  let counted: number;

  if (http) {
    const app = await buildApp({
      ...loadConfig(),
      logLevel: 'silent',
      maxUploadBytes: streamedBytes + mib,
    });
    await app.ready();
    const boundary = 'perf-boundary';
    const head = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="big.mp3"\r\n` +
        `Content-Type: audio/mpeg\r\n\r\n`,
    );
    const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
    function* body(): Generator<Buffer> {
      yield head;
      yield* source();
      yield tail;
    }
    const response = await app.inject({
      method: 'POST',
      url: '/file-upload',
      payload: Readable.from(body()),
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
    });
    const parsed = response.json<{ frameCount?: number }>();
    if (parsed.frameCount === undefined) {
      console.error(`HTTP ${response.statusCode}:`, response.body);
      process.exit(1);
    }
    counted = parsed.frameCount;
    await app.close();
  } else {
    counted = (await countMp3Frames(source())).frameCount;
  }

  const seconds = (performance.now() - start) / 1000;
  clearInterval(sampler);
  global.gc?.();
  const endRss = rssMib();

  console.log(
    `frames counted:   ${counted.toLocaleString()}  (expected ${frameCount.toLocaleString()})`,
  );
  console.log(
    `throughput:       ${(streamedBytes / mib / seconds).toFixed(0)} MB/s  (${seconds.toFixed(1)} s)`,
  );
  console.log(`RSS baseline:     ${baseRss.toFixed(0)} MB`);
  console.log(
    `RSS peak:         ${peakRss.toFixed(0)} MB   (+${(peakRss - baseRss).toFixed(0)} MB)`,
  );
  console.log(`RSS after + gc:   ${endRss.toFixed(0)} MB`);
  console.log(
    `\npeak growth is ${(((peakRss - baseRss) / (streamedBytes / mib)) * 100).toFixed(2)}% of the ` +
      `${(streamedBytes / gib).toFixed(1)} GB streamed`,
  );

  if (counted !== frameCount) {
    console.error('\nFAIL: frame count mismatch');
    process.exit(1);
  }
}

void main();
