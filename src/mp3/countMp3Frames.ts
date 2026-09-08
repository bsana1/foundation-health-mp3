/**
 * The public way to count frames: give it anything that yields bytes — a Node
 * stream, an async iterable, a plain `Uint8Array`/`Buffer` — and it drives an
 * {@link Mp3FrameCounter} to completion without ever holding the whole input.
 */

import { Buffer } from 'node:buffer';

import {
  Mp3FrameCounter,
  type FrameCountResult,
  type FrameCounterOptions,
} from './frameCounter.js';

export type ByteChunkSource = AsyncIterable<Uint8Array> | Iterable<Uint8Array> | Uint8Array;

/**
 * Count the MPEG-1 Layer III audio frames in `source`.
 *
 * @throws {NotAnMp3Error} the stream does not start with MPEG audio
 * @throws {UnsupportedMpegFormatError} the first frame is a non-supported MPEG format
 * @throws {CorruptStreamError} the stream became unreadable partway through
 */
export async function countMp3Frames(
  source: ByteChunkSource,
  options?: FrameCounterOptions,
): Promise<FrameCountResult> {
  const counter = new Mp3FrameCounter(options);

  if (source instanceof Uint8Array) {
    counter.push(toBuffer(source));
  } else {
    for await (const chunk of source) {
      counter.push(toBuffer(chunk));
    }
  }

  return counter.end();
}

function toBuffer(chunk: Uint8Array): Buffer {
  return Buffer.isBuffer(chunk)
    ? chunk
    : Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
}
