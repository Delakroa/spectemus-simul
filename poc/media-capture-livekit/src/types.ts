export type Mode = 'host' | 'guest';
export type Role = 'host' | 'guest';

export type TokenResponse = {
  token: string;
  liveKitUrl: string;
  room: string;
  identity: string;
  role: Role;
  expiresInSeconds: number;
};

export type StatusLevel = 'idle' | 'ok' | 'warn' | 'error';
