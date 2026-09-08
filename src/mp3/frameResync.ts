/**
 * Recovering position after a malformed frame header — a spliced, truncated or
 * bit-rotted file. The normal walk never scans; it steps by frame length. These
 * pure helpers are only used by the frame counter's resync path, and are kept
 * out of it so they can be tested directly.
 */

import { parseFrameHeader } from './frameHeader.js';
import { HEADER_BYTES } from './frameHeaderConsts.js';

/**
 * The offset of the first valid MPEG-1 Layer III frame header in `buf` strictly
 * after `from`, or -1 if there is none within `buf`. The `0xFF` fast-path filter
 * keeps this cheap over long runs of non-frame bytes.
 */
export function findNextFrameHeader(buf: Buffer, from: number): number {
  const lastStart = buf.length - HEADER_BYTES;
  for (let offset = Math.max(0, from + 1); offset <= lastStart; offset += 1) {
    if (buf[offset] === 0xff && parseFrameHeader(buf, offset).ok) {
      return offset;
    }
  }
  return -1;
}

/**
 * Where the walk should resume after a malformed header, given the result of
 * {@link findNextFrameHeader} over a buffer of `bufferLength` bytes:
 *
 * - a recovered header, if one was found;
 * - otherwise the whole buffer is unreadable — consume all of it at end of
 *   stream, or all but the last `HEADER_BYTES - 1` bytes mid-stream, in case a
 *   frame sync straddles the next chunk boundary.
 */
export function resyncResumeOffset(found: number, bufferLength: number, atEof: boolean): number {
  if (found !== -1) return found;
  return atEof ? bufferLength : bufferLength - (HEADER_BYTES - 1);
}
