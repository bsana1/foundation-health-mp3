/**
 * Builders for synthetic MPEG-1 Layer III bytes, so parsing and counting logic
 * can be tested against inputs whose shape is exactly known — rather than
 * depending only on the provided sample file.
 *
 * Headers are spec-real (sync + MPEG-1 + Layer III + the requested
 * bitrate/sample-rate/padding/channel fields). Frame bodies, where produced,
 * are zero-filled because the parser never inspects them.
 */

const BITRATE_INDEX = new Map<number, number>([
  [32, 1],
  [40, 2],
  [48, 3],
  [56, 4],
  [64, 5],
  [80, 6],
  [96, 7],
  [112, 8],
  [128, 9],
  [160, 10],
  [192, 11],
  [224, 12],
  [256, 13],
  [320, 14],
]);

const SAMPLE_RATE_INDEX = new Map<number, number>([
  [44100, 0],
  [48000, 1],
  [32000, 2],
]);

const CHANNEL_MODE_BITS = {
  stereo: 0,
  'joint-stereo': 1,
  'dual-channel': 2,
  mono: 3,
} as const;

export interface FrameSpec {
  bitrateKbps?: number;
  sampleRateHz?: number;
  padded?: boolean;
  channelMode?: keyof typeof CHANNEL_MODE_BITS;
}

/** The 4-byte header for `spec`. */
export function makeHeader(spec: FrameSpec = {}): Buffer {
  const bitrateKbps = spec.bitrateKbps ?? 128;
  const sampleRateHz = spec.sampleRateHz ?? 44100;
  const channelMode = spec.channelMode ?? 'stereo';

  const bitrateIndex = BITRATE_INDEX.get(bitrateKbps);
  const sampleRateIndex = SAMPLE_RATE_INDEX.get(sampleRateHz);
  if (bitrateIndex === undefined || sampleRateIndex === undefined) {
    throw new Error(`no MPEG-1 Layer III index for ${bitrateKbps} kbps / ${sampleRateHz} Hz`);
  }

  const header = Buffer.alloc(4);
  header[0] = 0xff;
  // 0b1111_1011: sync tail (111), version 11 (MPEG-1), layer 01 (III), no CRC (1).
  header[1] = 0b1111_1011;
  header[2] = (bitrateIndex << 4) | (sampleRateIndex << 2) | (spec.padded ? 0b10 : 0);
  header[3] = CHANNEL_MODE_BITS[channelMode] << 6;
  return header;
}

/**
 * A minimal ID3v2.4 tag: 10-byte header (synchsafe body size) + `bodySize`
 * zero bytes, and a 10-byte footer when `footer` is set.
 */
export function makeId3v2(bodySize: number, options: { footer?: boolean } = {}): Buffer {
  const header = Buffer.alloc(10);
  header.write('ID3', 0, 'ascii');
  header[3] = 0x04; // version 2.4
  header[4] = 0x00; // revision
  header[5] = options.footer ? 0b0001_0000 : 0x00; // footer-present flag
  header[6] = (bodySize >>> 21) & 0x7f;
  header[7] = (bodySize >>> 14) & 0x7f;
  header[8] = (bodySize >>> 7) & 0x7f;
  header[9] = bodySize & 0x7f;

  const parts = [header, Buffer.alloc(bodySize)];
  if (options.footer) parts.push(Buffer.alloc(10));
  return Buffer.concat(parts);
}
