/**
 * ID3v2 tag-header layout. See `docs/mp3-frame-structure.md` §2.
 */

/** The bytes `"ID3"` at the very start of an ID3v2 tag. */
export const ID3V2_IDENTIFIER = [0x49, 0x44, 0x33] as const;

/** An ID3v2 header — and its optional footer — is 10 bytes each. */
export const ID3V2_HEADER_BYTES = 10;

/** Flags byte (byte 5), bit 4: a 10-byte footer follows the tag body (ID3v2.4 only). */
export const ID3V2_FOOTER_FLAG = 0b0001_0000;

/**
 * The 4-byte size field (bytes 6–9) is a "synchsafe" integer: the top bit of
 * each byte is 0, so each contributes 7 bits. Mask applied per byte when
 * decoding.
 */
export const SYNCHSAFE_BYTE_MASK = 0b0111_1111;
export const SYNCHSAFE_BITS_PER_BYTE = 7;
