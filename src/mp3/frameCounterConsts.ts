/**
 * Constants for the streaming frame counter.
 */

/**
 * Default cap on the number of bytes the walker will skip past malformed data,
 * looking for the next valid frame header, before it gives up with
 * `CorruptStreamError`. Bounds the cost of feeding in a large non-MP3 file that
 * happens to start with something frame-like. 128 KiB.
 */
export const DEFAULT_MAX_RESYNC_BYTES = 128 * 1024;
