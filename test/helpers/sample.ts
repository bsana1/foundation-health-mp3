/**
 * The provided reference MP3, loaded once for tests that assert against real
 * data rather than synthetic frames.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const SAMPLE_MP3: Buffer = readFileSync(
  fileURLToPath(new URL('../fixtures/foundationhealth-sample-mp3.mp3', import.meta.url)),
);
