import { createServer } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { URL } from 'node:url';
import { AccessToken } from 'livekit-server-sdk';

type Role = 'host' | 'guest';

loadDotEnvFile();

const port = Number.parseInt(process.env.TOKEN_PORT ?? '3001', 10);
const liveKitUrl = process.env.LIVEKIT_URL ?? 'ws://127.0.0.1:17880';
const apiKey = process.env.LIVEKIT_API_KEY ?? 'devkey';
const apiSecret = process.env.LIVEKIT_API_SECRET;
const tokenTtlSeconds = Number.parseInt(process.env.TOKEN_TTL_SECONDS ?? '600', 10);

if (!apiSecret) {
  throw new Error('LIVEKIT_API_SECRET is required for the token endpoint.');
}

const server = createServer(async (request, response) => {
  const requestUrl = new URL(request.url ?? '/', `http://${request.headers.host ?? '127.0.0.1'}`);

  setCorsHeaders(response);

  if (request.method === 'OPTIONS') {
    response.writeHead(204);
    response.end();
    return;
  }

  if (request.method !== 'GET' || requestUrl.pathname !== '/token') {
    writeJson(response, 404, { error: 'Use GET /token?room=<room>&identity=<identity>&role=<host|guest>.' });
    return;
  }

  const room = requestUrl.searchParams.get('room') ?? '';
  const identity = requestUrl.searchParams.get('identity') ?? '';
  const role = requestUrl.searchParams.get('role') ?? '';

  const validationError = validateTokenInput(room, identity, role);
  if (validationError) {
    writeJson(response, 400, { error: validationError });
    return;
  }

  try {
    const token = await createToken(room, identity, role as Role);
    writeJson(response, 200, {
      token,
      liveKitUrl,
      room,
      identity,
      role,
      expiresInSeconds: tokenTtlSeconds
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to mint LiveKit token.';
    writeJson(response, 500, { error: message });
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log(`WT-001 token endpoint listening on http://127.0.0.1:${port}/token`);
  console.log(`LiveKit URL: ${liveKitUrl}`);
});

async function createToken(room: string, identity: string, role: Role): Promise<string> {
  const accessToken = new AccessToken(apiKey, apiSecret, {
    identity,
    ttl: tokenTtlSeconds
  });

  accessToken.addGrant({
    room,
    roomJoin: true,
    canPublish: role === 'host',
    canSubscribe: true,
    canPublishData: role === 'host'
  });

  return accessToken.toJwt();
}

function validateTokenInput(room: string, identity: string, role: string): string | null {
  if (!isSafeIdentifier(room)) {
    return 'room must be 1-80 chars and contain only letters, numbers, dot, underscore, colon, or dash.';
  }

  if (!isSafeIdentifier(identity)) {
    return 'identity must be 1-80 chars and contain only letters, numbers, dot, underscore, colon, or dash.';
  }

  if (role !== 'host' && role !== 'guest') {
    return 'role must be host or guest.';
  }

  return null;
}

function isSafeIdentifier(value: string): boolean {
  return /^[a-zA-Z0-9._:-]{1,80}$/.test(value);
}

function loadDotEnvFile(): void {
  const envPath = resolve(process.cwd(), '.env');
  if (!existsSync(envPath)) {
    return;
  }

  const content = readFileSync(envPath, 'utf8');
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const separatorIndex = trimmed.indexOf('=');
    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim().replace(/^['"]|['"]$/g, '');

    if (key) {
      process.env[key] = value;
    }
  }
}

function setCorsHeaders(response: import('node:http').ServerResponse): void {
  response.setHeader('Access-Control-Allow-Origin', 'http://127.0.0.1:5173');
  response.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  response.setHeader('Cache-Control', 'no-store');
}

function writeJson(response: import('node:http').ServerResponse, statusCode: number, body: unknown): void {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8'
  });
  response.end(JSON.stringify(body));
}
