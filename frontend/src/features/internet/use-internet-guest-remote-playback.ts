import { useCallback, useEffect, useRef, useState } from "react";
import type { Room as LiveKitRoom } from "livekit-client";

import {
  createRemotePlaybackController,
  type RemotePlaybackController,
  type RemotePlaybackElements,
  type RemotePlaybackState,
} from "../rooms/remote-playback";

const IDLE_STATE: RemotePlaybackState = {
  audioTrackName: null,
  error: null,
  participantIdentity: null,
  status: "idle",
  trackCount: 0,
  videoTrackName: null,
};

export function useInternetGuestRemotePlayback(options: {
  enabled: boolean;
  room: LiveKitRoom | null;
}) {
  const { enabled, room } = options;
  const [state, setState] = useState<RemotePlaybackState>(IDLE_STATE);
  const controllerRef = useRef<RemotePlaybackController | null>(null);
  const elementsRef = useRef<RemotePlaybackElements>({
    audioElement: null,
    videoElement: null,
  });

  useEffect(() => {
    let cancelled = false;

    if (!enabled || !room) {
      const previous = controllerRef.current;
      controllerRef.current = null;
      previous?.disconnect();
      void Promise.resolve().then(() => {
        if (!cancelled) {
          setState(IDLE_STATE);
        }
      });
      return () => {
        cancelled = true;
      };
    }

    const controller = createRemotePlaybackController(room, {
      onStateChange: (next) => {
        if (!cancelled) {
          setState(next);
        }
      },
    });
    controllerRef.current = controller;
    controller.setElements(elementsRef.current);

    return () => {
      cancelled = true;
      if (controllerRef.current === controller) {
        controllerRef.current = null;
      }
      controller.disconnect();
    };
  }, [enabled, room]);

  const setElements = useCallback((elements: RemotePlaybackElements) => {
    elementsRef.current = elements;
    controllerRef.current?.setElements(elements);
  }, []);

  const resumePlayback = useCallback(async () => {
    await controllerRef.current?.resumeVideo();
    await controllerRef.current?.resumeAudio();
  }, []);

  return {
    ...state,
    resumePlayback,
    setElements,
  };
}

export function isInternetRemotePlaybackUserActionRequired(error: string | null) {
  if (!error) {
    return false;
  }
  return (
    error === "Браузер ждёт явного действия для запуска видео." ||
    /autoplay|user (didn't|did not) interact|NotAllowed|жест|действия/i.test(error)
  );
}

export function formatInternetRemotePlaybackStatus(status: RemotePlaybackState["status"]) {
  switch (status) {
    case "waiting":
      return "Ждём фильм";
    case "receiving":
      return "Воспроизводим";
    case "lost":
      return "Поток прервался";
    case "error":
      return "Ошибка просмотра";
    case "idle":
    default:
      return "Ждём фильм";
  }
}

export function formatInternetRemotePlaybackHint(
  status: RemotePlaybackState["status"],
  error: string | null,
) {
  if (status === "error" && isInternetRemotePlaybackUserActionRequired(error)) {
    return "Браузер ожидает подтверждения. Нажмите «Запустить просмотр».";
  }
  if (status === "error") {
    return error ?? "Не удалось воспроизвести поток.";
  }
  if (status === "lost") {
    return "Хозяин остановил публикацию или отключился.";
  }
  if (status === "waiting" || status === "idle") {
    return "Хозяин ещё не опубликовал фильм.";
  }
  return "";
}
