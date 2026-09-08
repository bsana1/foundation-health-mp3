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

/** Known Fastify framework error codes → the status and code we surface. */
const FRAMEWORK_ERRORS: Record<string, { status: number; code: string }> = {
  FST_ERR_CTP_INVALID_MEDIA_TYPE: { status: 415, code: 'UNSUPPORTED_MEDIA_TYPE' },
  FST_ERR_CTP_EMPTY_TYPE: { status: 415, code: 'UNSUPPORTED_MEDIA_TYPE' },
  FST_REQ_FILE_TOO_LARGE: { status: 413, code: 'FILE_TOO_LARGE' },
  FST_FILES_LIMIT: { status: 400, code: 'TOO_MANY_FILES' },
  FST_PARTS_LIMIT: { status: 400, code: 'TOO_MANY_PARTS' },
};

export async function buildApp(config: AppConfig): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: config.logLevel },
    // The body is always a stream, never JSON; keep the default parser's limit low.
    bodyLimit: 1024,
  });

  await app.register(multipart, {
    limits: {
      files: 1,
      fileSize: config.maxUploadBytes,
    },
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
