/**
 * Streaming MPEG-1 Layer III frame counter.
 *
 * Feed the raw file bytes in with {@link Mp3FrameCounter.push} (any chunk sizes,
 * any boundaries) and call {@link Mp3FrameCounter.end} to get the count. Memory
 * use is bounded by the largest single chunk plus at most one frame of
 * carry-over — it does not grow with file size, and a large leading ID3v2 tag
 * (album art) is skipped incrementally rather than buffered.
 *
 * The walk is deliberate, not a scan for `0xFF` sync bytes: audio payload is
 * full of bytes that look like a sync. We parse the header at the cursor, trust
 * its frame-length arithmetic to land on the next header, and only fall back to
 * scanning when a header genuinely fails to parse. See
 * `docs/mp3-frame-structure.md` §6.
 */

import { CorruptStreamError, NotAnMp3Error, UnsupportedMpegFormatError } from './errors.js';
import { DEFAULT_MAX_RESYNC_BYTES } from './frameCounterConsts.js';
import { parseFrameHeader, type FrameHeader, type HeaderParseError } from './frameHeader.js';
import { HEADER_BYTES, SAMPLES_PER_FRAME } from './frameHeaderConsts.js';
import { findNextFrameHeader, resyncResumeOffset } from './frameResync.js';
import { ID3V2_MIN_BYTES, id3v2TagSize } from './id3.js';
import { isVbrHeaderFrame } from './vbrHeader.js';

export interface FrameCountResult {
  /** Number of audio frames. A leading Xing/Info/VBRI metadata frame is excluded. */
  readonly frameCount: number;
  /** Whether a Xing/Info/VBRI header frame was found and left out of the count. */
  readonly hasVbrHeaderFrame: boolean;
  /** `frameCount * 1152 / sampleRate`, in seconds. 0 when there are no audio frames. */
  readonly durationSeconds: number;
  /** Total bytes skipped while resynchronising past malformed data. */
  readonly resyncBytes: number;
}

export interface FrameCounterOptions {
  /** Override {@link DEFAULT_MAX_RESYNC_BYTES}. */
  readonly maxResyncBytes?: number;
}

/** Header parse failures that mean "valid MPEG frame, wrong format" rather than "not MPEG at all". */
const WRONG_FORMAT_ERRORS: ReadonlySet<HeaderParseError> = new Set<HeaderParseError>([
  'not-mpeg-version-1',
  'not-layer-3',
  'free-format-bitrate',
]);

export class Mp3FrameCounter {
  private readonly maxResyncBytes: number;

  /** Bytes received but not yet consumed. */
  private carry: Buffer = Buffer.alloc(0);
  /** Bytes of the leading ID3v2 tag still to skip; -1 until the tag is measured. */
  private id3BytesToSkip = -1;
  private frameCount = 0;
  private hasVbrHeaderFrame = false;
  /** Header of the first frame parsed (audio or metadata) — used for the duration. */
  private referenceHeader: FrameHeader | null = null;
  /** True once any valid header has been parsed — distinguishes "not an MP3" from "corrupt". */
  private sawValidHeader = false;
  /** The first frame may be a metadata frame; check exactly once. */
  private firstFrameChecked = false;
  private resyncBytes = 0;
  /** Bytes skipped resyncing since the last good frame — reset on progress, capped by maxResyncBytes. */
  private resyncRunBytes = 0;
  private ended = false;

  constructor(options: FrameCounterOptions = {}) {
    this.maxResyncBytes = Math.max(0, options.maxResyncBytes ?? DEFAULT_MAX_RESYNC_BYTES);
  }

  /** Add the next chunk of file bytes. */
  push(chunk: Buffer): void {
    if (this.ended) throw new Error('Mp3FrameCounter.push called after end()');
    if (chunk.length === 0) return;
    this.carry = this.carry.length === 0 ? chunk : Buffer.concat([this.carry, chunk]);
    this.consume(false);
  }

  /** Signal end of stream and get the result. */
  end(): FrameCountResult {
    if (this.ended) throw new Error('Mp3FrameCounter.end called twice');
    this.consume(true);
    this.ended = true;

    if (!this.sawValidHeader) {
      throw new NotAnMp3Error('No MPEG-1 Layer III frame was found at the start of the stream');
    }

    const sampleRateHz = this.referenceHeader?.sampleRateHz ?? SAMPLES_PER_FRAME;
    return {
      frameCount: this.frameCount,
      hasVbrHeaderFrame: this.hasVbrHeaderFrame,
      durationSeconds: (this.frameCount * SAMPLES_PER_FRAME) / sampleRateHz,
      resyncBytes: this.resyncBytes,
    };
  }

  /**
   * Process everything `carry` currently allows, then discard what was consumed.
   *
   * With the whole file in memory this would just be:
   *
   *     let cursor = id3v2TagSize(file);
   *     while (cursor + HEADER_BYTES <= file.length) {
   *       const { header } = parseFrameHeader(file, cursor);   // (assume ok)
   *       if (!isLeadingMetadataFrame) frameCount++;
   *       cursor += header.frameLength;
   *     }
   *
   * The extra machinery here is only because `file` arrives in chunks: each step
   * that needs more bytes than `carry` holds has to stop and resume on the next
   * `push` — unless `atEof`, when "not enough bytes" instead means "truncated
   * final frame, count it once".
   */
  private consume(atEof: boolean): void {
    if (!this.skipId3(atEof)) return;

    let cursor = 0;
    while (this.carry.length - cursor >= HEADER_BYTES) {
      const result = parseFrameHeader(this.carry, cursor);

      if (!result.ok) {
        this.rejectIfStreamNeverStarted(result.error);
        cursor = this.resyncFrom(cursor, atEof);
        continue; // the loop condition ends the walk once cursor runs out
      }

      const frameEnd = cursor + result.header.frameLength;
      const wholeFrame = frameEnd <= this.carry.length;
      if (!wholeFrame && !atEof) break; // wait for the rest of this frame

      this.sawValidHeader = true;
      this.referenceHeader ??= result.header;
      this.countFrame(result.header, cursor, wholeFrame);
      this.resyncRunBytes = 0;

      cursor = wholeFrame ? frameEnd : this.carry.length; // truncated final frame → to EOF
    }

    if (cursor > 0) {
      this.carry = Buffer.from(this.carry.subarray(cursor));
    }
  }

  /**
   * A header failed to parse. If it is the very first thing in the stream, that
   * is a hard error — the input is not an MP3, or not the supported format.
   * Otherwise the caller resynchronises.
   */
  private rejectIfStreamNeverStarted(error: HeaderParseError): void {
    if (this.sawValidHeader) return;
    throw WRONG_FORMAT_ERRORS.has(error)
      ? new UnsupportedMpegFormatError(
          'The first frame is valid MPEG audio but not the supported MPEG Version 1, Layer III',
        )
      : new NotAnMp3Error('Stream does not start with an MPEG-1 Layer III frame header');
  }

  /**
   * After a malformed header at `from`, return the offset to resume the walk at
   * (see `frameResync.ts`) and charge the skipped bytes to the resync budget.
   */
  private resyncFrom(from: number, atEof: boolean): number {
    const found = findNextFrameHeader(this.carry, from);
    const resumeAt = resyncResumeOffset(found, this.carry.length, atEof);
    this.accountResync(resumeAt - from);
    return resumeAt;
  }

  /**
   * Handle a leading ID3v2 tag once, incrementally. Returns false while it still
   * needs more bytes before the frame walk can begin.
   */
  private skipId3(atEof: boolean): boolean {
    if (this.id3BytesToSkip === -1) {
      if (this.carry.length < ID3V2_MIN_BYTES) {
        if (!atEof) return false;
        this.id3BytesToSkip = 0;
      } else {
        this.id3BytesToSkip = id3v2TagSize(this.carry);
      }
    }

    if (this.id3BytesToSkip > 0) {
      const drop = Math.min(this.id3BytesToSkip, this.carry.length);
      this.carry = Buffer.from(this.carry.subarray(drop));
      this.id3BytesToSkip -= drop;
      if (this.id3BytesToSkip > 0) return false; // more tag still to come
    }
    return true;
  }

  /**
   * Count the frame at `carry[frameStart]`, unless it is the leading
   * Xing/Info/VBRI metadata frame (checked once, and only when the whole frame
   * is buffered so the tag is visible).
   */
  private countFrame(header: FrameHeader, frameStart: number, wholeFrameBuffered: boolean): void {
    if (!this.firstFrameChecked) {
      this.firstFrameChecked = true;
      // A truncated first frame can't be told apart from a metadata frame, so
      // it is not counted — the file has zero complete audio frames.
      if (!wholeFrameBuffered) return;
      if (isVbrHeaderFrame(this.carry, frameStart, header)) {
        this.hasVbrHeaderFrame = true;
        return;
      }
    }
    this.frameCount += 1;
  }

  private accountResync(bytes: number): void {
    if (bytes <= 0) return;
    this.resyncBytes += bytes;
    this.resyncRunBytes += bytes;
    if (this.resyncRunBytes > this.maxResyncBytes) {
      throw new CorruptStreamError(
        `No valid frame header within ${this.maxResyncBytes} bytes of malformed data`,
      );
    }
  }
}
