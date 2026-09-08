/**
 * The frame-count corpus: `countMp3Frames` against a spread of real and
 * generated MP3s, with expected counts pinned from `ffprobe -count_frames`.
 *
 * `test/fixtures/corpus/manifest.json` is the source of truth — regenerate it
 * with `npm run corpus:verify -- --write` when the corpus changes. See
 * `docs/verifying-frame-counts.md`.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { countMp3Frames } from '../../src/mp3/countMp3Frames.js';
import { Mp3AnalysisError } from '../../src/mp3/errors.js';

interface CorpusEntry {
  notes: string;
  frameCount?: number;
  hasVbrHeaderFrame?: boolean;
  rejected?: string;
  ffprobeFrames: number | null;
  mediainfoFrames: number | null;
}

const corpusUrl = new URL('../fixtures/corpus/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('manifest.json', corpusUrl), 'utf8')) as Record<
  string,
  CorpusEntry
>;

const entries = Object.entries(manifest);

describe('frame-count corpus (expected values from ffprobe -count_frames)', () => {
  it('has a non-trivial number of fixtures', () => {
    expect(entries.length).toBeGreaterThanOrEqual(15);
  });

  it.each(entries)('%s', async (key, entry) => {
    const bytes = readFileSync(fileURLToPath(new URL(key, corpusUrl)));

    if (entry.rejected !== undefined) {
      const error = await countMp3Frames(bytes).then(
        () => {
          throw new Error('expected countMp3Frames to reject');
        },
        (e: unknown) => e,
      );
      expect(error).toBeInstanceOf(Mp3AnalysisError);
      expect((error as Mp3AnalysisError).code).toBe(entry.rejected);
      return;
    }

    const result = await countMp3Frames(bytes);
    expect(result.frameCount).toBe(entry.frameCount);
    expect(result.hasVbrHeaderFrame).toBe(entry.hasVbrHeaderFrame);
    if (entry.ffprobeFrames !== null) {
      expect(result.frameCount).toBe(entry.ffprobeFrames);
    }
  });
});
