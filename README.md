# MP3 File Analysis App

An HTTP service that accepts an MP3 upload and returns the number of MPEG-1 Audio
Layer III frames in it.

> **Status: bootstrap.** The service runs and the `POST /file-upload` endpoint
> accepts an MP3 and responds with the final JSON shape, but `frameCount` is
> currently a stub `0`. The frame parser is the next milestone — see
> [`docs/TASKS.md`](docs/TASKS.md).

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
# health
curl -sS http://localhost:3000/health
# => {"status":"ok"}

# frame count (stub value for now)
curl -sS -X POST http://localhost:3000/file-upload \
  -F "file=@test/fixtures/foundationhealth-sample-mp3.mp3"
# => {"frameCount":0}
```

The provided sample's real frame count is **6089** (verified with `mediainfo`
and `ffprobe`); the endpoint will return that once the parser lands.

## Tests and checks

```bash
npm test             # vitest
npm run typecheck    # tsc --noEmit
npm run lint         # eslint
npm run check        # format check + lint + typecheck + test (what CI runs)
```

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

| Doc                                                          | What's in it                                                 |
| ------------------------------------------------------------ | ------------------------------------------------------------ |
| [`docs/TASKS.md`](docs/TASKS.md)                             | Plan and progress, milestone by milestone                    |
| [`docs/requirements.md`](docs/requirements.md)               | What the service must do, and its constraints                |
| [`docs/mp3-frame-structure.md`](docs/mp3-frame-structure.md) | MPEG-1 Layer III frame format and how frames are counted     |
| [`docs/api-contract.md`](docs/api-contract.md)               | Endpoint request/response and error contract                 |
| [`docs/manual-testing.md`](docs/manual-testing.md)           | Tools and scripts for exercising the API by hand             |
| [`docs/repo-setup.md`](docs/repo-setup.md)                   | One-time GitHub settings (squash-only merge, `main` ruleset) |
| [`.agent/ARCHITECTURE.md`](.agent/ARCHITECTURE.md)           | System shape and why it's built this way                     |
| [`.agent/CODING_GUIDELINES.md`](.agent/CODING_GUIDELINES.md) | Conventions, testing approach, merge rules                   |
| [`.agent/DECISIONS.md`](.agent/DECISIONS.md)                 | Decision log                                                 |

## Project layout

```
src/
  config.ts               env-driven configuration
  index.ts                process entry point (listen, signals)
  http/
    app.ts                buildApp() — Fastify instance, testable
    routes/
      fileUpload.ts        POST /file-upload  (stub until the parser is wired in)
  mp3/
    frameHeader.ts         parse + validate one 4-byte frame header
    frameHeaderConsts.ts   lookup tables and magic numbers
    ...                     more of the parser lands over Milestone 1
test/
  fixtures/               the provided sample MP3
  helpers/                synthetic MP3 builders for tests
  http/                   endpoint smoke tests (one route per file)
  mp3/                    parser unit tests
```
