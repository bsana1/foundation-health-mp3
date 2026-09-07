/**
 * Process entry point: load config, build the app, listen, and shut down
 * cleanly on SIGINT/SIGTERM.
 */

import { loadConfig } from './config.js';
import { buildApp } from './http/app.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const app = await buildApp(config);

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      app.log.info({ signal }, 'shutting down');
      void app.close().then(() => process.exit(0));
    });
  }

  await app.listen({ host: config.host, port: config.port });
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
