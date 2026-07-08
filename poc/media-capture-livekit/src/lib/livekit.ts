import { Room } from 'livekit-client';
import { requestLiveKitToken } from './token-client';
import type { Role, TokenResponse } from '../types';

export type ConnectInput = {
  tokenEndpoint: string;
  roomName: string;
  identity: string;
  role: Role;
};

export type LiveKitConnection = {
  room: Room;
  tokenResponse: TokenResponse;
};

export async function connectToLiveKit(input: ConnectInput): Promise<LiveKitConnection> {
  const tokenResponse = await requestLiveKitToken({
    endpoint: input.tokenEndpoint,
    room: input.roomName,
    identity: input.identity,
    role: input.role
  });

  const room = new Room();
  await room.connect(tokenResponse.liveKitUrl, tokenResponse.token);

  return { room, tokenResponse };
}
