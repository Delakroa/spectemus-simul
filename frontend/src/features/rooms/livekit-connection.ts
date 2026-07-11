import type {
  ConnectionQuality,
  ConnectionState,
  Participant,
  Room as LiveKitRoom,
} from "livekit-client";

import type { LiveKitTokenResponse } from "./room-api";

export type LiveKitConnectionStatus =
  "idle" | "connecting" | "connected" | "reconnecting" | "disconnected" | "error";

export type LiveKitConnectionQuality = "excellent" | "good" | "poor" | "lost" | "unknown";

export type LiveKitConnection = {
  disconnect: () => void;
  room: LiveKitRoom;
};

export type LiveKitConnectionHandlers = {
  onError: (message: string) => void;
  onStatusChange: (status: LiveKitConnectionStatus) => void;
  onQualityChange?: (quality: LiveKitConnectionQuality) => void;
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
    .on(RoomEvent.Disconnected, () => handlers.onStatusChange("disconnected"))
    .on(
      RoomEvent.ConnectionQualityChanged,
      (quality: ConnectionQuality, participant: Participant) => {
        if (participant.isLocal) {
          handlers.onQualityChange?.(toQuality(quality));
        }
      },
    );

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

function toQuality(quality: ConnectionQuality): LiveKitConnectionQuality {
  switch (String(quality)) {
    case "excellent":
      return "excellent";
    case "good":
      return "good";
    case "poor":
      return "poor";
    case "lost":
      return "lost";
    default:
      return "unknown";
  }
}
