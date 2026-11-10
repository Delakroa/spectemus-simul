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

export type InternetHostMediaStatus =
  "idle" | "checking" | "normalizing" | "ready" | "publishing" | "live" | "error";

export type InternetHostMediaState = {
  displayName: string | null;
  error: string | null;
  preparationProgress: number | null;
  status: InternetHostMediaStatus;
  trackCount: number;
};

const INITIAL_STATE: InternetHostMediaState = {
  displayName: null,
  error: null,
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
  const prepareRequestIdRef = useRef(0);
  const publishRequestIdRef = useRef(0);
  const roomRef = useRef(room);
  roomRef.current = room;

  const releaseDesktopMedia = useCallback((id: string | null) => {
    if (!id) {
      return;
    }
    void Promise.resolve(window.spectemusDesktop?.releaseMedia?.(id)).catch(() => {});
  }, []);

  const stopPublication = useCallback(() => {
    publishRequestIdRef.current += 1;
    const publication = publicationRef.current;
    publicationRef.current = null;
    if (publication) {
      stopFilePublication(roomRef.current, publication);
    }
    setState((current) => ({
      ...current,
      error: null,
      status: fileResultRef.current ? "ready" : "idle",
      trackCount: 0,
    }));
  }, []);

  const clearAll = useCallback(() => {
    prepareRequestIdRef.current += 1;
    publishRequestIdRef.current += 1;
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
  }, [releaseDesktopMedia]);

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
      stopPublication();
    }
  }, [enabled, liveKitStatus, stopPublication]);

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

    const selection = await desktop.pickMediaFile();
    if (!selection) {
      return;
    }

    const requestId = prepareRequestIdRef.current + 1;
    prepareRequestIdRef.current = requestId;
    publishRequestIdRef.current += 1;

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
      displayName: selection.displayName,
      error: null,
      preparationProgress: null,
      status: "checking",
      trackCount: 0,
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
        displayName: prepared.result.displayName,
        error: null,
        preparationProgress: null,
        status: "ready",
        trackCount: 0,
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
        displayName: selection.displayName,
        error: prepareErrorMessage(caught),
        preparationProgress: null,
        status: "error",
        trackCount: 0,
      });
    }
  }, [enabled, releaseDesktopMedia]);

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
    const previous = publicationRef.current;
    publicationRef.current = null;
    if (previous) {
      stopFilePublication(liveRoom, previous);
    }

    setState((current) => ({
      ...current,
      error: null,
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
      setState((current) => ({
        ...current,
        error:
          caught instanceof FilePublicationFailure
            ? caught.message
            : "Не удалось опубликовать файл в public LiveKit.",
        status: "error",
        trackCount: 0,
      }));
    }
  }, [enabled, liveKitStatus]);

  return {
    ...state,
    canUseDesktopMedia: Boolean(desktopMediaApi()),
    clearAll,
    publish,
    selectAndPrepare,
    stop: stopPublication,
  };
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
