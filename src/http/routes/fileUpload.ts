/**
 * POST /file-upload
 *
 * Accepts exactly one MP3 file as `multipart/form-data` and responds with the
 * number of MPEG-1 Layer III audio frames in it:
 *
 *   200  { "frameCount": 6089 }
 *
 * The upload is streamed straight into the frame counter — never buffered whole
 * or written to disk. Failures map to a single error shape (see
 * `docs/api-contract.md`):
 *
 *   400 NO_FILE                 no file part in the request
 *   400 TOO_MANY_FILES          more than one file part
 *   413 FILE_TOO_LARGE          upload exceeds MAX_UPLOAD_BYTES
 *   415 UNSUPPORTED_MEDIA_TYPE  request is not multipart/form-data
 *   422 NOT_AN_MP3 | UNSUPPORTED_MPEG_FORMAT | CORRUPT_STREAM
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { countMp3Frames, Mp3AnalysisError } from '../../mp3/index.js';
import { ERROR_BODY_SCHEMA, errorBody } from '../errorResponse.js';

/** @fastify/multipart's error code when an upload exceeds `limits.fileSize`. */
const FILE_TOO_LARGE_CODE = 'FST_REQ_FILE_TOO_LARGE';

const FRAME_COUNT_SCHEMA = {
  type: 'object',
  required: ['frameCount'],
  additionalProperties: false,
  properties: { frameCount: { type: 'integer', minimum: 0 } },
} as const;

export function registerFileUploadRoute(app: FastifyInstance): void {
  app.post(
    '/file-upload',
    {
      schema: {
        response: {
          200: FRAME_COUNT_SCHEMA,
          400: ERROR_BODY_SCHEMA,
          413: ERROR_BODY_SCHEMA,
          415: ERROR_BODY_SCHEMA,
          422: ERROR_BODY_SCHEMA,
        },
      },
    },
    handleFileUpload,
  );
}

async function handleFileUpload(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!request.isMultipart()) {
    reply
      .status(415)
      .send(errorBody('UNSUPPORTED_MEDIA_TYPE', 'Request must be multipart/form-data'));
    return;
  }

  let frameCount: number | undefined;

  try {
    for await (const part of request.parts()) {
      if (part.type !== 'file') continue;

      if (frameCount !== undefined) {
        // A second file part — the request is ambiguous. Remaining parts are
        // drained by @fastify/multipart once the response is sent.
        reply.status(400).send(errorBody('TOO_MANY_FILES', 'Send exactly one MP3 file'));
        return;
      }

      const result = await countMp3Frames(part.file);
      if (part.file.truncated) {
        reply.status(413).send(tooLargeBody());
        return;
      }

      request.log.info(
        { frameCount: result.frameCount, durationSeconds: result.durationSeconds },
        'counted mp3 frames',
      );
      frameCount = result.frameCount;
    }
  } catch (error) {
    if (error instanceof Mp3AnalysisError) {
      reply.status(422).send(errorBody(error.code, error.message));
      return;
    }
    if (isFileTooLarge(error)) {
      reply.status(413).send(tooLargeBody());
      return;
    }
    throw error; // unexpected — the app-level error handler turns it into a 500
  }

  if (frameCount === undefined) {
    reply.status(400).send(errorBody('NO_FILE', 'No file part was found in the multipart request'));
    return;
  }

  reply.send({ frameCount });
}

function tooLargeBody(): ReturnType<typeof errorBody> {
  return errorBody('FILE_TOO_LARGE', 'Uploaded file exceeds the maximum allowed size');
}

function isFileTooLarge(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === FILE_TOO_LARGE_CODE
  );
}
