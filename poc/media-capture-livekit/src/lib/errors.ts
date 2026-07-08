export type NormalizedError = {
  code: string;
  message: string;
  details?: string;
  recoverable: boolean;
};

const domExceptionCodes: Record<string, string> = {
  AbortError: 'ABORTED',
  InvalidStateError: 'INVALID_STATE',
  NotAllowedError: 'NOT_ALLOWED',
  NotFoundError: 'NOT_FOUND',
  NotReadableError: 'NOT_READABLE',
  NotSupportedError: 'NOT_SUPPORTED',
  SecurityError: 'SECURITY_ERROR',
  TimeoutError: 'TIMEOUT'
};

export function normalizeError(error: unknown, fallbackMessage = 'Unexpected error'): NormalizedError {
  if (isNormalizedError(error)) {
    return error;
  }

  if (error instanceof DOMException) {
    const code = domExceptionCodes[error.name] ?? 'DOM_EXCEPTION';
    return {
      code,
      message: error.message || fallbackMessage,
      recoverable: code !== 'SECURITY_ERROR'
    };
  }

  if (error instanceof Error) {
    return {
      code: error.name && error.name !== 'Error' ? toConstantName(error.name) : 'ERROR',
      message: error.message || fallbackMessage,
      recoverable: true
    };
  }

  if (typeof error === 'string' && error.trim().length > 0) {
    return {
      code: 'ERROR',
      message: error,
      recoverable: true
    };
  }

  return {
    code: 'UNKNOWN',
    message: fallbackMessage,
    recoverable: true
  };
}

export function createPocError(
  code: string,
  message: string,
  options: Pick<NormalizedError, 'details' | 'recoverable'> = { recoverable: true }
): NormalizedError {
  return {
    code,
    message,
    details: options.details,
    recoverable: options.recoverable
  };
}

function isNormalizedError(error: unknown): error is NormalizedError {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    'message' in error &&
    'recoverable' in error
  );
}

function toConstantName(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toUpperCase();
}
