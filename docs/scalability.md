# Scalability

The requirement: handle large files. The design answer is that the upload is
**streamed** through the parser and never materialised — so memory is a function
of the chunk size, not the file size.

## Where the memory goes

```
socket ──► @fastify/multipart ──► file stream ──► Mp3FrameCounter ──► { frameCount }
              (finds boundaries,      (~64 KiB       (carry-over ≤ one
               streams the part)       chunks)        frame ≈ 1.5 KiB)
```

- `@fastify/multipart` hands the route the file part as a `Readable` — it does
  not spool to memory or disk (`limits.fileSize` aside).
- `countMp3Frames` pulls one chunk at a time (`for await`), pushes it into the
  counter, and drops it.
- `Mp3FrameCounter` keeps only a carry-over of at most one frame between chunks,
  and copies that slice out (`Buffer.from(subarray)`) so the previous chunk is
  released. A large leading ID3v2 tag (album art) is skipped **incrementally**,
  not buffered.

Working set ≈ one chunk + one frame + a handful of integers, for any file size.

## Measured — `scripts/perf-memory.ts`

Feeding synthetic frames as 64 KiB chunks (Node 26, M-series Mac,
`NODE_OPTIONS=--expose-gc`):

| through                              | streamed | RSS peak growth | throughput |
| ------------------------------------ | -------- | --------------: | ---------: |
| `countMp3Frames` directly            | 1 GB     |       **+0 MB** | ~4700 MB/s |
| `countMp3Frames` directly            | 4 GB     |       **+0 MB** | ~4400 MB/s |
| `POST /file-upload` (full HTTP path) | 2 GB     |       **+0 MB** | ~2800 MB/s |

RSS baseline ~93 MB (Node + Fastify); it does not move as gigabytes flow
through. `test/mp3/memory.test.ts` is the CI guard — it streams ~150 MB and
asserts heap growth stays under 20 MB.

```
npm run perf:memory          # ~1 GB through the counter
npm run perf:memory -- 2 --http   # ~2 GB through the endpoint
```

## Chunk size vs throughput

The counter does one `Buffer.concat(carry, chunk)` per `push`. That is cheap at
realistic chunk sizes and only degrades at pathologically small ones:

| chunk size            | throughput |
| --------------------- | ---------: |
| 64 KiB (typical HTTP) | ~3500 MB/s |
| 4 KiB                 | ~2900 MB/s |
| 512 B                 |  ~900 MB/s |
| 64 B                  |  ~170 MB/s |

Real upload chunks are 16–64 KiB, where throughput far exceeds any network link,
so replacing the concat with an offset/ring buffer is **not worth doing** — it
would add complexity to guard against a case that does not occur. Noted in
`docs/TASKS.md` as a revisit-if-needed.

## Concurrency

Every request gets its own `Mp3FrameCounter`, its own carry buffer, and its own
multipart parser — there is no module-level mutable state, and `config` is read
once and never changed. Node's single thread means concurrent requests only
interleave at `await` points (waiting for the next chunk), so no data race is
possible.

`test/http/concurrency.test.ts` proves it: 48 overlapping uploads (different
files, different sizes, some that must 422) plus 24 concurrent uploads of the
same file — every response is correct for _its own_ request, no count or error
bleeds between them. Also verified with 20 parallel `curl` uploads against a
running server.

N concurrent uploads use N × (one chunk + one frame) — still bounded per request.

## Bounds that keep a request finite

- `MAX_UPLOAD_BYTES` (default 250 MiB) → `413` before an oversized upload is
  fully read.
- `maxResyncBytes` (default 128 KiB) → `CORRUPT_STREAM` rather than scanning an
  entire large non-MP3 that happens to start frame-like.
- One file part per request (`400 TOO_MANY_FILES`).

## Not covered here

Throughput-under-concurrency and max requests/second depend entirely on the
deployment (instance size, replica count, load balancer), so there are no RPS
numbers here. The claim this document backs is narrower and testable: **one
request, however large the file, runs in constant memory.**
