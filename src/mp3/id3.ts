/**
 * ID3v2 tag detection.
 *
 * The frame walker needs one thing from a leading ID3v2 tag: how many bytes to
 * skip before the first MPEG frame. We do not decode tag contents (title,
 * artist, artwork). A trailing ID3v1 tag needs no handling either — the walk
 * simply stops when it can no longer find a valid frame. See
 * `docs/mp3-frame-structure.md` §2.
 */

import {
  ID3V2_FOOTER_FLAG,
  ID3V2_HEADER_BYTES,
  ID3V2_IDENTIFIER,
  SYNCHSAFE_BITS_PER_BYTE,
  SYNCHSAFE_BYTE_MASK,
} from './id3Consts.js';

/** Bytes needed before {@link id3v2TagSize} can give a definitive answer. */
export const ID3V2_MIN_BYTES = ID3V2_HEADER_BYTES;

/**
 * Total size in bytes of an ID3v2 tag at the start of `buf` — the 10-byte
 * header, the declared body, and a 10-byte footer when present.
 *
 * Returns 0 when there is no ID3v2 tag at offset 0, or when fewer than
 * {@link ID3V2_MIN_BYTES} bytes are available to tell. Only the start of the
 * buffer is inspected; a tag elsewhere is not this function's concern.
 */
export function id3v2TagSize(buf: Buffer): number {
  if (buf.length < ID3V2_HEADER_BYTES) return 0;
  if (
    buf[0] !== ID3V2_IDENTIFIER[0] ||
    buf[1] !== ID3V2_IDENTIFIER[1] ||
    buf[2] !== ID3V2_IDENTIFIER[2]
  ) {
    return 0;
  }

  // bytes 3–4: version major/revision (ignored). byte 5: flags.
  const flags = buf[5] ?? 0;

  // bytes 6–9: synchsafe body size — 7 usable bits per byte, big-endian. Mask
  // each byte (its top bit should already be 0) so a malformed tag cannot inject
  // spurious high bits. Max value is 2^28-1, well within a 32-bit shift.
  const b6 = (buf[6] ?? 0) & SYNCHSAFE_BYTE_MASK;
  const b7 = (buf[7] ?? 0) & SYNCHSAFE_BYTE_MASK;
  const b8 = (buf[8] ?? 0) & SYNCHSAFE_BYTE_MASK;
  const b9 = (buf[9] ?? 0) & SYNCHSAFE_BYTE_MASK;
  const bodySize =
    (b6 << (SYNCHSAFE_BITS_PER_BYTE * 3)) |
    (b7 << (SYNCHSAFE_BITS_PER_BYTE * 2)) |
    (b8 << SYNCHSAFE_BITS_PER_BYTE) |
    b9;

  const footerBytes = (flags & ID3V2_FOOTER_FLAG) !== 0 ? ID3V2_HEADER_BYTES : 0;
  return ID3V2_HEADER_BYTES + bodySize + footerBytes;
}
