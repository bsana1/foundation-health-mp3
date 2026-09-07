import { describe, expect, it } from 'vitest';

import { parseFrameHeader } from '../../src/mp3/frameHeader.js';
import { HEADER_BYTES, SAMPLES_PER_FRAME } from '../../src/mp3/frameHeaderConsts.js';
import { makeHeader } from '../helpers/syntheticMp3.js';

/** Fail the test if the parse did not succeed, and narrow the type. */
function expectOk(result: ReturnType<typeof parseFrameHeader>) {
  if (!result.ok) {
    throw new Error(`expected a valid header, got error: ${result.error}`);
  }
  return result.header;
}

describe('parseFrameHeader', () => {
  it('parses a 128 kbps / 44100 Hz stereo header', () => {
    const header = expectOk(parseFrameHeader(makeHeader({ bitrateKbps: 128 }), 0));
    expect(header).toEqual({
      bitrateKbps: 128,
      sampleRateHz: 44100,
      padded: false,
      channelMode: 'stereo',
      frameLength: 417, // floor(144 * 128000 / 44100)
      sideInfoOffset: 36, // 4 + 32
    });
  });

  it('computes the 64 kbps frame length (matches the documented example)', () => {
    const header = expectOk(parseFrameHeader(makeHeader({ bitrateKbps: 64 }), 0));
    expect(header.frameLength).toBe(208); // floor(144 * 64000 / 44100)
  });

  it('handles every MPEG-1 Layer III bitrate and sample rate', () => {
    for (const bitrateKbps of [32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320]) {
      for (const sampleRateHz of [44100, 48000, 32000]) {
        const header = expectOk(parseFrameHeader(makeHeader({ bitrateKbps, sampleRateHz }), 0));
        expect(header.bitrateKbps).toBe(bitrateKbps);
        expect(header.sampleRateHz).toBe(sampleRateHz);
        expect(header.frameLength).toBe(Math.floor((144 * bitrateKbps * 1000) / sampleRateHz));
      }
    }
  });

  it('adds one byte when the padding bit is set', () => {
    const unpadded = expectOk(parseFrameHeader(makeHeader({ padded: false }), 0));
    const padded = expectOk(parseFrameHeader(makeHeader({ padded: true }), 0));
    expect(padded.padded).toBe(true);
    expect(padded.frameLength).toBe(unpadded.frameLength + 1);
  });

  it('uses a 17-byte side-info block for mono and 32 otherwise', () => {
    const mono = expectOk(parseFrameHeader(makeHeader({ channelMode: 'mono' }), 0));
    const joint = expectOk(parseFrameHeader(makeHeader({ channelMode: 'joint-stereo' }), 0));
    expect(mono.channelMode).toBe('mono');
    expect(mono.sideInfoOffset).toBe(HEADER_BYTES + 17);
    expect(joint.channelMode).toBe('joint-stereo');
    expect(joint.sideInfoOffset).toBe(HEADER_BYTES + 32);
  });

  it('parses a header at a non-zero offset', () => {
    const buf = Buffer.concat([Buffer.from([0x00, 0x11, 0x22]), makeHeader()]);
    expect(parseFrameHeader(buf, 3).ok).toBe(true);
  });

  it('exposes the format constants', () => {
    expect(HEADER_BYTES).toBe(4);
    expect(SAMPLES_PER_FRAME).toBe(1152);
  });

  describe('rejections', () => {
    const cases: ReadonlyArray<[string, number[], string]> = [
      ['no sync bits', [0x00, 0x00, 0x00, 0x00], 'no-sync'],
      ['broken sync in byte 1', [0xff, 0x1f, 0x90, 0x00], 'no-sync'],
      ['MPEG Version 2', [0xff, 0xf3, 0x90, 0x00], 'not-mpeg-version-1'],
      ['reserved MPEG version', [0xff, 0xeb, 0x90, 0x00], 'not-mpeg-version-1'],
      ['Layer II', [0xff, 0xfd, 0x90, 0x00], 'not-layer-3'],
      ['reserved layer', [0xff, 0xf9, 0x90, 0x00], 'not-layer-3'],
      ['free-format bitrate (index 0)', [0xff, 0xfb, 0x00, 0x00], 'free-format-bitrate'],
      ['reserved bitrate (index 15)', [0xff, 0xfb, 0xf0, 0x00], 'reserved-bitrate'],
      ['reserved sample rate (index 3)', [0xff, 0xfb, 0x9c, 0x00], 'reserved-sample-rate'],
    ];

    it.each(cases)('rejects %s', (_name, bytes, error) => {
      expect(parseFrameHeader(Buffer.from(bytes), 0)).toEqual({ ok: false, error });
    });

    it('rejects a buffer shorter than 4 bytes', () => {
      expect(parseFrameHeader(Buffer.from([0xff, 0xfb]), 0)).toEqual({
        ok: false,
        error: 'no-sync',
      });
    });
  });
});
