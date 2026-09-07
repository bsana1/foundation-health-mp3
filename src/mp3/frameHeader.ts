/**
 * Parsing and validation of a single MPEG-1 Audio Layer III frame header.
 *
 * Only MPEG Version 1, Layer III is supported (see `docs/requirements.md`).
 * Other MPEG versions and layers are recognised just far enough to reject them
 * with a specific reason. The bit layout, the lookup tables and the
 * frame-length formula are documented in `docs/mp3-frame-structure.md` §3–§5;
 * the tables and constants live in `./frameHeaderConsts.ts`.
 */

import {
  BITRATE_KBPS_BY_INDEX,
  CHANNEL_MODES,
  FRAME_LENGTH_COEFFICIENT,
  HEADER_BYTES,
  SAMPLE_RATE_HZ_BY_INDEX,
  SIDE_INFO_BYTES_MONO,
  SIDE_INFO_BYTES_OTHER,
} from './frameHeaderConsts.js';

/** Channel mode, from the 2 bits `I` of the header (byte 3, bits 7–6). */
export type ChannelMode = (typeof CHANNEL_MODES)[number];

/** A validated MPEG-1 Layer III frame header. */
export interface FrameHeader {
  /** Bitrate in kbit/s, from the bitrate-index table. */
  readonly bitrateKbps: number;
  /** Sample rate in Hz, from the sample-rate-index table. */
  readonly sampleRateHz: number;
  /** Whether the padding bit is set — it adds one byte to `frameLength`. */
  readonly padded: boolean;
  readonly channelMode: ChannelMode;
  /** Total frame size in bytes, including this 4-byte header. */
  readonly frameLength: number;
  /**
   * Offset from the start of the frame to the side-information block — where a
   * Xing/Info tag sits when this is a VBR header frame.
   */
  readonly sideInfoOffset: number;
}

/** Why 4 bytes are not a usable MPEG-1 Layer III header. */
export type HeaderParseError =
  | 'no-sync'
  | 'not-mpeg-version-1'
  | 'not-layer-3'
  | 'free-format-bitrate'
  | 'reserved-bitrate'
  | 'reserved-sample-rate';

/**
 * The result of {@link parseFrameHeader}. A discriminated union rather than an
 * exception: during a stream walk a failed parse is expected control flow
 * (resynchronisation), not an error.
 */
export type HeaderParseResult =
  | { readonly ok: true; readonly header: FrameHeader }
  | { readonly ok: false; readonly error: HeaderParseError };

/**
 * Parse the 4 bytes at `buf[offset]` as an MPEG-1 Layer III frame header.
 *
 * Safe to call when fewer than {@link HEADER_BYTES} bytes are available at
 * `offset` — it returns `{ ok: false, error: 'no-sync' }` rather than reading
 * past the end.
 */
export function parseFrameHeader(buf: Buffer, offset: number): HeaderParseResult {
  const b0 = buf[offset];
  const b1 = buf[offset + 1];
  const b2 = buf[offset + 2];
  const b3 = buf[offset + 3];
  if (b0 === undefined || b1 === undefined || b2 === undefined || b3 === undefined) {
    return { ok: false, error: 'no-sync' };
  }

  // Frame sync: 11 bits set — all of byte 0, top 3 bits of byte 1.
  if (b0 !== 0xff || (b1 & 0b1110_0000) !== 0b1110_0000) {
    return { ok: false, error: 'no-sync' };
  }

  // Version, byte 1 bits 4–3: 0b11 = MPEG Version 1.
  if (((b1 >> 3) & 0b11) !== 0b11) {
    return { ok: false, error: 'not-mpeg-version-1' };
  }

  // Layer, byte 1 bits 2–1: 0b01 = Layer III.
  if (((b1 >> 1) & 0b11) !== 0b01) {
    return { ok: false, error: 'not-layer-3' };
  }

  const bitrateIndex = (b2 >> 4) & 0b1111;
  const sampleRateIndex = (b2 >> 2) & 0b11;
  const padded = ((b2 >> 1) & 0b1) === 1;
  const channelMode: ChannelMode = CHANNEL_MODES[(b3 >> 6) & 0b11] ?? 'stereo';

  const bitrateKbps = BITRATE_KBPS_BY_INDEX[bitrateIndex] ?? null;
  if (bitrateKbps === null) {
    return {
      ok: false,
      error: bitrateIndex === 0 ? 'free-format-bitrate' : 'reserved-bitrate',
    };
  }

  const sampleRateHz = SAMPLE_RATE_HZ_BY_INDEX[sampleRateIndex] ?? null;
  if (sampleRateHz === null) {
    return { ok: false, error: 'reserved-sample-rate' };
  }

  // docs/mp3-frame-structure.md §5:
  //   frameLength = floor(144 * bitrate_bps / sampleRate_hz) + paddingBit
  // This length includes the 4-byte header (and the CRC, when present), so the
  // next frame starts exactly `frameLength` bytes on.
  const frameLength =
    Math.floor((FRAME_LENGTH_COEFFICIENT * bitrateKbps * 1000) / sampleRateHz) + (padded ? 1 : 0);

  const sideInfoOffset =
    HEADER_BYTES + (channelMode === 'mono' ? SIDE_INFO_BYTES_MONO : SIDE_INFO_BYTES_OTHER);

  return {
    ok: true,
    header: { bitrateKbps, sampleRateHz, padded, channelMode, frameLength, sideInfoOffset },
  };
}
