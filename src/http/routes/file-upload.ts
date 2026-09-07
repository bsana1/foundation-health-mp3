/**
 * POST /file-upload
 *
 * BOOTSTRAP STUB. The route accepts a `multipart/form-data` MP3 upload, streams
 * the bytes to /dev/null so the request completes cleanly, and returns a
 * placeholder count. The real MPEG-1 Layer III frame parser is the next task —
 * see docs/TASKS.md. The response shape already matches the final contract so
 * wiring the parser in is a drop-in change.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

const FRAME_COUNT_RESPONSE_SCHEMA = {
  type: 'object',
  required: ['frameCount'],
  additionalProperties: false,
  properties: { frameCount: { type: 'integer', minimum: 0 } },
} as const;

export function registerFileUploadRoute(app: FastifyInstance): void {
  app.post(
    '/file-upload',
    { schema: { response: { 200: FRAME_COUNT_RESPONSE_SCHEMA } } },
    handleFileUpload,
  );
}

async function handleFileUpload(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<{ frameCount: number }> {
  if (!request.isMultipart()) {
    reply.status(415);
    throw new Error('Request must be multipart/form-data');
  }

  const upload = await request.file();
  if (upload === undefined) {
    reply.status(400);
    throw new Error('No file part was found in the multipart request');
  }

  // Drain the upload so the connection is not left half-read. Replaced by the
  // streaming frame counter in the next task.
  let bytes = 0;
  for await (const chunk of upload.file) {
    bytes += (chunk as Buffer).length;
  }

  request.log.info({ filename: upload.filename, bytes }, 'received upload (stub)');
  return { frameCount: 0 };
}
