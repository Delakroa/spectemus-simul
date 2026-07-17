import { afterEach, describe, expect, it, vi } from "vitest";

import {
  MEDIA_RECOVERY_SIGNAL_TOPIC,
  createMediaRecoverySignalController,
  decodeMediaRecoverySignal,
  encodeMediaRecoverySignal,
} from "./media-recovery-signal";

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("media-recovery-signal", () => {
  it("кодирует и декодирует privacy-safe recovery request", () => {
    const payload = {
      requestedAt: "2026-07-17T08:00:00.000Z",
      schemaVersion: 1 as const,
      type: "media.recovery.request" as const,
    };

    expect(decodeMediaRecoverySignal(encodeMediaRecoverySignal(payload))).toEqual(payload);
  });

  it("guest отправляет reliable request в отдельном LiveKit topic", async () => {
    const room = createRoom();
    const controller = createMediaRecoverySignalController(room as never, {
      isHost: false,
      onRecoveryRequested: vi.fn(),
    });

    await controller.requestRecovery();

    expect(room.localParticipant.publishData).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ reliable: true, topic: MEDIA_RECOVERY_SIGNAL_TOPIC }),
    );
    expect(
      decodeMediaRecoverySignal(room.localParticipant.publishData.mock.calls[0]?.[0] as Uint8Array),
    ).toEqual(
      expect.objectContaining({
        schemaVersion: 1,
        type: "media.recovery.request",
      }),
    );
  });

  it("host адресно подтверждает старт восстановления только запросившему guest-у", async () => {
    const room = createRoom();
    const controller = createMediaRecoverySignalController(room as never, {
      isHost: true,
      onRecoveryRequested: vi.fn(),
    });

    await controller.sendRecoveryStatus("guest-1", "started");

    expect(room.localParticipant.publishData).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        destinationIdentities: ["guest-1"],
        reliable: true,
        topic: MEDIA_RECOVERY_SIGNAL_TOPIC,
      }),
    );
    expect(
      decodeMediaRecoverySignal(room.localParticipant.publishData.mock.calls[0]?.[0] as Uint8Array),
    ).toEqual(
      expect.objectContaining({
        schemaVersion: 1,
        status: "started",
        type: "media.recovery.status",
      }),
    );
  });

  it("host принимает валидный request гостя и игнорирует повтор в cooldown", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-17T08:00:00.000Z"));
    const room = createRoom();
    const onRecoveryRequested = vi.fn();
    const controller = createMediaRecoverySignalController(room as never, {
      isHost: true,
      onRecoveryRequested,
    });
    const payload = encodeMediaRecoverySignal({
      requestedAt: "2026-07-17T08:00:00.000Z",
      schemaVersion: 1,
      type: "media.recovery.request",
    });

    room.emit(
      "dataReceived",
      payload,
      { identity: "guest-1" },
      undefined,
      MEDIA_RECOVERY_SIGNAL_TOPIC,
    );
    room.emit(
      "dataReceived",
      payload,
      { identity: "guest-1" },
      undefined,
      MEDIA_RECOVERY_SIGNAL_TOPIC,
    );

    expect(onRecoveryRequested).toHaveBeenCalledTimes(1);
    expect(onRecoveryRequested).toHaveBeenCalledWith({
      participantIdentity: "guest-1",
      requestedAt: "2026-07-17T08:00:00.000Z",
    });

    controller.disconnect();
    expect(room.off).toHaveBeenCalledWith("dataReceived", expect.any(Function));
  });

  it("guest принимает status только от ожидаемого host-а", () => {
    const room = createRoom();
    const onRecoveryStatus = vi.fn();
    createMediaRecoverySignalController(room as never, {
      expectedHostIdentity: "host-1",
      isHost: false,
      onRecoveryStatus,
    });
    const payload = encodeMediaRecoverySignal({
      occurredAt: "2026-07-17T08:01:00.000Z",
      schemaVersion: 1,
      status: "succeeded",
      type: "media.recovery.status",
    });

    room.emit(
      "dataReceived",
      payload,
      { identity: "guest-2" },
      undefined,
      MEDIA_RECOVERY_SIGNAL_TOPIC,
    );
    room.emit(
      "dataReceived",
      payload,
      { identity: "host-1" },
      undefined,
      MEDIA_RECOVERY_SIGNAL_TOPIC,
    );

    expect(onRecoveryStatus).toHaveBeenCalledTimes(1);
    expect(onRecoveryStatus).toHaveBeenCalledWith({
      occurredAt: "2026-07-17T08:01:00.000Z",
      status: "succeeded",
    });
  });

  it("host игнорирует некорректный payload", () => {
    const room = createRoom();
    const onRecoveryRequested = vi.fn();
    createMediaRecoverySignalController(room as never, {
      isHost: true,
      onRecoveryRequested,
    });

    room.emit(
      "dataReceived",
      new TextEncoder().encode('{"type":"media.recovery.request"}'),
      { identity: "guest-1" },
      undefined,
      MEDIA_RECOVERY_SIGNAL_TOPIC,
    );

    expect(onRecoveryRequested).not.toHaveBeenCalled();
  });
});

function createRoom() {
  const handlers = new Map<string, Set<(...args: unknown[]) => void>>();

  return {
    emit: (event: string, ...args: unknown[]) => {
      for (const handler of handlers.get(event) ?? []) {
        handler(...args);
      }
    },
    localParticipant: {
      publishData: vi.fn().mockResolvedValue(undefined),
    },
    off: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      handlers.get(event)?.delete(handler);
    }),
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      handlers.set(event, new Set([...(handlers.get(event) ?? []), handler]));
    }),
  };
}
