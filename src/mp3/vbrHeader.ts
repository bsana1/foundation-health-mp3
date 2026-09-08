/**
 * Detection of the VBR/CBR *header frame*.
 *
 * The first frame of almost every MP3 is a structurally valid MPEG-1 Layer III
 * frame that carries a metadata tag — `"Xing"`, `"Info"`, or `"VBRI"` — in
 * place of audio (total frame count, byte count, seek table). Decoders discard
 * it and `mediainfo` / `ffprobe` do not count it, so neither does the frame
 * counter. See `docs/mp3-frame-structure.md` §8.
 */

import type { FrameHeader } from './frameHeader.js';
import { INFO_TAG, VBRI_TAG, VBRI_TAG_OFFSET, XING_TAG } from './vbrHeaderConsts.js';

/**
 * Whether the frame starting at `buf[frameStart]` (already parsed as `header`)
 * holds a Xing/Info/VBRI tag rather than audio.
 *
 * The whole frame need not be buffered: if a tag position lies past the end of
 * `buf`, that tag is simply treated as absent.
 */
export function isVbrHeaderFrame(buf: Buffer, frameStart: number, header: FrameHeader): boolean {
  const xingOrInfoAt = frameStart + header.sideInfoOffset;
  return (
    hasAsciiAt(buf, xingOrInfoAt, XING_TAG) ||
    hasAsciiAt(buf, xingOrInfoAt, INFO_TAG) ||
    hasAsciiAt(buf, frameStart + VBRI_TAG_OFFSET, VBRI_TAG)
  );
}

function hasAsciiAt(buf: Buffer, at: number, tag: string): boolean {
  return (
    at >= 0 && at + tag.length <= buf.length && buf.toString('ascii', at, at + tag.length) === tag
  );
}
