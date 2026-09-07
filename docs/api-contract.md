# API contract

> Status: bootstrap. `POST /file-upload` returns the shape below with a **stub
> `frameCount` of `0`**. The values and the full error table are the target once
> the parser lands (see `docs/TASKS.md`).

## `POST /file-upload`

Counts the MPEG-1 Layer III audio frames in an uploaded MP3.

### Request

- Method: `POST`
- Content-Type: `multipart/form-data`
- Body: one file part. The field name is not significant; the first file part is
  used. Filename/extension is ignored — detection is by content.

```bash
curl -sS -X POST http://localhost:3000/file-upload \
  -F "file=@test/fixtures/foundationhealth-sample-mp3.mp3"
```

### Success — `200 OK`

`Content-Type: application/json; charset=utf-8`

```json
{ "frameCount": 6089 }
```

`frameCount` is an integer ≥ 0: the number of audio frames. A leading
Xing/Info/VBRI metadata frame is not included — see
`docs/mp3-frame-structure.md`.

### Errors (target)

One shape for all: `{ "error": { "code": "...", "message": "..." } }`

| Status | `code`                    | When                                                         |
| ------ | ------------------------- | ------------------------------------------------------------ |
| 400    | `NO_FILE`                 | multipart request with no file part                          |
| 413    | `FILE_TOO_LARGE`          | upload exceeds `MAX_UPLOAD_BYTES`                            |
| 415    | `UNSUPPORTED_MEDIA_TYPE`  | request is not `multipart/form-data`                         |
| 422    | `NOT_AN_MP3`              | no MPEG frame sync at the start of the stream                |
| 422    | `UNSUPPORTED_MPEG_FORMAT` | first frame is valid MPEG audio but not MPEG-1 Layer III     |
| 422    | `CORRUPT_STREAM`          | parsing started, then hit an unrecoverable run of junk bytes |

Currently implemented: `200` with stub count; `415` for non-multipart (Fastify);
`400` for a missing file part.

## `GET /health`

`200` with `{ "status": "ok" }`. Liveness only.

## Configuration

Environment variables, all optional, defined with their defaults in
[`../src/config.ts`](../src/config.ts):

| Variable           | Default     | Meaning                                  |
| ------------------ | ----------- | ---------------------------------------- |
| `HOST`             | `0.0.0.0`   | bind address                             |
| `PORT`             | `3000`      | listen port                              |
| `MAX_UPLOAD_BYTES` | `262144000` | reject larger uploads (250 MiB) with 413 |
| `LOG_LEVEL`        | `info`      | pino level (`fatal`…`trace`, `silent`)   |

Deployed environments override these through the platform (container env,
orchestrator config/secrets). The repo ships no per-environment files.
