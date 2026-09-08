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
   * Consume everything `carry` currently allows: skip the ID3v2 tag, then walk
   * whole frames. A trailing partial frame stays in `carry` for the next chunk.
   * When `atEof`, a final frame whose declared length runs past the end is still
   * counted once.
   */
  private consume(atEof: boolean): void {
    if (!this.skipId3(atEof)) return;

    let cursor = 0;
    while (this.carry.length - cursor >= HEADER_BYTES) {
      const result = parseFrameHeader(this.carry, cursor);

      if (!result.ok) {
        if (!this.sawValidHeader) {
          throw WRONG_FORMAT_ERRORS.has(result.error)
            ? new UnsupportedMpegFormatError(
                `First frame is valid MPEG audio but not MPEG-1 Layer III (${result.error})`,
              )
            : new NotAnMp3Error('Stream does not start with an MPEG-1 Layer III frame header');
        }

        const next = this.findNextHeader(cursor);
        if (next !== -1) {
          this.accountResync(next - cursor);
          cursor = next;
          continue;
        }

        // Nothing usable in what we hold. Drop the unreadable run — keeping the
        // last few bytes in case a sync straddles the next chunk boundary — and
        // wait for more (or, at EOF, stop).
        const dropTo = atEof ? this.carry.length : this.carry.length - (HEADER_BYTES - 1);
        this.accountResync(dropTo - cursor);
        cursor = dropTo;
        break;
      }

      this.sawValidHeader = true;
      this.referenceHeader ??= result.header;

      const available = this.carry.length - cursor;
      const { frameLength } = result.header;

      if (available < frameLength) {
        if (!atEof) break; // wait for the rest of the frame
        this.countFrame(result.header, cursor, false); // truncated final frame
        cursor = this.carry.length;
        break;
      }

      this.countFrame(result.header, cursor, true);
      cursor += frameLength;
      this.resyncRunBytes = 0;
    }

    if (cursor > 0) {
      this.carry = Buffer.from(this.carry.subarray(cursor));
    }
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
      if (wholeFrameBuffered && isVbrHeaderFrame(this.carry, frameStart, header)) {
        this.hasVbrHeaderFrame = true;
        return;
      }
    }
    this.frameCount += 1;
  }

  /**
   * Scan `carry` from `from + 1` for the next offset that parses as a valid
   * header. Returns -1 when there is none within the bytes currently held. Pure:
   * does not touch `carry` or any counters.
   */
  private findNextHeader(from: number): number {
    const scanEnd = this.carry.length - HEADER_BYTES;
    for (let offset = from + 1; offset <= scanEnd; offset += 1) {
      if (this.carry[offset] === 0xff && parseFrameHeader(this.carry, offset).ok) {
        return offset;
      }
    }
    return -1;
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
