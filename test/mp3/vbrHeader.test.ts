import { describe, expect, it } from 'vitest';

import { parseFrameHeader, type FrameHeader } from '../../src/mp3/frameHeader.js';
import { isVbrHeaderFrame } from '../../src/mp3/vbrHeader.js';
import { makeFrame } from '../helpers/syntheticMp3.js';

function headerOf(frame: Buffer): FrameHeader {
  const result = parseFrameHeader(frame, 0);
  if (!result.ok) throw new Error(`bad synthetic header: ${result.error}`);
  return result.header;
}

describe('isVbrHeaderFrame', () => {
  it('detects a Xing tag after the 32-byte stereo side-info block', () => {
    const frame = makeFrame({ bitrateKbps: 64, tag: 'Xing' });
    expect(isVbrHeaderFrame(frame, 0, headerOf(frame))).toBe(true);
  });

  it('detects an Info tag (same position as Xing)', () => {
    const frame = makeFrame({ tag: 'Info' });
    expect(isVbrHeaderFrame(frame, 0, headerOf(frame))).toBe(true);
  });

  it('detects a VBRI tag at the fixed +32 offset', () => {
    const frame = makeFrame({ tag: 'VBRI' });
    expect(isVbrHeaderFrame(frame, 0, headerOf(frame))).toBe(true);
  });

  it('finds a Xing tag at the mono side-info offset (+17)', () => {
    const frame = makeFrame({ channelMode: 'mono', tag: 'Xing' });
    expect(isVbrHeaderFrame(frame, 0, headerOf(frame))).toBe(true);
  });

  it('returns false for an ordinary audio frame', () => {
    const frame = makeFrame({ bitrateKbps: 128 });
    expect(isVbrHeaderFrame(frame, 0, headerOf(frame))).toBe(false);
  });

  it('does not mistake "Xing" bytes elsewhere in the body for the tag', () => {
    const frame = makeFrame({ bitrateKbps: 128 });
    frame.write('Xing', 100, 'ascii'); // not at the side-info offset
    expect(isVbrHeaderFrame(frame, 0, headerOf(frame))).toBe(false);
  });

  it('resolves the tag position relative to frameStart', () => {
    const frame = makeFrame({ tag: 'Xing' });
    const buf = Buffer.concat([Buffer.alloc(50), frame]);
    expect(isVbrHeaderFrame(buf, 50, headerOf(frame))).toBe(true);
    expect(isVbrHeaderFrame(buf, 0, headerOf(frame))).toBe(false);
  });

  it('returns false when the tag position is past the end of the buffer', () => {
    const frame = makeFrame({ bitrateKbps: 128, tag: 'Xing' });
    expect(isVbrHeaderFrame(frame.subarray(0, 20), 0, headerOf(frame))).toBe(false);
  });
});
