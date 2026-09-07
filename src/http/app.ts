/**
 * Builds the Fastify instance. Kept separate from the process entry point so
 * tests can create a fully wired app and call `.inject()` without opening a
 * socket.
 */

import multipart from '@fastify/multipart';
import Fastify, { type FastifyInstance } from 'fastify';

import type { AppConfig } from '../config.js';
import { registerFileUploadRoute } from './routes/file-upload.js';

export async function buildApp(config: AppConfig): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: config.logLevel },
    // Reject absurd requests early; the body itself is a stream, not JSON.
    bodyLimit: 1024,
  });

  await app.register(multipart, {
    limits: {
      files: 1,
      fileSize: config.maxUploadBytes,
    },
  });

  app.get('/health', () => ({ status: 'ok' }));

  registerFileUploadRoute(app);

  return app;
}
