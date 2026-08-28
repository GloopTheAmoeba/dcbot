/**
 * Structured Logger with Secret Redaction
 * Ensures tokens, credentials, and sensitive secrets are never logged.
 */

type LogLevel = 'info' | 'warn' | 'error' | 'debug';

const SECRET_PATTERNS = [
  /token/i,
  /password/i,
  /secret/i,
  /authorization/i,
  /cookie/i,
  /key/i,
];

function sanitize(obj: unknown): unknown {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === 'string') {
    // Redact bot token style strings if detected
    if (obj.length > 20 && (obj.includes('MTA') || obj.includes('Nzg') || obj.includes('bot'))) {
      return '[REDACTED_TOKEN]';
    }
    return obj;
  }
  if (typeof obj !== 'object') return obj;

  if (Array.isArray(obj)) {
    return obj.map(sanitize);
  }

  const sanitizedObj: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    if (SECRET_PATTERNS.some((pattern) => pattern.test(key))) {
      sanitizedObj[key] = '[REDACTED]';
    } else {
      sanitizedObj[key] = sanitize(value);
    }
  }
  return sanitizedObj;
}

export const logger = {
  info(message: string, context?: Record<string, unknown>) {
    console.log(
      JSON.stringify({
        level: 'info',
        timestamp: new Date().toISOString(),
        message,
        ...(context ? (sanitize(context) as Record<string, unknown>) : {}),
      })
    );
  },

  warn(message: string, context?: Record<string, unknown>) {
    console.warn(
      JSON.stringify({
        level: 'warn',
        timestamp: new Date().toISOString(),
        message,
        ...(context ? (sanitize(context) as Record<string, unknown>) : {}),
      })
    );
  },

  error(message: string, error?: unknown, context?: Record<string, unknown>) {
    const errDetails =
      error instanceof Error
        ? { errorMessage: error.message, name: error.name }
        : { errorMessage: String(error) };

    console.error(
      JSON.stringify({
        level: 'error',
        timestamp: new Date().toISOString(),
        message,
        ...errDetails,
        ...(context ? (sanitize(context) as Record<string, unknown>) : {}),
      })
    );
  },

  debug(message: string, context?: Record<string, unknown>) {
    if (process.env.NODE_ENV !== 'production') {
      console.debug(
        JSON.stringify({
          level: 'debug',
          timestamp: new Date().toISOString(),
          message,
          ...(context ? (sanitize(context) as Record<string, unknown>) : {}),
        })
      );
    }
  },
};
