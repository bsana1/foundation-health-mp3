# Requirements

What the service must do, and the constraints it is built under.

## Functional

- Expose `POST /file-upload` accepting an MP3 file as `multipart/form-data`.
- Parse the uploaded file and return the number of audio frames it contains as
  JSON, with the correct `Content-Type`:

  ```json
  { "frameCount": 6089 }
  ```

- Correctly count frames for **MPEG Version 1, Audio Layer III** streams — the
  format of essentially all `.mp3` files in practice.
- Fail clearly, with a useful message and an appropriate status code, when the
  upload is missing, not an MP3, a different MPEG format, or corrupt.

## Out of scope

- MPEG Version 2 / 2.5, and Layers I and II. These are detected only far enough
  to reject them with a clear error.
- Free-format bitrate streams (bitrate signalled out of band).
- Decoding audio, reading tag metadata, or transcoding.

## Constraints

- **TypeScript**, Node.js.
- **MPEG frame parsing is implemented in-house.** No third-party MP3/MPEG
  parsing library — the frame walker, header decoding and tables are all ours.
  General-purpose packages (HTTP framework, utilities) are fine. This keeps the
  core logic free of supply-chain risk and fully under our control.
- The parse must be a genuine walk of the frame structure, not an estimate from
  file size or a trusted metadata field.

## Non-functional

- **Scales to large files.** Memory use must not grow with upload size — the file
  is streamed through the parser, never buffered whole or spooled to disk. A hard
  size cap (`MAX_UPLOAD_BYTES`) bounds cost per request.
- **Observable.** Structured request logging; a `/health` liveness endpoint.
- **Standardised tooling** for formatting, linting, type-checking and testing,
  enforced in CI. `main` stays green.

## Reference

The provided sample (`test/fixtures/foundationhealth-sample-mp3.mp3`) has a known
frame count of **6089**, confirmed with both `mediainfo` and
`ffprobe -count_frames`. It is used as an integration-test oracle. See
[`mp3-frame-structure.md`](mp3-frame-structure.md) for how that number is
defined and reached.
