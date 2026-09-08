# Frame-count corpus

MP3 files used to check `countMp3Frames` against `ffprobe -count_frames`. Full
methodology in [`docs/verifying-frame-counts.md`](../../../docs/verifying-frame-counts.md).

- `generated/` — synthesised by `scripts/corpus-generate.sh` (ffmpeg). Covers the
  MPEG-1 Layer III parameter space: every CBR bitrate 32–320, VBR, mono/stereo,
  32k/44.1k/48k, a large ID3v2 tag, a file with no Xing frame, tiny and long
  files, plus MPEG-2 / MPEG-2.5 / non-MP3 files that must be **rejected**.
- `real/` — short clips of freely-usable music (`scripts/corpus-fetch.sh`); see
  [`CREDITS.md`](CREDITS.md).
- `manifest.json` — each file's expected frame count (from ffprobe), our count,
  and mediainfo's for reference. The `corpus.test.ts` suite asserts against this;
  `npm run corpus:verify` re-checks it against the tools.

Regenerate after changing the corpus:

```bash
./scripts/corpus-generate.sh
./scripts/corpus-fetch.sh
npm run corpus:verify -- --write
```
