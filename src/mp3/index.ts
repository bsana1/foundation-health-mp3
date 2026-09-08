/**
 * Public surface of the MP3 analysis module. Re-exports only; no logic.
 */

export { countMp3Frames, type ByteChunkSource } from './countMp3Frames.js';
export {
  Mp3FrameCounter,
  type FrameCountResult,
  type FrameCounterOptions,
} from './frameCounter.js';
export {
  Mp3AnalysisError,
  NotAnMp3Error,
  UnsupportedMpegFormatError,
  CorruptStreamError,
} from './errors.js';
