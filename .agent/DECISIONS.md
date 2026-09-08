# Decision log

Newest first. Each entry: the decision, why, and what was rejected.

## 2026-09-08 — One error-response shape; app-level handler for the unexpected

Every failure returns `{ "error": { "code", "message" } }` — a stable `code` for
programmatic handling, a `message` for humans. The route maps the expected cases
directly (analysis errors → 422, no file → 400, oversize → 413, wrong
content-type → 415). Anything else propagates to an `app.setErrorHandler` that
reshapes known framework errors, and turns genuinely unexpected errors into
`500 { code: "INTERNAL" }` with the real error logged server-side, never
returned. Rejected: letting Fastify's default `{ statusCode, error, message }`
shape through — inconsistent with our body, and its 500s echo the message.

## 2026-09-08 — Reject a second file part rather than pick one

The route iterates `request.parts()` and returns `400 TOO_MANY_FILES` if a
second file part appears — a frame-counting API shouldn't silently choose one of
two uploads and leave the caller unsure which count they got. Non-file fields
are ignored. Rejected: `request.file()` (only ever reads the first part, so
extra files pass unnoticed) and a hard `limits.files: 1` (busboy throws before
the route can send a clear message).

## 2026-09-08 — `ffprobe -count_frames` is the verification oracle, not `mediainfo`

Built a committed corpus (`test/fixtures/corpus/`, 20 files) to check
`countMp3Frames` across the format space. Found that `mediainfo`'s `FrameCount`
is a **derived estimate**, not a count: for VBR it echoes the Xing header field,
for CBR it reports `round(duration × frame_rate)`, which rounds up to include the
Info frame on short files (117 vs the real 116). `ffprobe -select_streams a:0
-count_frames` actually decodes and counts audio packets, consistently excluding
the metadata frame — same definition as ours. So expected counts in
`manifest.json` come from `ffprobe`; `mediainfo` is shown for sanity but allowed
to differ. `countMp3Frames` matches `ffprobe` on all 17 countable corpus files
(and the provided sample). Details in `docs/verifying-frame-counts.md`.

## 2026-09-08 — Frame counter: streaming state machine, incremental everything

`Mp3FrameCounter` is fed byte chunks via `push()` and finalised with `end()`
(not a Node stream subclass — the wrapper `countMp3Frames` adapts streams to it).
Design choices:

- **ID3v2 skipped incrementally**, not buffered. A tag with album art can be
  100s of KB; the counter tracks "bytes of tag still to drop" and discards them
  chunk by chunk, so memory stays O(chunk) even for a huge tag.
- **Carry-over is copied out** (`Buffer.from(subarray)`) after each consume so the
  parent concat buffer is released — the retained slice is at most ~1 frame.
- **Bounded resync.** On a malformed header mid-stream, scan forward for the next
  valid one; track bytes skipped since the last good frame and throw
  `CorruptStreamError` past `maxResyncBytes` (default 128 KiB). A first-byte
  parse failure is `NotAnMp3Error` / `UnsupportedMpegFormatError` immediately, no
  scanning.
- **Truncated final frame** (declared length runs past EOF, header valid): counted
  once. Matches lenient tools; documented in `docs/mp3-frame-structure.md` §10.
- Known cost: `Buffer.concat(carry, chunk)` per `push` is O(n·chunks) for
  pathologically small chunks. Flagged for the perf milestone; fine for real
  upload chunk sizes.

## 2026-09-07 — Branch + PR for everything; squash-only merges

No commits land on `main` directly — every change, however small, goes on a
branch and merges via a pull request. The repo ruleset push-protects `main` (a
`pull_request` rule), so a direct push is rejected, not just discouraged. `main`
gets one commit per PR via squash merge; merge commits and rebase merging are
turned off and the ruleset requires linear history. The squash message is
configured to come from the PR title + body, so the PR description is where the
"what and why" lives — enforced by a PR template and a CI check that rejects an
empty/template-only body. Rejected: allowing merge commits (noisy first-parent
history for a small service) and relying on convention alone for description
quality (it slips). Branch-internal commits stay unrestricted since they
collapse on squash.

## 2026-09-07 — Single flat config; `.env` for local dev only

`src/config.ts` is the only code that reads `process.env`. It applies in-code
defaults (`DEFAULT_CONFIG`), validates, and produces one typed `AppConfig` that
is threaded through the app. Config is a flat set of variables (`HOST`, `PORT`,
`MAX_UPLOAD_BYTES`, `LOG_LEVEL`) — no secrets.

`process.env` is populated by: an optional local `.env` file (`.env.example` is
the committed catalog; `.env` is gitignored; the `dev`/`start` scripts load it
with `--env-file-if-exists`, no dependency), or, in QA/prod, the deployment
platform. No committed per-environment files.

Rejected: per-environment config files (`config/qa.json`, …) selected by
`NODE_ENV` — that pattern pays off with many environment-specific values or
secrets to manage, neither of which applies here. Revisit if the config surface
grows secrets. (An earlier pass dropped `.env.example` entirely; added back
because a discoverable catalog of the knobs is worth one committed file.)

## 2026-09-07 — Vitest, not Jest

Vitest runs ESM + TypeScript with no transform config (Jest needs `ts-jest` or
`@swc/jest` plus ESM workarounds), is faster, and keeps the Jest-compatible
`describe`/`it`/`expect` API so nothing is unfamiliar. Coverage is built in
(v8). For a strict-ESM TypeScript project this is materially less setup and
config than Jest for the same result.

## 2026-09-07 — Fastify for the HTTP layer

Chose Fastify + `@fastify/multipart` over Express + busboy and over plain
`node:http`. Fastify has first-class TypeScript types, its response
serialisation sets `content-type: application/json` from the route schema, and
`@fastify/multipart` exposes the upload as a `Readable` stream, which is exactly
what the streaming frame counter needs. Express has no streaming upload
primitive (multer buffers to memory or disk by default — the pattern we're
avoiding), and hand-rolling `multipart/form-data` parsing on `node:http` is
fiddly work with no payoff here. Only the MPEG parsing is kept in-house; a
general HTTP framework is fair game.

## 2026-09-07 — Report 6089 for the sample; exclude the Xing header frame

The provided sample contains 6090 structurally valid MPEG-1 Layer III frames:
one leading `Xing` metadata frame (silent, carries the VBR frame/byte counts and
seek table) followed by 6089 audio frames. `mediainfo` and
`ffprobe -count_frames` both report **6089** — they don't count the metadata
frame. We match that definition: the counter detects a Xing/Info/VBRI first
frame, steps over it, and doesn't count it. `mediainfo` / `ffprobe` are the
reference oracles for the integration test.

Rejected: counting all 6090 physical frames. It's a defensible reading of "number
of frames in the file", but it disagrees with every standard tool. The counter
still exposes `hasVbrHeaderFrame`, so the physical count (`frameCount + 1`) is
recoverable if a consumer needs it.

## 2026-09-07 — Streaming parser, not buffer-the-file

The counter is a state machine fed arbitrary byte chunks, keeping only a
carry-over of at most one frame. Memory is O(chunk size), not O(file size), so a
1 GB upload behaves like a 1 MB one. Rejected: reading the whole upload into a
Buffer first — simpler to write, but memory then scales with attacker-controlled
input and the service falls over under a handful of concurrent large uploads.

## 2026-09-07 — Build the service before the parser

Bootstrapped a running service with a stubbed endpoint (returns
`{ "frameCount": 0 }`) before implementing any MPEG parsing, so the HTTP
contract, tooling, and CI are settled and the parser can be developed and tested
in isolation against that fixed shape.
