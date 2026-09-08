import { Readable } from 'node:stream';

import { describe, expect, it } from 'vitest';

import { countMp3Frames } from '../../src/mp3/countMp3Frames.js';
import {
  CorruptStreamError,
  NotAnMp3Error,
  UnsupportedMpegFormatError,
} from '../../src/mp3/errors.js';
import { Mp3FrameCounter, type FrameCounterOptions } from '../../src/mp3/frameCounter.js';
import { chunked, makeFrame, makeFrames, makeId3v1, makeId3v2 } from '../helpers/syntheticMp3.js';

/** Count `input`, optionally fed in fixed-size chunks. */
function count(
  input: Buffer,
  { chunkSize, ...options }: FrameCounterOptions & { chunkSize?: number } = {},
): Promise<number> {
  const source = chunkSize === undefined ? input : chunked(input, chunkSize);
  return countMp3Frames(source, options).then((r) => r.frameCount);
}

describe('countMp3Frames', () => {
  it('counts a plain run of CBR frames', async () => {
    expect(await count(makeFrames(100))).toBe(100);
  });

  it('gives the same count no matter the chunk size', async () => {
    const stream = makeFrames(250);
    for (const chunkSize of [1, 2, 7, 63, 64, 417, 1000, 65536]) {
      expect(await count(stream, { chunkSize })).toBe(250);
    }
  });

  it('accepts a Buffer, an array of chunks, or an async stream', async () => {
    const stream = makeFrames(40);
    expect((await countMp3Frames(stream)).frameCount).toBe(40);
    expect((await countMp3Frames(chunked(stream, 100))).frameCount).toBe(40);
    expect((await countMp3Frames(Readable.from(chunked(stream, 100)))).frameCount).toBe(40);
  });

  it('counts a VBR stream by measuring each frame from its own header', async () => {
    const stream = Buffer.concat([
      makeFrames(10, { bitrateKbps: 128 }),
      makeFrames(10, { bitrateKbps: 192 }),
      makeFrames(10, { bitrateKbps: 320, padded: true }),
      makeFrames(10, { bitrateKbps: 32 }),
    ]);
    expect(await count(stream)).toBe(40);
    expect(await count(stream, { chunkSize: 13 })).toBe(40);
  });

  describe('ID3 tags', () => {
    it('skips a leading ID3v2 tag', async () => {
      const stream = Buffer.concat([makeId3v2(500), makeFrames(30)]);
      expect(await count(stream)).toBe(30);
    });

    it('skips a large ID3v2 tag split across small chunks', async () => {
      const stream = Buffer.concat([makeId3v2(200_000), makeFrames(20)]);
      expect(await count(stream, { chunkSize: 4096 })).toBe(20);
      expect(await count(stream, { chunkSize: 3 })).toBe(20);
    });

    it('skips an ID3v2 tag that carries a footer', async () => {
      const stream = Buffer.concat([makeId3v2(120, { footer: true }), makeFrames(15)]);
      expect(await count(stream)).toBe(15);
    });

    it('measures the tag even when the 10-byte header dribbles in one byte at a time', async () => {
      // exercises skipId3's "fewer than ID3V2_MIN_BYTES buffered, wait" path
      const stream = Buffer.concat([makeId3v2(40), makeFrames(12)]);
      expect(await count(stream, { chunkSize: 1 })).toBe(12);
    });

    it('handles a chunk boundary that falls inside the ID3 size field', () => {
      const tag = makeId3v2(60);
      const counter = new Mp3FrameCounter();
      counter.push(Buffer.from(tag.subarray(0, 8))); // mid-header, before the last size byte
      counter.push(Buffer.concat([tag.subarray(8), makeFrames(8)]));
      expect(counter.end().frameCount).toBe(8);
    });

    it('rejects input that is only a truncated ID3 header', async () => {
      await expect(countMp3Frames(Buffer.from('ID3\x04\x00\x00'))).rejects.toBeInstanceOf(
        NotAnMp3Error,
      );
    });

    it('rejects an ID3 tag whose declared size exceeds the input', async () => {
      const stream = Buffer.concat([makeId3v2(50_000), makeFrames(5)]).subarray(0, 400);
      await expect(countMp3Frames(stream)).rejects.toBeInstanceOf(NotAnMp3Error);
    });

    it('ignores a trailing ID3v1 tag', async () => {
      expect(await count(Buffer.concat([makeFrames(25), makeId3v1()]))).toBe(25);
    });

    it('ignores arbitrary trailing bytes', async () => {
      expect(await count(Buffer.concat([makeFrames(25), Buffer.alloc(777, 0x77)]))).toBe(25);
    });
  });

  describe('the metadata (Xing/Info/VBRI) frame', () => {
    it('is excluded from the count', async () => {
      const stream = Buffer.concat([
        makeFrame({ bitrateKbps: 64, tag: 'Xing' }),
        makeFrames(500, { bitrateKbps: 160 }),
      ]);
      const result = await countMp3Frames(stream);
      expect(result.frameCount).toBe(500);
      expect(result.hasVbrHeaderFrame).toBe(true);
    });

    it('is detected as Info and as VBRI too', async () => {
      for (const tag of ['Info', 'VBRI'] as const) {
        const stream = Buffer.concat([makeFrame({ tag }), makeFrames(12)]);
        const result = await countMp3Frames(stream);
        expect(result.frameCount).toBe(12);
        expect(result.hasVbrHeaderFrame).toBe(true);
      }
    });

    it('is still found when the first frame straddles chunk boundaries', async () => {
      const stream = Buffer.concat([makeFrame({ bitrateKbps: 64, tag: 'Xing' }), makeFrames(50)]);
      expect(await count(stream, { chunkSize: 5 })).toBe(50);
    });

    it('counts every frame when there is no metadata frame', async () => {
      const result = await countMp3Frames(makeFrames(75));
      expect(result.frameCount).toBe(75);
      expect(result.hasVbrHeaderFrame).toBe(false);
    });
  });

  describe('partial and malformed input', () => {
    it('counts a truncated final frame once', async () => {
      const full = makeFrames(10);
      expect(await count(full.subarray(0, full.length - 40))).toBe(10);
    });

    it('rejects input that is not MPEG audio', async () => {
      await expect(countMp3Frames(Buffer.alloc(8192, 0x42))).rejects.toBeInstanceOf(NotAnMp3Error);
    });

    it('rejects an empty stream', async () => {
      await expect(countMp3Frames(Buffer.alloc(0))).rejects.toBeInstanceOf(NotAnMp3Error);
    });

    it('rejects a first frame that is a different MPEG format', async () => {
      // FF FD = MPEG-1, Layer II
      const layer2 = Buffer.concat([Buffer.from([0xff, 0xfd, 0x90, 0x00]), Buffer.alloc(600)]);
      await expect(countMp3Frames(layer2)).rejects.toBeInstanceOf(UnsupportedMpegFormatError);
    });

    it('resynchronises across a run of garbage between valid frames', async () => {
      const stream = Buffer.concat([makeFrames(5), Buffer.alloc(400, 0x00), makeFrames(5)]);
      const result = await countMp3Frames(stream);
      expect(result.frameCount).toBe(10);
      expect(result.resyncBytes).toBeGreaterThanOrEqual(400);
    });

    it('resynchronises the same way when fed in small chunks', async () => {
      const stream = Buffer.concat([makeFrames(5), Buffer.alloc(400, 0x00), makeFrames(5)]);
      expect(await count(stream, { chunkSize: 17 })).toBe(10);
    });

    it('gives up with CorruptStreamError when garbage exceeds the resync budget', async () => {
      const stream = Buffer.concat([makeFrames(3), Buffer.alloc(5000, 0x00), makeFrames(3)]);
      await expect(countMp3Frames(stream, { maxResyncBytes: 1024 })).rejects.toBeInstanceOf(
        CorruptStreamError,
      );
      await expect(
        countMp3Frames(chunked(stream, 128), { maxResyncBytes: 1024 }),
      ).rejects.toBeInstanceOf(CorruptStreamError);
    });
  });

  describe('Mp3FrameCounter lifecycle', () => {
    it('rejects push() after end() and a second end()', () => {
      const counter = new Mp3FrameCounter();
      counter.push(makeFrames(1));
      counter.end();
      expect(() => counter.push(makeFrames(1))).toThrow();
      expect(() => counter.end()).toThrow();
    });

    it('ignores empty pushes', () => {
      const counter = new Mp3FrameCounter();
      counter.push(Buffer.alloc(0));
      counter.push(makeFrames(3));
      counter.push(Buffer.alloc(0));
      expect(counter.end().frameCount).toBe(3);
    });
  });
});
