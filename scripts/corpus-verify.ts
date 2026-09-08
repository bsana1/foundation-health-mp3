/**
 * Cross-check `countMp3Frames` against `ffprobe -count_frames` (the oracle — it
 * decodes and counts audio packets) and `mediainfo` (informational; its
 * FrameCount is a derived estimate, not a count — see docs/verifying-frame-counts.md).
 *
 *   npx tsx scripts/corpus-verify.ts            # check the committed corpus against manifest.json
 *   npx tsx scripts/corpus-verify.ts --write    # regenerate manifest.json from current behaviour
 *   npx tsx scripts/corpus-verify.ts <path>     # ad-hoc: check a file or folder of your own
 *
 * Exit code is non-zero if our count disagrees with ffprobe on any supported
 * file, or (in check mode) if anything drifts from the manifest.
 */

import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, extname, join, relative } from 'node:path';

import { countMp3Frames } from '../src/mp3/countMp3Frames.js';
import { Mp3AnalysisError } from '../src/mp3/errors.js';

const CORPUS_DIR = 'test/fixtures/corpus';
const MANIFEST = join(CORPUS_DIR, 'manifest.json');

interface Entry {
  notes: string;
  frameCount?: number;
  hasVbrHeaderFrame?: boolean;
  rejected?: string;
  ffprobeFrames: number | null;
  mediainfoFrames: number | null;
}
type Manifest = Record<string, Entry>;

function listMp3(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, name.name);
    if (name.isDirectory()) out.push(...listMp3(full));
    else if (extname(name.name).toLowerCase() === '.mp3') out.push(full);
  }
  return out.sort();
}

function ffprobeFrames(file: string): number | null {
  try {
    const out = execFileSync(
      'ffprobe',
      [
        '-v',
        'error',
        '-select_streams',
        'a:0',
        '-count_frames',
        '-show_entries',
        'stream=nb_read_frames',
        '-of',
        'csv=p=0',
        file,
      ],
      { encoding: 'utf8' },
    ).trim();
    const n = Number.parseInt(out, 10);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

function mediainfoFrames(file: string): number | null {
  try {
    const json = JSON.parse(
      execFileSync('mediainfo', ['--Output=JSON', file], { encoding: 'utf8' }),
    ) as { media?: { track?: Array<Record<string, string>> } };
    const audio = json.media?.track?.find((t) => t['@type'] === 'Audio');
    const n = Number.parseInt(audio?.FrameCount ?? '', 10);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

/** A short human note per known corpus file; empty for anything else. */
function noteFor(key: string): string {
  const name = basename(key, '.mp3');
  const table: Record<string, string> = {
    'mpeg2-lsf-22050': 'MPEG-2 LSF (sample rate < 32k) — out of scope, must reject',
    'mpeg25-11025': 'MPEG-2.5 — out of scope, must reject',
    'not-an-mp3': 'a WAV file with an .mp3 name — must reject',
    'cbr-128k-44100-stereo-noxing': 'CBR, no Xing/Info frame — count is every frame',
    'cbr-128k-44100-stereo-bigid3': 'CBR with a large ID3v2 tag (embedded cover art)',
    'cbr-128k-44100-stereo-tiny': 'CBR, ~0.4s — only a handful of frames',
    'cbr-128k-44100-stereo-long': 'CBR, 15s',
    'soundhelix-1-lame-cbr192-noxing': 'real LAME 3.97, CBR 192k, Xing frame stripped',
    'soundhelix-6-lame-cbr192': 'real LAME, CBR 192k, with Xing frame',
    'samplelib-lame3100-cbr128': 'real LAME 3.100, CBR 128k',
  };
  if (table[name]) return table[name];
  const m = /^(cbr|vbr)-([0-9a-z]+)-(\d+)-(\w+)/.exec(name);
  if (m) return `${m[1]!.toUpperCase()} ${m[2]}, ${m[3]} Hz, ${m[4]}`;
  return '';
}

async function analyse(file: string): Promise<Omit<Entry, 'notes'>> {
  const ffprobe = ffprobeFrames(file);
  const mediainfo = mediainfoFrames(file);
  try {
    const r = await countMp3Frames(readFileSync(file));
    return {
      frameCount: r.frameCount,
      hasVbrHeaderFrame: r.hasVbrHeaderFrame,
      ffprobeFrames: ffprobe,
      mediainfoFrames: mediainfo,
    };
  } catch (error) {
    if (error instanceof Mp3AnalysisError) {
      return { rejected: error.code, ffprobeFrames: ffprobe, mediainfoFrames: mediainfo };
    }
    throw error;
  }
}

function fmt(n: number | null | undefined): string {
  return n === null || n === undefined ? '—' : String(n);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const write = args.includes('--write');
  const target = args.find((a) => !a.startsWith('--'));

  const root = target ?? CORPUS_DIR;
  const files = listMp3(root);
  if (files.length === 0) {
    console.error(`no .mp3 files under ${root}`);
    process.exit(1);
  }

  const existing: Manifest =
    !target && !write ? (JSON.parse(readFileSync(MANIFEST, 'utf8')) as Manifest) : {};
  const next: Manifest = {};
  let failures = 0;

  console.log(
    `${'file'.padEnd(44)} ${'ours'.padStart(7)} ${'ffprobe'.padStart(8)} ${'mediainfo'.padStart(10)}  status`,
  );
  console.log('-'.repeat(90));

  for (const file of files) {
    const key = target ? file : relative(CORPUS_DIR, file);
    const a = await analyse(file);
    const entry: Entry = { notes: noteFor(key), ...a };
    next[key] = entry;

    const ours = a.rejected ? `reject:${a.rejected}` : fmt(a.frameCount);
    const notes: string[] = [];
    let ok = true;

    if (
      a.frameCount !== undefined &&
      a.ffprobeFrames !== null &&
      a.frameCount !== a.ffprobeFrames
    ) {
      ok = false;
      notes.push(`ffprobe mismatch (${a.frameCount} vs ${a.ffprobeFrames})`);
    }
    if (
      a.frameCount !== undefined &&
      a.mediainfoFrames !== null &&
      a.frameCount !== a.mediainfoFrames
    ) {
      notes.push(`mediainfo differs (${a.mediainfoFrames}) — informational`);
    }
    if (!target && !write) {
      const prev = existing[key];
      if (!prev) notes.push('not in manifest');
      else if (JSON.stringify({ ...prev, notes: '' }) !== JSON.stringify({ ...entry, notes: '' })) {
        ok = false;
        notes.push('drifted from manifest');
      }
    }

    if (!ok) failures += 1;
    console.log(
      `${key.padEnd(44)} ${ours.padStart(7)} ${fmt(a.ffprobeFrames).padStart(8)} ` +
        `${fmt(a.mediainfoFrames).padStart(10)}  ${ok ? 'ok' : 'FAIL'} ${notes.join('; ')}`,
    );
  }

  if (write) {
    writeFileSync(MANIFEST, JSON.stringify(next, null, 2) + '\n');
    console.log(`\nwrote ${MANIFEST} (${Object.keys(next).length} entries)`);
  }

  console.log(`\n${failures === 0 ? 'all good' : `${failures} problem(s)`}`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();
