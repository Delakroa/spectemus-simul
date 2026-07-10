import type { Room as LiveKitRoom } from "livekit-client";

import type { FileDiagnosticsResult } from "./file-diagnostics";

export type FilePublication = {
  audioTrack: MediaStreamTrack | null;
  stream: MediaStream;
  tracks: MediaStreamTrack[];
  videoElement: HTMLVideoElement;
  videoTrack: MediaStreamTrack;
};

export class FilePublicationFailure extends Error {
  constructor(
    public readonly code:
      | "LIVEKIT_NOT_CONNECTED"
      | "CAPTURE_STREAM_UNAVAILABLE"
      | "NO_VIDEO_TRACK"
      | "PLAYBACK_BLOCKED"
      | "PUBLISH_FAILED",
    message: string,
  ) {
    super(message);
    this.name = "FilePublicationFailure";
  }
}

export async function publishFileToLiveKit(
  room: LiveKitRoom,
  file: FileDiagnosticsResult,
): Promise<FilePublication> {
  const videoElement = createSourceVideo();
  let stream: MediaStream | null = null;

  try {
    await waitForMetadata(videoElement, file.objectUrl);
    stream = captureMediaElementStream(videoElement);
    const videoTrack = stream.getVideoTracks()[0];

    if (!videoTrack) {
      throw new FilePublicationFailure(
        "NO_VIDEO_TRACK",
        "Не удалось получить видеодорожку из выбранного файла.",
      );
    }

    const audioTrack = stream.getAudioTracks()[0] ?? null;
    const tracks = audioTrack ? [videoTrack, audioTrack] : [videoTrack];

    await playSourceVideo(videoElement);
    await publishTracks(room, videoTrack, audioTrack);

    return {
      audioTrack,
      stream,
      tracks,
      videoElement,
      videoTrack,
    };
  } catch (error) {
    cleanupPartialPublication(room, videoElement, stream);
    throw normalizePublicationError(error);
  }
}

export function stopFilePublication(room: LiveKitRoom | null, publication: FilePublication): void {
  for (const track of publication.tracks) {
    try {
      if (room) {
        void room.localParticipant.unpublishTrack(track, true).catch(() => {
          track.stop();
        });
      } else {
        track.stop();
      }
    } catch {
      track.stop();
    }
  }

  stopMediaTracks(publication.videoElement, publication.stream);
}

function createSourceVideo(): HTMLVideoElement {
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  return video;
}

function captureMediaElementStream(video: HTMLVideoElement): MediaStream {
  const capturableVideo = video as HTMLVideoElement & { captureStream?: () => MediaStream };

  if (typeof capturableVideo.captureStream !== "function") {
    throw new FilePublicationFailure(
      "CAPTURE_STREAM_UNAVAILABLE",
      "Браузер не поддерживает публикацию выбранного файла через captureStream().",
    );
  }

  return capturableVideo.captureStream();
}

function waitForMetadata(video: HTMLVideoElement, src: string): Promise<void> {
  if (video.readyState >= 1) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      cleanup();
      reject(
        new FilePublicationFailure(
          "PUBLISH_FAILED",
          "Не удалось дождаться metadata выбранного файла.",
        ),
      );
    }, 8000);

    const cleanup = () => {
      window.clearTimeout(timeoutId);
      video.removeEventListener("loadedmetadata", onLoadedMetadata);
      video.removeEventListener("error", onError);
    };

    const onLoadedMetadata = () => {
      cleanup();
      resolve();
    };

    const onError = () => {
      cleanup();
      reject(
        new FilePublicationFailure(
          "PUBLISH_FAILED",
          "Не удалось подготовить выбранный файл к публикации.",
        ),
      );
    };

    video.addEventListener("loadedmetadata", onLoadedMetadata);
    video.addEventListener("error", onError);
    video.src = src;
  });
}

async function playSourceVideo(video: HTMLVideoElement): Promise<void> {
  try {
    await video.play();
  } catch (error) {
    throw new FilePublicationFailure(
      "PLAYBACK_BLOCKED",
      error instanceof Error
        ? error.message
        : "Браузер заблокировал локальное воспроизведение файла.",
    );
  }
}

async function publishTracks(
  room: LiveKitRoom,
  videoTrack: MediaStreamTrack,
  audioTrack: MediaStreamTrack | null,
) {
  const { Track } = await import("livekit-client");

  try {
    await room.localParticipant.publishTrack(videoTrack, {
      name: "movie-video",
      simulcast: false,
      source: Track.Source.Camera,
    });

    if (audioTrack) {
      await room.localParticipant.publishTrack(audioTrack, {
        name: "movie-audio",
        source: Track.Source.ScreenShareAudio,
      });
    }
  } catch (error) {
    throw new FilePublicationFailure(
      "PUBLISH_FAILED",
      error instanceof Error ? error.message : "Не удалось опубликовать файл в LiveKit.",
    );
  }
}

function stopMediaTracks(videoElement: HTMLVideoElement, stream: MediaStream | null): void {
  videoElement.pause();
  videoElement.removeAttribute("src");
  videoElement.load();

  for (const track of stream?.getTracks() ?? []) {
    track.stop();
  }
}

function cleanupPartialPublication(
  room: LiveKitRoom,
  videoElement: HTMLVideoElement,
  stream: MediaStream | null,
): void {
  for (const track of stream?.getTracks() ?? []) {
    try {
      void room.localParticipant.unpublishTrack(track, true).catch(() => {
        track.stop();
      });
    } catch {
      track.stop();
    }
  }

  stopMediaTracks(videoElement, stream);
}

function normalizePublicationError(error: unknown): FilePublicationFailure {
  if (error instanceof FilePublicationFailure) {
    return error;
  }

  return new FilePublicationFailure(
    "PUBLISH_FAILED",
    error instanceof Error ? error.message : "Не удалось опубликовать файл в LiveKit.",
  );
}
