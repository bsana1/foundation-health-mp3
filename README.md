# MP3 File Analysis App

An HTTP service that accepts an MP3 upload and returns the number of MPEG-1
Audio Layer III frames in it. The upload is streamed through a hand-written
frame parser — never buffered whole — so memory does not grow with file size.

`POST /file-upload` with the provided sample returns `{ "frameCount": 6089 }`,
the value `ffprobe -count_frames` and `mediainfo` report.

## Prerequisites

- Node.js ≥ 20
- npm

## Quick start

```bash
npm install
npm run dev          # starts on http://localhost:3000 with reload
```

Or a production-style run:

```bash
npm run build
npm start
```

## Try it

```bash
curl -sS http://localhost:3000/health
# => {"status":"ok"}

curl -sS -X POST http://localhost:3000/file-upload \
  -F "file=@test/fixtures/foundationhealth-sample-mp3.mp3"
# => {"frameCount":6089}
```

`6089` is the count `mediainfo` and `ffprobe -count_frames` report for the
provided sample. How that number is defined, and a whole corpus it is checked
against, is in [`docs/verifying-frame-counts.md`](docs/verifying-frame-counts.md).

### Errors

Every failure returns `{ "error": { "code": "...", "message": "..." } }`:

```bash
curl -sS -i -X POST http://localhost:3000/file-upload -F "file=@README.md"
# => 422  {"error":{"code":"NOT_AN_MP3","message":"..."}}
```

| Status | `code`                                                      | When                                                  |
| ------ | ----------------------------------------------------------- | ----------------------------------------------------- |
| 400    | `NO_FILE`                                                   | no file part in the request                           |
| 400    | `TOO_MANY_FILES`                                            | more than one file part                               |
| 404    | `NOT_FOUND`                                                 | unknown route or wrong method                         |
| 413    | `FILE_TOO_LARGE`                                            | upload exceeds `MAX_UPLOAD_BYTES`                     |
| 415    | `UNSUPPORTED_MEDIA_TYPE`                                    | request is not `multipart/form-data`                  |
| 422    | `NOT_AN_MP3` / `UNSUPPORTED_MPEG_FORMAT` / `CORRUPT_STREAM` | the bytes are not a countable MPEG-1 Layer III stream |

## Tests and checks

```bash
npm test             # vitest — 113 tests
npm run check        # format check + lint + typecheck + test (what CI runs)
```

With `ffmpeg` / `mediainfo` on `PATH` you can also cross-check the counter
against the reference tools and profile its memory:

```bash
npm run corpus:verify           # our count vs ffprobe / mediainfo, 20 files
npm run perf:memory -- 2 --http # stream 2 GB through the endpoint, report RSS
```

## Deploy

The service is 12-factor: it reads `PORT` / `HOST` from the environment, logs to
stdout, and touches no local files at runtime. Any Node host works.

[`render.yaml`](render.yaml) is a ready blueprint for [Render](https://render.com)'s
free tier — in the dashboard, **New → Blueprint → connect this repo**. It builds,
starts with `npm start`, health-checks `/health`, caps uploads at 25 MiB (under
the platform's request limit), and redeploys on every push to `main`.

## Configuration

All environment variables are optional. Their defaults and validation live in
[`src/config.ts`](src/config.ts) (`DEFAULT_CONFIG`) — the single source of truth.
Notably `PORT` (default `3000`) and `MAX_UPLOAD_BYTES` (default 250 MiB).

For local overrides, `cp .env.example .env` and edit — the `dev` and `start`
scripts load `.env` automatically if present. Deployed environments set the
variables through the platform instead; the repo ships no per-environment files.

## API

`POST /file-upload` — `multipart/form-data` with one file part →
`200 { "frameCount": <number> }`. Full contract and error table in
[`docs/api-contract.md`](docs/api-contract.md).

## Documentation

[`.agent/`](.agent/) holds the living project context — architecture, coding
guidelines, and a decision log — kept current as the code changes.
[`AGENTS.md`](AGENTS.md) is a short orientation that points there (and
`CLAUDE.md` imports it).

| Doc                                                                | What's in it                                                 |
| ------------------------------------------------------------------ | ------------------------------------------------------------ |
| [`.agent/ARCHITECTURE.md`](.agent/ARCHITECTURE.md)                 | System shape and why it's built this way                     |
| [`.agent/CODING_GUIDELINES.md`](.agent/CODING_GUIDELINES.md)       | Conventions, testing approach, merge rules                   |
| [`.agent/DECISIONS.md`](.agent/DECISIONS.md)                       | Decision log                                                 |
| [`docs/TASKS.md`](docs/TASKS.md)                                   | Plan and progress, milestone by milestone                    |
| [`docs/requirements.md`](docs/requirements.md)                     | What the service must do, and its constraints                |
| [`docs/mp3-frame-structure.md`](docs/mp3-frame-structure.md)       | MPEG-1 Layer III frame format and how frames are counted     |
| [`docs/verifying-frame-counts.md`](docs/verifying-frame-counts.md) | The verification corpus and why `ffprobe` is the oracle      |
| [`docs/scalability.md`](docs/scalability.md)                       | Streaming design + measured constant-memory results          |
| [`docs/api-contract.md`](docs/api-contract.md)                     | Endpoint request/response and error contract                 |
| [`docs/manual-testing.md`](docs/manual-testing.md)                 | Tools and scripts for exercising the API by hand             |
| [`docs/repo-setup.md`](docs/repo-setup.md)                         | One-time GitHub settings (squash-only merge, `main` ruleset) |

## Project layout

```
src/
  config.ts               env-driven configuration
  index.ts                process entry point (listen, signals)
  http/
    app.ts                buildApp() — Fastify instance + error handler
    errorResponse.ts      the { error: { code, message } } shape
    routes/fileUpload.ts  POST /file-upload
  mp3/                    the parser (no HTTP knowledge)
    index.ts              public barrel
    countMp3Frames.ts     entry point — drives the counter over a stream/buffer
    frameCounter.ts       streaming state machine (push / end)
    frameHeader.ts        parse + validate one 4-byte header
    id3.ts                measure a leading ID3v2 tag
    vbrHeader.ts          detect the Xing/Info/VBRI metadata frame
    frameResync.ts        recover position after malformed bytes
    errors.ts             typed error hierarchy
    *Consts.ts            tables, offsets, magic numbers
test/
  fixtures/               the provided sample + the verification corpus
  helpers/                synthetic MP3 builders, the sample loader
  http/                   endpoint + concurrency tests
  mp3/                    parser unit, corpus, and memory tests
scripts/                  corpus generation, cross-tool verification, memory profiling
```

## Design notes / with more time

- **Counting definition.** A leading Xing/Info/VBRI frame carries metadata, not
  audio; `ffprobe` and the encoder's own tag exclude it from the count, so we
  do too. The result also carries `hasVbrHeaderFrame`, so the "every physical
  frame" number is `frameCount + 1` if a consumer wants it.
- **Resync.** Malformed bytes mid-stream trigger a bounded forward scan for the
  next valid header (`CORRUPT_STREAM` past 128 KiB). A fuller error-recovery
  decoder is out of scope.
- **Chunk-boundary cost.** The counter does one `Buffer.concat` per pushed
  chunk. Measured fine at real HTTP chunk sizes (§ `docs/scalability.md`); an
  offset/ring buffer would remove even the pathological-small-chunk cost.
- **Out of scope** (`docs/requirements.md`): MPEG-2 / 2.5, Layers I–II,
  free-format bitrate — all detected and rejected with a clear `422`.
