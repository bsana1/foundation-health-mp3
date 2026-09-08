/**
 * The provided reference MP3, loaded once for tests that assert against real
 * data rather than synthetic frames.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const SAMPLE_MP3: Buffer = readFileSync(
  fileURLToPath(new URL('../fixtures/foundationhealth-sample-mp3.mp3', import.meta.url)),
);

/** The frame count `mediainfo` and `ffprobe -count_frames` report for {@link SAMPLE_MP3}. */
export const SAMPLE_FRAME_COUNT = 6089;

/** Byte offset of the first frame in {@link SAMPLE_MP3} (its ID3v2 tag is 44 bytes). */
export const SAMPLE_FIRST_FRAME_OFFSET = 44;
