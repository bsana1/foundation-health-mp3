/**
 * The scalability claim, as a test: streaming a large MP3 through
 * `countMp3Frames` must not grow memory in proportion to the input. Feeds
 * ~150 MB of frames as 64 KiB chunks that are never all held at once, and
 * asserts the process heap barely moves.
 *
 * Bounds are generous — this guards against a regression that starts buffering
 * the whole stream, not against small allocation changes.
 */

import { describe, expect, it } from 'vitest';

import { countMp3Frames } from '../../src/mp3/countMp3Frames.js';
import { frameChunks, frameLengthOf } from '../helpers/syntheticMp3.js';

const FRAME_COUNT = 375_000; // 375k * 417 B ≈ 150 MB streamed

describe('streaming memory', () => {
  it('counts ~150 MB of frames without heap growing with the input', async () => {
    const bytesStreamed = FRAME_COUNT * frameLengthOf({ bitrateKbps: 128 });

    global.gc?.();
    const before = process.memoryUsage().heapUsed;

    const result = await countMp3Frames(frameChunks(FRAME_COUNT, 64 * 1024, { bitrateKbps: 128 }));

    global.gc?.();
    const growth = process.memoryUsage().heapUsed - before;

    expect(result.frameCount).toBe(FRAME_COUNT);
    // Streamed ~150 MB; heap growth must be a tiny fraction of that.
    expect(bytesStreamed).toBeGreaterThan(140 * 1024 * 1024);
    expect(growth).toBeLessThan(20 * 1024 * 1024);
  });
});
