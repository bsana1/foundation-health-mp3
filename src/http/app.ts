/**
 * Builds the Fastify instance. Kept separate from the process entry point so
 * tests can create a fully wired app and call `.inject()` without opening a
 * socket.
 */

import multipart from '@fastify/multipart';
import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';

import type { AppConfig } from '../config.js';
import { Mp3AnalysisError } from '../mp3/index.js';
import { errorBody } from './errorResponse.js';
import { registerFileUploadRoute } from './routes/fileUpload.js';

/** Fastify framework error codes we translate to our own shape. */
const FRAMEWORK_ERRORS: Record<string, { status: number; code: string }> = {
  FST_ERR_CTP_INVALID_MEDIA_TYPE: { status: 415, code: 'UNSUPPORTED_MEDIA_TYPE' },
  FST_ERR_CTP_EMPTY_TYPE: { status: 415, code: 'UNSUPPORTED_MEDIA_TYPE' },
  FST_REQ_FILE_TOO_LARGE: { status: 413, code: 'FILE_TOO_LARGE' },
};

export async function buildApp(config: AppConfig): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: config.logLevel },
    // The upload body is consumed as a stream by @fastify/multipart; this only
    // caps the default JSON parser used by other routes.
    bodyLimit: 1024,
  });

  await app.register(multipart, {
    // One file per request is enforced in the route (it rejects a second file
    // part), not here — a hard `files: 1` limit would make busboy throw before
    // the route can send a clear TOO_MANY_FILES response.
    limits: { fileSize: config.maxUploadBytes },
  });

  app.setErrorHandler((error: FastifyError, request, reply) => {
    if (error instanceof Mp3AnalysisError) {
      reply.status(422).send(errorBody(error.code, error.message));
      return;
    }

    const known = error.code ? FRAMEWORK_ERRORS[error.code] : undefined;
    if (known) {
      reply.status(known.status).send(errorBody(known.code, error.message));
      return;
    }

    const status = error.statusCode ?? 500;
    if (status >= 500) {
      request.log.error({ err: error }, 'unhandled error');
      reply.status(500).send(errorBody('INTERNAL', 'Internal server error'));
      return;
    }

    // Other framework 4xx (validation, malformed request, …).
    reply.status(status).send(errorBody('BAD_REQUEST', error.message));
  });

  app.get('/health', () => ({ status: 'ok' }));

  registerFileUploadRoute(app);

  return app;
}
