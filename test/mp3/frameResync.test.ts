import { describe, expect, it } from 'vitest';

import { HEADER_BYTES } from '../../src/mp3/frameHeaderConsts.js';
import { findNextFrameHeader, resyncResumeOffset } from '../../src/mp3/frameResync.js';
import { makeFrame, makeFrames } from '../helpers/syntheticMp3.js';

describe('findNextFrameHeader', () => {
  it('finds a header embedded in a run of garbage', () => {
    const frame = makeFrame({ bitrateKbps: 128 });
    const buf = Buffer.concat([Buffer.alloc(500, 0x00), frame]);
    expect(findNextFrameHeader(buf, 0)).toBe(500);
  });

  it('returns -1 when there is no header', () => {
    expect(findNextFrameHeader(Buffer.alloc(2000, 0x11), 0)).toBe(-1);
  });

  it('searches strictly after `from`, skipping a header sitting exactly at `from`', () => {
    const buf = makeFrames(3, { bitrateKbps: 128 }); // each frame is 417 bytes
    expect(findNextFrameHeader(buf, 0)).toBe(417);
    expect(findNextFrameHeader(buf, 417)).toBe(834);
  });

  it('ignores 0xFF bytes that are not a valid header', () => {
    const frame = makeFrame({ bitrateKbps: 128 });
    const buf = Buffer.concat([Buffer.from([0xff, 0x00, 0xff, 0x01, 0xff, 0xff]), frame]);
    expect(findNextFrameHeader(buf, 0)).toBe(6);
  });

  it('finds a header that ends exactly at the buffer end', () => {
    const frame = makeFrame({ bitrateKbps: 128 });
    const buf = Buffer.concat([Buffer.alloc(10, 0x00), frame.subarray(0, HEADER_BYTES)]);
    expect(findNextFrameHeader(buf, 0)).toBe(10);
  });

  it('does not report a partial header in the last 3 bytes', () => {
    // 0xFF FB 90 with no 4th byte — not enough to parse
    const buf = Buffer.concat([Buffer.alloc(10, 0x00), Buffer.from([0xff, 0xfb, 0x90])]);
    expect(findNextFrameHeader(buf, 0)).toBe(-1);
  });

  it('returns -1 when `from` is at or past the end', () => {
    const buf = makeFrames(2);
    expect(findNextFrameHeader(buf, buf.length)).toBe(-1);
    expect(findNextFrameHeader(buf, buf.length + 100)).toBe(-1);
  });

  it('clamps a negative `from` to the start of the buffer (defensive; never happens in practice)', () => {
    const buf = makeFrames(1); // one header, at offset 0
    expect(findNextFrameHeader(buf, -5)).toBe(0);
  });
});

describe('resyncResumeOffset', () => {
  it('returns the recovered header offset when one was found', () => {
    expect(resyncResumeOffset(42, 1000, false)).toBe(42);
    expect(resyncResumeOffset(0, 1000, true)).toBe(0);
  });

  it('consumes the whole buffer at end of stream when nothing was found', () => {
    expect(resyncResumeOffset(-1, 1000, true)).toBe(1000);
  });

  it('leaves the last HEADER_BYTES-1 bytes mid-stream when nothing was found', () => {
    expect(resyncResumeOffset(-1, 1000, false)).toBe(1000 - (HEADER_BYTES - 1));
  });
});
