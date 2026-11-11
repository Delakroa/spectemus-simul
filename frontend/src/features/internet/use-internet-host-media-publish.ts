import { useCallback, useEffect, useRef, useState } from "react";
import type { Room as LiveKitRoom } from "livekit-client";

import {
  desktopMediaUrl,
  type DesktopMediaSelection,
  type SpectemusDesktopApi,
} from "../rooms/desktop-media";
import {
  diagnoseMediaSource,
  FileDiagnosticsFailure,
  type FileDiagnosticsResult,
} from "../rooms/file-diagnostics";
import {
  FilePublicationFailure,
  publishFileToLiveKit,
  stopFilePublication,
  type FilePublication,
} from "../rooms/file-publication";
import { createHostSeekController, type HostSeekController } from "../rooms/host-seek-controller";
import {
  createHostPlaybackStatePublisher,
  type HostPlaybackStatePublisher,
  type PlaybackEvent,
} from "../rooms/playback-state";

export type InternetHostMediaStatus =
  "idle" | "checking" | "normalizing" | "ready" | "publishing" | "live" | "error";

export type InternetHostPlaybackStatus = "idle" | "playing" | "paused" | "ended";

export type InternetHostMediaState = {
  displayName: string | null;
  error: string | null;
  playbackCurrentTime: number;
  playbackDuration: number | null;
  playbackError: string | null;
  playbackStatus: InternetHostPlaybackStatus;
  preparationProgress: number | null;
  status: InternetHostMediaStatus;
  trackCount: number;
};

const INITIAL_STATE: InternetHostMediaState = {
  displayName: null,
  error: null,
  playbackCurrentTime: 0,
  playbackDuration: null,
  playbackError: null,
  playbackStatus: "idle",
  preparationProgress: null,
  status: "idle",
  trackCount: 0,
};

function desktopMediaApi(): SpectemusDesktopApi | null {
  const desktop = window.spectemusDesktop;
  if (!desktop?.pickMediaFile || !desktop.releaseMedia) {
    return null;
  }
  return desktop;
}

function isBusySelectionStatus(status: InternetHostMediaStatus) {
  return (
    status === "live" ||
    status === "publishing" ||
    status === "checking" ||
    status === "normalizing"
  );
}

function isNormalizableDiagnosticFailure(error: unknown) {
  return (
    error instanceof FileDiagnosticsFailure &&
    [
      "UNSUPPORTED_FORMAT",
      "METADATA_LOAD_FAILED",
      "CAPTURE_PREVIEW_FAILED",
      "NO_VIDEO_TRACK",
    ].includes(error.code)
  );
}

export function useInternetHostMediaPublish(options: {
  enabled: boolean;
  liveKitStatus: string;
  room: LiveKitRoom | null;
}) {
  const { enabled, liveKitStatus, room } = options;
  const [state, setState] = useState<InternetHostMediaState>(INITIAL_STATE);
  const desktopMediaIdRef = useRef<string | null>(null);
  const fileResultRef = useRef<FileDiagnosticsResult | null>(null);
  const publicationRef = useRef<FilePublication | null>(null);
  const playbackPublisherRef = useRef<HostPlaybackStatePublisher | null>(null);
  const seekControllerRef = useRef<HostSeekController | null>(null);
  const playbackTrackingCleanupRef = useRef<(() => void) | null>(null);
  const playbackRevisionRef = useRef(0);
  const prepareRequestIdRef = useRef(0);
  const publishRequestIdRef = useRef(0);
  const statusRef = useRef<InternetHostMediaStatus>(state.status);
  statusRef.current = state.status;
  const roomRef = useRef(room);
  roomRef.current = room;

  const releaseDesktopMedia = useCallback((id: string | null) => {
    if (!id) {
      return;
    }
    void Promise.resolve(window.spectemusDesktop?.releaseMedia?.(id)).catch(() => {});
  }, []);

  const tearDownPlaybackSync = useCallback((event: PlaybackEvent = "stop") => {
    playbackTrackingCleanupRef.current?.();
    playbackTrackingCleanupRef.current = null;
    seekControllerRef.current?.dispose();
    seekControllerRef.current = null;
    const publisher = playbackPublisherRef.current;
    playbackPublisherRef.current = null;
    publisher?.disconnect(event);
  }, []);

  const startPlaybackSync = useCallback(
    (liveRoom: LiveKitRoom, publication: FilePublication, fileName: string) => {
      tearDownPlaybackSync("stop");
      const videoElement = publication.videoElement;
      playbackPublisherRef.current = createHostPlaybackStatePublisher(
        liveRoom,
        videoElement,
        fileName,
        {
          initialRevision: playbackRevisionRef.current,
          onRevisionChange: (revision) => {
            playbackRevisionRef.current = revision;
          },
        },
      );
      seekControllerRef.current = createHostSeekController(videoElement);

      const syncPlaybackUi = () => {
        setState((current) => ({
          ...current,
          playbackCurrentTime: Number.isFinite(videoElement.currentTime)
            ? Math.max(0, videoElement.currentTime)
            : 0,
          playbackDuration: Number.isFinite(videoElement.duration) ? videoElement.duration : null,
          playbackStatus: videoElement.ended ? "ended" : videoElement.paused ? "paused" : "playing",
        }));
      };

      const handlePlay = () => {
        setState((current) => ({
          ...current,
          playbackError: null,
          playbackStatus: "playing",
        }));
      };
      const handlePause = () => {
        setState((current) => ({
          ...current,
          playbackStatus: videoElement.ended ? "ended" : "paused",
        }));
      };
      const handleEnded = () => {
        const duration = Number.isFinite(videoElement.duration) ? videoElement.duration : null;
        setState((current) => ({
          ...current,
          playbackCurrentTime: duration ?? current.playbackCurrentTime,
          playbackDuration: duration ?? current.playbackDuration,
          playbackStatus: "ended",
        }));
      };
      const handleTimeUpdate = () => {
        setState((current) => ({
          ...current,
          playbackCurrentTime: Number.isFinite(videoElement.currentTime)
            ? Math.max(0, videoElement.currentTime)
            : current.playbackCurrentTime,
        }));
      };
      const handleDurationChange = () => {
        setState((current) => ({
          ...current,
          playbackDuration: Number.isFinite(videoElement.duration)
            ? videoElement.duration
            : current.playbackDuration,
        }));
      };

      videoElement.addEventListener("play", handlePlay);
      videoElement.addEventListener("pause", handlePause);
      videoElement.addEventListener("ended", handleEnded);
      videoElement.addEventListener("timeupdate", handleTimeUpdate);
      videoElement.addEventListener("durationchange", handleDurationChange);
      playbackTrackingCleanupRef.current = () => {
        videoElement.removeEventListener("play", handlePlay);
        videoElement.removeEventListener("pause", handlePause);
        videoElement.removeEventListener("ended", handleEnded);
        videoElement.removeEventListener("timeupdate", handleTimeUpdate);
        videoElement.removeEventListener("durationchange", handleDurationChange);
      };
      syncPlaybackUi();
    },
    [tearDownPlaybackSync],
  );

  const stopPublication = useCallback(() => {
    publishRequestIdRef.current += 1;
    tearDownPlaybackSync("stop");
    const publication = publicationRef.current;
    publicationRef.current = null;
    if (publication) {
      stopFilePublication(roomRef.current, publication);
    }
    setState((current) => ({
      ...current,
      error: null,
      playbackCurrentTime: 0,
      playbackDuration: null,
      playbackError: null,
      playbackStatus: "idle",
      status: fileResultRef.current ? "ready" : "idle",
      trackCount: 0,
    }));
  }, [tearDownPlaybackSync]);

  const clearAll = useCallback(() => {
    prepareRequestIdRef.current += 1;
    publishRequestIdRef.current += 1;
    tearDownPlaybackSync("stop");
    playbackRevisionRef.current = 0;
    const publication = publicationRef.current;
    publicationRef.current = null;
    if (publication) {
      stopFilePublication(roomRef.current, publication);
    }
    fileResultRef.current = null;
    const mediaId = desktopMediaIdRef.current;
    desktopMediaIdRef.current = null;
    releaseDesktopMedia(mediaId);
    setState(INITIAL_STATE);
  }, [releaseDesktopMedia, tearDownPlaybackSync]);

  const play = useCallback(async () => {
    const publication = publicationRef.current;
    if (!publication || statusRef.current !== "live") {
      return;
    }
    try {
      await publication.videoElement.play();
      // stop / republish могли сменить публикацию, пока play() ещё висел.
      if (publicationRef.current !== publication) {
        return;
      }
      setState((current) => ({
        ...current,
        playbackError: null,
      }));
    } catch (error: unknown) {
      if (publicationRef.current !== publication) {
        return;
      }
      if (isBenignPlayInterruption(error)) {
        setState((current) => ({
          ...current,
          playbackError: null,
        }));
        return;
      }
      setState((current) => ({
        ...current,
        playbackError:
          error instanceof Error ? error.message : "Не удалось начать воспроизведение.",
        playbackStatus: "paused",
      }));
    }
  }, []);

  const pause = useCallback(() => {
    publicationRef.current?.videoElement.pause();
  }, []);

  const seek = useCallback((seconds: number, onComplete?: () => void) => {
    seekControllerRef.current?.seek(seconds, onComplete);
  }, []);

  useEffect(() => {
    if (!enabled) {
      clearAll();
    }
  }, [clearAll, enabled]);

  useEffect(() => {
    if (!enabled) {
      return;
    }
    if (liveKitStatus === "disconnected" || liveKitStatus === "error") {
      clearAll();
    }
  }, [clearAll, enabled, liveKitStatus]);

  useEffect(() => {
    if (!enabled) {
      return;
    }
    const desktop = desktopMediaApi();
    if (!desktop?.onMediaNormalizationProgress) {
      return;
    }
    return desktop.onMediaNormalizationProgress(({ id, progress }) => {
      if (desktopMediaIdRef.current !== id) {
        return;
      }
      setState((current) =>
        current.status === "normalizing"
          ? {
              ...current,
              preparationProgress: Math.min(100, Math.max(0, Math.round(progress))),
            }
          : current,
      );
    });
  }, [enabled]);

  useEffect(() => {
    return () => {
      clearAll();
    };
  }, [clearAll]);

  const selectAndPrepare = useCallback(async () => {
    const desktop = desktopMediaApi();
    if (!enabled || !desktop?.pickMediaFile) {
      return;
    }
    // Как в LAN: во время показа сначала явная остановка, иначе новый выбор
    // снимет live-публикацию и временную копию раньше, чем гость успеет
    // отключиться от текущих tracks.
    if (isBusySelectionStatus(statusRef.current)) {
      return;
    }

    const requestIdBeforePick = prepareRequestIdRef.current;
    let selection: DesktopMediaSelection | null;
    try {
      selection = await desktop.pickMediaFile();
    } catch (caught: unknown) {
      if (prepareRequestIdRef.current !== requestIdBeforePick) {
        return;
      }
      setState({
        ...INITIAL_STATE,
        displayName: null,
        error: prepareErrorMessage(caught),
        status: "error",
      });
      return;
    }

    if (!selection) {
      return;
    }

    // clearAll / unmount во время системного диалога уже освободили текущие
    // ресурсы; поздний выбор нельзя регистрировать — только release.
    if (prepareRequestIdRef.current !== requestIdBeforePick) {
      releaseDesktopMedia(selection.id);
      return;
    }

    const requestId = prepareRequestIdRef.current + 1;
    prepareRequestIdRef.current = requestId;
    publishRequestIdRef.current += 1;

    tearDownPlaybackSync("stop");
    const previousPublication = publicationRef.current;
    publicationRef.current = null;
    if (previousPublication) {
      stopFilePublication(roomRef.current, previousPublication);
    }

    const previousMediaId = desktopMediaIdRef.current;
    desktopMediaIdRef.current = selection.id;
    if (previousMediaId && previousMediaId !== selection.id) {
      releaseDesktopMedia(previousMediaId);
    }
    fileResultRef.current = null;

    setState({
      ...INITIAL_STATE,
      displayName: selection.displayName,
      status: "checking",
    });

    try {
      const prepared = await prepareDesktopSelection(selection, desktop, (progressStatus) => {
        if (prepareRequestIdRef.current !== requestId) {
          return;
        }
        setState((current) => ({
          ...current,
          error: null,
          preparationProgress:
            progressStatus === "normalizing" ? (current.preparationProgress ?? 0) : null,
          status: progressStatus,
        }));
      });

      if (prepareRequestIdRef.current !== requestId) {
        releaseDesktopMedia(selection.id);
        if (prepared.mediaId !== selection.id) {
          releaseDesktopMedia(prepared.mediaId);
        }
        return;
      }

      desktopMediaIdRef.current = prepared.mediaId;
      fileResultRef.current = prepared.result;
      setState({
        ...INITIAL_STATE,
        displayName: prepared.result.displayName,
        status: "ready",
      });
    } catch (caught: unknown) {
      if (prepareRequestIdRef.current !== requestId) {
        return;
      }
      fileResultRef.current = null;
      const mediaId = desktopMediaIdRef.current;
      desktopMediaIdRef.current = null;
      releaseDesktopMedia(mediaId);
      setState({
        ...INITIAL_STATE,
        displayName: selection.displayName,
        error: prepareErrorMessage(caught),
        status: "error",
      });
    }
  }, [enabled, releaseDesktopMedia, tearDownPlaybackSync]);

  const publish = useCallback(async () => {
    if (!enabled) {
      return;
    }
    const file = fileResultRef.current;
    const liveRoom = roomRef.current;
    if (!file) {
      setState((current) => ({
        ...current,
        error: "Сначала выберите видеофайл.",
        status: "error",
        trackCount: 0,
      }));
      return;
    }
    if (!liveRoom || liveKitStatus !== "connected") {
      setState((current) => ({
        ...current,
        error: "Public LiveKit ещё не подключён.",
        status: "error",
        trackCount: 0,
      }));
      return;
    }

    const requestId = publishRequestIdRef.current + 1;
    publishRequestIdRef.current = requestId;
    tearDownPlaybackSync("stop");
    const previous = publicationRef.current;
    publicationRef.current = null;
    if (previous) {
      stopFilePublication(liveRoom, previous);
    }

    setState((current) => ({
      ...current,
      error: null,
      playbackCurrentTime: 0,
      playbackDuration: null,
      playbackError: null,
      playbackStatus: "idle",
      status: "publishing",
      trackCount: 0,
    }));

    try {
      const publication = await publishFileToLiveKit(liveRoom, file);
      if (publishRequestIdRef.current !== requestId) {
        stopFilePublication(liveRoom, publication);
        return;
      }
      publicationRef.current = publication;
      startPlaybackSync(liveRoom, publication, file.displayName);
      setState((current) => ({
        ...current,
        error: null,
        status: "live",
        trackCount: publication.tracks.length,
      }));
    } catch (caught: unknown) {
      if (publishRequestIdRef.current !== requestId) {
        return;
      }
      publicationRef.current = null;
      tearDownPlaybackSync("stop");
      setState((current) => ({
        ...current,
        error:
          caught instanceof FilePublicationFailure
            ? caught.message
            : "Не удалось опубликовать файл в public LiveKit.",
        playbackCurrentTime: 0,
        playbackDuration: null,
        playbackError: null,
        playbackStatus: "idle",
        status: "error",
        trackCount: 0,
      }));
    }
  }, [enabled, liveKitStatus, startPlaybackSync, tearDownPlaybackSync]);

  return {
    ...state,
    canUseDesktopMedia: Boolean(desktopMediaApi()),
    clearAll,
    pause,
    play,
    publish,
    seek,
    selectAndPrepare,
    stop: stopPublication,
  };
}

function isBenignPlayInterruption(error: unknown) {
  if (!(error instanceof Error)) {
    return false;
  }
  return error.name === "AbortError" || /interrupted|abort/i.test(error.message);
}

async function prepareDesktopSelection(
  selection: DesktopMediaSelection,
  desktop: SpectemusDesktopApi,
  onStatus: (status: "checking" | "normalizing") => void,
): Promise<{ mediaId: string; result: FileDiagnosticsResult }> {
  onStatus("checking");
  let directResult: FileDiagnosticsResult | null = null;
  let directFailure: unknown = null;
  try {
    directResult = await diagnoseMediaSource({
      displayName: selection.displayName,
      formatName: selection.playbackName,
      mimeType: "",
      objectUrl: desktopMediaUrl(selection.id),
    });
  } catch (error) {
    if (!isNormalizableDiagnosticFailure(error)) {
      throw error;
    }
    directFailure = error;
  }

  const needsNormalizedCopy =
    directResult === null || directResult.compatibility === "experimental";
  if (needsNormalizedCopy && desktop.normalizeMedia) {
    onStatus("normalizing");
    const normalized = await desktop.normalizeMedia(selection.id);
    const result = {
      ...(await diagnoseMediaSource({
        displayName: normalized.displayName,
        formatName: normalized.playbackName,
        mimeType: "video/mp4",
        objectUrl: desktopMediaUrl(normalized.id),
      })),
      normalization: "local" as const,
    };
    return { mediaId: normalized.id, result };
  }

  if (!directResult) {
    throw directFailure ?? new Error("Не удалось проверить видео.");
  }
  return { mediaId: selection.id, result: directResult };
}

function prepareErrorMessage(caught: unknown) {
  if (caught instanceof FileDiagnosticsFailure) {
    return caught.message;
  }
  if (caught instanceof Error) {
    return caught.message;
  }
  return "Не удалось подготовить видео.";
}
