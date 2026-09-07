# Architecture

## What this is

An HTTP service with one meaningful endpoint, `POST /file-upload`, that reads an
uploaded MP3 and returns how many MPEG-1 Audio Layer III frames it contains.
Requirements and constraints are in `docs/requirements.md`.

## Current state

Bootstrap only. The service runs, the endpoint accepts a `multipart/form-data`
upload and streams the file bytes, and it returns the final response shape
`{ "frameCount": <n> }` with a **stubbed value of `0`**. The MPEG parser is
Milestone 1 in `docs/TASKS.md`.

## Shape of the system

Two layers, kept deliberately separate:

```
HTTP layer (src/http/)          Core (src/mp3/, not yet built)
--------------------            ------------------------------
app.ts      build the Fastify   index.ts        countMp3Frames(source)
            instance, register  frame-counter   streaming state machine
            @fastify/multipart  frame-header    parse one 4-byte header
routes/     accept the upload,  id3             measure a leading ID3v2 tag
file-upload stream it into the  vbr-header      spot the Xing/Info metadata frame
            core, shape the     errors          typed error hierarchy
            response
```

`src/config.ts` reads configuration from the environment once at startup.
`src/index.ts` is the process entry point (load config, build app, listen,
handle signals) and is the only file that opens a socket — so tests build the
app with `buildApp()` and drive it with Fastify's `inject()`.

### Why this split

The hard part of this system is parsing MPEG frames. Keeping that as a pure
module with no knowledge of HTTP means it can be unit-tested directly with
synthetic byte streams, reused from a CLI, and reasoned about on its own. The
HTTP layer stays thin: content-type check, get the file stream, hand it to the
core, translate the result or error into a response.

## Data flow for a request (target design)

1. `@fastify/multipart` parses the `multipart/form-data` envelope incrementally
   and exposes the file part as a `Readable` stream. The full upload is never
   held in memory or written to disk.
2. The route pipes that stream into the frame counter. Each chunk (~64 KiB) is
   walked frame by frame: read the 4-byte header, compute the frame length from
   its bitrate / sample-rate / padding fields, advance by that length, increment
   the count. Bytes that don't fit a whole frame are carried to the next chunk.
3. Memory stays flat — one chunk plus at most one frame of carry-over —
   regardless of file size. A 1 GB upload uses the same working set as a 1 MB one.
4. At end of stream the counter returns `{ frameCount, ... }`; the route sends
   `{ "frameCount": n }` as JSON. A parse failure becomes a `4xx` with a
   `{ error: { code, message } }` body.

## Key decision: which number is "the frame count"

The provided sample has 6089 audio frames plus one leading Xing metadata frame
(6090 physical MPEG frames total). `mediainfo` and `ffprobe` both report 6089 —
they exclude the metadata frame. We match that. The reasoning and the mechanics
are in `docs/mp3-frame-structure.md` and `.agent/DECISIONS.md`.

## Dependencies

Runtime: `fastify` and `@fastify/multipart` only. The multipart parser decodes
the upload envelope, not MPEG data. Everything MPEG-related is hand-written by
design — see `docs/requirements.md`.
