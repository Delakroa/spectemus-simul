import { describe, expect, it } from 'vitest';
import { createPocError, normalizeError } from './errors';

describe('normalizeError', () => {
  it('keeps existing normalized errors', () => {
    const error = createPocError('CAPTURE_STREAM_UNSUPPORTED', 'No captureStream.', { recoverable: false });

    expect(normalizeError(error)).toEqual(error);
  });

  it('normalizes DOMException names to stable codes', () => {
    const error = new DOMException('Autoplay denied.', 'NotAllowedError');

    expect(normalizeError(error)).toEqual({
      code: 'NOT_ALLOWED',
      message: 'Autoplay denied.',
      recoverable: true
    });
  });

  it('normalizes regular Error instances', () => {
    class TokenEndpointError extends Error {
      constructor(message: string) {
        super(message);
        this.name = 'TokenEndpointError';
      }
    }

    const result = normalizeError(new TokenEndpointError('Token failed.'));

    expect(result.code).toBe('TOKEN_ENDPOINT_ERROR');
    expect(result.message).toBe('Token failed.');
    expect(result.recoverable).toBe(true);
  });

  it('uses a fallback for unknown values', () => {
    expect(normalizeError(null, 'Fallback message.')).toEqual({
      code: 'UNKNOWN',
      message: 'Fallback message.',
      recoverable: true
    });
  });
});
