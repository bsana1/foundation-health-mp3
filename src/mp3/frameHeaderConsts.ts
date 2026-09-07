/**
 * Fixed values for MPEG-1 Audio Layer III frame headers: the lookup tables and
 * magic numbers from `docs/mp3-frame-structure.md` §3–§5.
 *
 * Kept separate from `frameHeader.ts` so the parsing logic reads without a wall
 * of table literals, and so a test can assert against a table directly.
 */

/** An MPEG audio frame header is always 4 bytes. */
export const HEADER_BYTES = 4;

/** PCM samples encoded per MPEG-1 Layer III frame. */
export const SAMPLES_PER_FRAME = 1152;

/**
 * `SAMPLES_PER_FRAME / 8` bits per byte — the `144` in the frame-length formula
 * `floor(144 * bitrate / sampleRate) + padding`.
 */
export const FRAME_LENGTH_COEFFICIENT = SAMPLES_PER_FRAME / 8;

/**
 * Bitrate in kbit/s by the 4-bit bitrate index. Index 0 ("free format") and 15
 * ("bad") are unusable here and map to `null`.
 */
export const BITRATE_KBPS_BY_INDEX: readonly (number | null)[] = [
  null,
  32,
  40,
  48,
  56,
  64,
  80,
  96,
  112,
  128,
  160,
  192,
  224,
  256,
  320,
  null,
];

/** Sample rate in Hz by the 2-bit sample-rate index. Index 3 is reserved. */
export const SAMPLE_RATE_HZ_BY_INDEX: readonly (number | null)[] = [44100, 48000, 32000, null];

/** Channel mode by the 2-bit channel-mode field. Also the source of the `ChannelMode` type. */
export const CHANNEL_MODES = ['stereo', 'joint-stereo', 'dual-channel', 'mono'] as const;

/**
 * Bytes of side information between the header and the frame data — and so the
 * offset at which a Xing/Info tag would begin, relative to the header.
 */
export const SIDE_INFO_BYTES_MONO = 17;
export const SIDE_INFO_BYTES_OTHER = 32;
