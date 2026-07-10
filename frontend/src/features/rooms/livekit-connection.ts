import type { ConnectionState, Room as LiveKitRoom } from "livekit-client";

import type { LiveKitTokenResponse } from "./room-api";

export type LiveKitConnectionStatus =
  "idle" | "connecting" | "connected" | "reconnecting" | "disconnected" | "error";

export type LiveKitConnection = {
  disconnect: () => void;
  room: LiveKitRoom;
};

export type LiveKitConnectionHandlers = {
  onError: (message: string) => void;
  onStatusChange: (status: LiveKitConnectionStatus) => void;
};

export async function connectLiveKitRoom(
  token: LiveKitTokenResponse,
  handlers: LiveKitConnectionHandlers,
): Promise<LiveKitConnection> {
  const { Room, RoomEvent } = await import("livekit-client");
  const room = new Room();

  room
    .on(RoomEvent.ConnectionStateChanged, (state: ConnectionState) => {
      handlers.onStatusChange(toStatus(state));
    })
    .on(RoomEvent.Reconnecting, () => handlers.onStatusChange("reconnecting"))
    .on(RoomEvent.Reconnected, () => handlers.onStatusChange("connected"))
    .on(RoomEvent.Disconnected, () => handlers.onStatusChange("disconnected"));

  try {
    await room.connect(token.liveKitUrl, token.token);
    handlers.onStatusChange("connected");
  } catch (error) {
    room.disconnect();
    handlers.onStatusChange("error");
    handlers.onError(error instanceof Error ? error.message : "LiveKit недоступен.");
    throw error;
  }

  return {
    disconnect: () => {
      room.disconnect();
    },
    room,
  };
}

function toStatus(state: ConnectionState): LiveKitConnectionStatus {
  switch (state) {
    case "connected":
      return "connected";
    case "connecting":
      return "connecting";
    case "reconnecting":
      return "reconnecting";
    case "disconnected":
      return "disconnected";
    default:
      return "idle";
  }
}
