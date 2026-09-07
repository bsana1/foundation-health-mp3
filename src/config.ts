/**
 * Runtime configuration — the single source of truth for what the service reads
 * from the environment and what it falls back to. Read once at startup.
 *
 * Every value has a working default (see `DEFAULT_CONFIG`), so the app runs with
 * no setup. `process.env` is the only interface — this module is the only code
 * that reads it, and it produces one typed `AppConfig` that is passed through
 * the rest of the app.
 *
 * How `process.env` gets populated:
 *   - local dev: an optional `.env` file (copy `.env.example`), loaded by the
 *     `--env-file-if-exists` flag in the `dev` / `start` npm scripts
 *   - QA / prod: the deployment platform (container env, orchestrator
 *     config/secrets). No `.env` file, no committed per-environment files.
 */

export interface AppConfig {
  /** Bind address. Env: `HOST`. */
  readonly host: string;
  /** Listen port. Env: `PORT`. */
  readonly port: number;
  /** Hard upper bound on an accepted upload, in bytes; larger uploads get 413. Env: `MAX_UPLOAD_BYTES`. */
  readonly maxUploadBytes: number;
  /** Pino log level (`fatal`..`trace`, or `silent`). Env: `LOG_LEVEL`. */
  readonly logLevel: string;
}

const MiB = 1024 * 1024;

/** The values used when the corresponding environment variable is unset. */
export const DEFAULT_CONFIG: AppConfig = {
  host: '0.0.0.0',
  port: 3000,
  maxUploadBytes: 250 * MiB,
  logLevel: 'info',
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return {
    host: env.HOST ?? DEFAULT_CONFIG.host,
    port: positiveInt('PORT', env.PORT, DEFAULT_CONFIG.port),
    maxUploadBytes: positiveInt(
      'MAX_UPLOAD_BYTES',
      env.MAX_UPLOAD_BYTES,
      DEFAULT_CONFIG.maxUploadBytes,
    ),
    logLevel: env.LOG_LEVEL ?? DEFAULT_CONFIG.logLevel,
  };
}

function positiveInt(name: string, raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === '') return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Environment variable ${name} must be a positive integer, got "${raw}"`);
  }
  return parsed;
}
