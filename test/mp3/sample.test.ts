/**
 * Assertions against the real provided MP3, rather than synthetic frames — to
 * catch a parser that is self-consistently wrong (e.g. accepts a plausible but
 * invalid header shape that the encoder would never actually emit).
 */

import { Readable } from 'node:stream';

import { describe, expect, it } from 'vitest';

import { countMp3Frames } from '../../src/mp3/countMp3Frames.js';
import { parseFrameHeader } from '../../src/mp3/frameHeader.js';
import { id3v2TagSize } from '../../src/mp3/id3.js';
import { isVbrHeaderFrame } from '../../src/mp3/vbrHeader.js';
import { chunked } from '../helpers/syntheticMp3.js';
import { SAMPLE_FRAME_COUNT, SAMPLE_MP3 } from '../helpers/sample.js';

describe('provided sample file', () => {
  it('has a 44-byte ID3v2 tag', () => {
    // "ID3" v2.4, 10-byte header + 34-byte body — see docs/mp3-frame-structure.md §2
    expect(id3v2TagSize(SAMPLE_MP3)).toBe(44);
  });

  it('first real frame header decodes as documented', () => {
    const firstFrameOffset = id3v2TagSize(SAMPLE_MP3);
    const result = parseFrameHeader(SAMPLE_MP3, firstFrameOffset);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Bytes FF FB 50 00 — docs/mp3-frame-structure.md §3 worked example.
    expect(result.header).toEqual({
      bitrateKbps: 64,
      sampleRateHz: 44100,
      padded: false,
      channelMode: 'stereo',
      frameLength: 208,
      sideInfoOffset: 36,
    });
  });

  it('the byte at the computed next-frame offset is also a valid frame sync', () => {
    const firstFrameOffset = id3v2TagSize(SAMPLE_MP3);
    const first = parseFrameHeader(SAMPLE_MP3, firstFrameOffset);
    if (!first.ok) throw new Error('first frame did not parse');

    const secondOffset = firstFrameOffset + first.header.frameLength;
    expect(parseFrameHeader(SAMPLE_MP3, secondOffset).ok).toBe(true);
  });

  it('the first frame is a Xing metadata frame, not audio', () => {
    const firstFrameOffset = id3v2TagSize(SAMPLE_MP3);
    const first = parseFrameHeader(SAMPLE_MP3, firstFrameOffset);
    if (!first.ok) throw new Error('first frame did not parse');

    expect(isVbrHeaderFrame(SAMPLE_MP3, firstFrameOffset, first.header)).toBe(true);
  });

  it(`counts ${SAMPLE_FRAME_COUNT} frames — the value mediainfo and ffprobe report`, async () => {
    const result = await countMp3Frames(SAMPLE_MP3);

    expect(result.frameCount).toBe(SAMPLE_FRAME_COUNT);
    expect(result.hasVbrHeaderFrame).toBe(true);
    expect(result.resyncBytes).toBe(0);
    // 6089 * 1152 / 44100
    expect(result.durationSeconds).toBeCloseTo(159.06, 2);
  });

  it('gets the same count from a streamed read, at any chunk size', async () => {
    for (const chunkSize of [64, 511, 4096, 1 << 16]) {
      const result = await countMp3Frames(Readable.from(chunked(SAMPLE_MP3, chunkSize)));
      expect(result.frameCount).toBe(SAMPLE_FRAME_COUNT);
    }
  });
});
