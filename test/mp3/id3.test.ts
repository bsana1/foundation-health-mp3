import { describe, expect, it } from 'vitest';

import { ID3V2_MIN_BYTES, id3v2TagSize } from '../../src/mp3/id3.js';
import { makeHeader, makeId3v2 } from '../helpers/syntheticMp3.js';

describe('id3v2TagSize', () => {
  it('returns 0 when the buffer does not start with "ID3"', () => {
    expect(id3v2TagSize(makeHeader())).toBe(0); // an MPEG frame header
    expect(id3v2TagSize(Buffer.alloc(64))).toBe(0);
  });

  it('returns 0 when fewer than the minimum bytes are available', () => {
    expect(ID3V2_MIN_BYTES).toBe(10);
    expect(id3v2TagSize(Buffer.from('ID3'))).toBe(0);
    expect(id3v2TagSize(makeId3v2(34).subarray(0, 9))).toBe(0);
  });

  it('decodes the synchsafe body size and adds the 10-byte header', () => {
    expect(id3v2TagSize(makeId3v2(34))).toBe(44); // matches the provided sample
  });

  it('handles body sizes that span multiple synchsafe bytes', () => {
    for (const body of [0, 1, 127, 128, 200, 5000, 2_097_151, 2_097_152]) {
      expect(id3v2TagSize(makeId3v2(body))).toBe(10 + body);
    }
  });

  it('adds another 10 bytes when the footer flag is set', () => {
    expect(id3v2TagSize(makeId3v2(34, { footer: true }))).toBe(54);
  });

  it('masks stray high bits in the size field', () => {
    const tag = makeId3v2(34);
    tag[6] = 0x80; // top bit set — should be ignored, not read as bit 28
    tag[7] = 0x80;
    tag[8] = 0x80;
    tag[9] = 0x80 | 34;
    expect(id3v2TagSize(tag)).toBe(44);
  });

  it('only inspects offset 0 — a tag later in the buffer is not counted', () => {
    const buf = Buffer.concat([makeHeader(), makeId3v2(34)]);
    expect(id3v2TagSize(buf)).toBe(0);
  });
});
