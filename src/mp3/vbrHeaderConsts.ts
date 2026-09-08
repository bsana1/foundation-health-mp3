/**
 * Constants for the VBR/CBR header frame (Xing / Info / VBRI). See
 * `docs/mp3-frame-structure.md` §8.
 */

/** 4-byte ASCII tag a VBR header frame carries in place of audio (Xing = VBR). */
export const XING_TAG = 'Xing';

/** Same structure as Xing, written by LAME / FFmpeg for CBR streams. */
export const INFO_TAG = 'Info';

/** Fraunhofer's variant. */
export const VBRI_TAG = 'VBRI';

/**
 * A VBRI tag always sits 32 bytes after the 4-byte frame header, regardless of
 * channel mode. (Xing/Info instead follow the side-information block, whose size
 * depends on channel mode — that offset comes from `FrameHeader.sideInfoOffset`.)
 */
export const VBRI_TAG_OFFSET = 4 + 32;
