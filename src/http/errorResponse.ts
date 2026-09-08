/**
 * The one error-response shape every route uses:
 *
 *   { "error": { "code": "NOT_AN_MP3", "message": "human-readable text" } }
 */

export interface ErrorBody {
  readonly error: {
    readonly code: string;
    readonly message: string;
  };
}

export function errorBody(code: string, message: string): ErrorBody {
  return { error: { code, message } };
}

/** JSON-schema for {@link ErrorBody}, for Fastify response validation. */
export const ERROR_BODY_SCHEMA = {
  type: 'object',
  required: ['error'],
  additionalProperties: false,
  properties: {
    error: {
      type: 'object',
      required: ['code', 'message'],
      additionalProperties: false,
      properties: {
        code: { type: 'string' },
        message: { type: 'string' },
      },
    },
  },
} as const;
