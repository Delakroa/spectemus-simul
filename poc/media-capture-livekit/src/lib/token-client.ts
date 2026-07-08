import { normalizeError } from './errors';
import type { Role, TokenResponse } from '../types';

export type TokenRequest = {
  endpoint: string;
  room: string;
  identity: string;
  role: Role;
};

export async function requestLiveKitToken(request: TokenRequest): Promise<TokenResponse> {
  const url = new URL(request.endpoint);
  url.searchParams.set('room', request.room);
  url.searchParams.set('identity', request.identity);
  url.searchParams.set('role', request.role);

  let response: Response;
  try {
    response = await fetch(url);
  } catch (error) {
    const normalized = normalizeError(error, 'Token endpoint is unavailable.');
    throw new Error(`${normalized.message} (${normalized.code})`);
  }

  const payload = await readJsonSafely(response);

  if (!response.ok) {
    const message = typeof payload?.error === 'string' ? payload.error : `Token request failed with HTTP ${response.status}.`;
    throw new Error(message);
  }

  if (!isTokenResponse(payload)) {
    throw new Error('Token endpoint returned an invalid response.');
  }

  return payload;
}

async function readJsonSafely(response: Response): Promise<Record<string, unknown> | null> {
  try {
    return (await response.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function isTokenResponse(payload: unknown): payload is TokenResponse {
  return (
    typeof payload === 'object' &&
    payload !== null &&
    typeof (payload as TokenResponse).token === 'string' &&
    typeof (payload as TokenResponse).liveKitUrl === 'string' &&
    typeof (payload as TokenResponse).room === 'string' &&
    typeof (payload as TokenResponse).identity === 'string'
  );
}
