/**
 * The errors the MP3 analysis code raises to its callers. Each carries a stable
 * `code` string so the HTTP layer can map it to a status and response body
 * without matching on the message text.
 */

/** Base class for every error thrown while analysing an MP3 stream. */
export abstract class Mp3AnalysisError extends Error {
  /** Stable, machine-readable identifier. Surfaced to API clients. */
  abstract readonly code: string;

  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/**
 * The stream does not start with recognisable MPEG audio: no valid frame header
 * was found where the first frame should be (after any ID3v2 tag).
 */
export class NotAnMp3Error extends Mp3AnalysisError {
  readonly code = 'NOT_AN_MP3';
}

/**
 * The first frame is a valid MPEG audio frame, but not the supported format
 * (MPEG Version 1, Layer III). Other formats are out of scope.
 */
export class UnsupportedMpegFormatError extends Mp3AnalysisError {
  readonly code = 'UNSUPPORTED_MPEG_FORMAT';
}

/**
 * Parsing began successfully, then the stream became unreadable — a run of bytes
 * with no recoverable frame sync longer than the allowed resync window. Usually
 * a truncated or corrupt file.
 */
export class CorruptStreamError extends Mp3AnalysisError {
  readonly code = 'CORRUPT_STREAM';
}
