# Plan & task list

Working log of what's done and what's next. Checked items are in `main`.
The guiding order: a running service first, then correct frame counting, then
hardening, then release readiness.

## Milestone 0 — Bootstrap (done)

- [x] Repo, Git, `.gitignore`, project layout
- [x] TypeScript strict config, build config
- [x] Tooling: ESLint (flat, type-checked), Prettier, Vitest, `npm run check`
- [x] Fastify app split into `buildApp()` (testable) + `src/index.ts` (process)
- [x] `POST /file-upload` accepting `multipart/form-data`, streaming the file
      part, returning the final response shape `{ "frameCount": <n> }` — **stub
      value `0` for now**
- [x] `GET /health`
- [x] Config from env with safe defaults (`src/config.ts`)
- [x] Smoke test: service boots, `/health` ok, `/file-upload` returns the shape
- [x] Reference frame count for the sample established: **6089**
      (`mediainfo` and `ffprobe -count_frames` agree)
- [x] Docs: requirements, MP3 structure reference, API contract, `.agent/`

## Milestone 1 — Frame counting (next)

- [ ] `src/mp3/id3.ts` — measure and skip a leading ID3v2 tag (synchsafe size)
- [ ] `src/mp3/frame-header.ts` — parse + validate the 4-byte header; bitrate /
      sample-rate tables; frame-length formula; typed parse result
- [ ] `src/mp3/frame-counter.ts` — streaming state machine: `update(chunk)` /
      `finish()`, carry-over buffer, O(1) memory
- [ ] `src/mp3/vbr-header.ts` — detect the Xing/Info/VBRI header frame and
      exclude it from the count (this is what makes our number match `mediainfo`)
- [ ] `src/mp3/index.ts` — `countMp3Frames(source)` public entry point
- [ ] Typed error hierarchy: `NotAnMp3Error`, `UnsupportedMpegFormatError`,
      `CorruptStreamError`
- [ ] Wire the counter into the route; drop the stub
- [ ] Unit tests with synthetic frames (chosen counts, chunk-boundary fuzzing)
- [ ] Integration test asserting `6089` against the provided sample
- [ ] Optional: small CLI (`mp3-frames <file>`) reusing the core, for local
      verification against `mediainfo`

## Milestone 2 — Error handling & edges

- [ ] Map analysis errors to HTTP status + `{ error: { code, message } }` body
- [ ] `413` when the upload exceeds `MAX_UPLOAD_BYTES`
- [ ] `400` on no file part; `415` on non-multipart
- [ ] Early-abort: reject a non-MPEG-1-L3 first frame without reading the rest
- [ ] Decide + document truncated-final-frame behaviour
- [ ] Fastify error handler so nothing leaks a stack trace to the client

## Milestone 3 — Scalability & perf

- [ ] Confirm constant memory on a multi-hundred-MB input (streamed, not buffered)
- [ ] Load/perf test (autocannon or k6) against the sample; record throughput and
      RSS in `docs/`
- [ ] Note any hot-path tuning (buffer reuse, avoiding `Buffer.concat` growth)

## Milestone 4 — Release readiness

- [ ] README polished: quick start, test instructions, curl example, contract
- [ ] `.agent/DECISIONS.md` current
- [ ] "Known limitations / next steps" section in the README
- [ ] Manual-testing artifact: `requests/api.http` + `scripts/smoke.sh`
      (options weighed in `docs/manual-testing.md`)
- [ ] Final pass: `npm run check` clean, CI green, sample returns `6089`
- [ ] Git history reads as a deliberate progression
- [ ] Dockerfile + container smoke run (optional)

## Open questions

- Truncated final frame — count it or not? Leaning "count if the header is whole".
- Free-format bitrate (index 0) — out of scope; reject with a clear message.
- Keep the `mp3-frames` CLI, or is the HTTP endpoint enough? Keep it only if it
  stays small and shares the core.
