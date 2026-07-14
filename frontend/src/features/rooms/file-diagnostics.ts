export const LOCAL_MEDIA_FILE_ACCEPT = ".mp4,.m4v,.webm,video/mp4,video/x-m4v,video/webm";
export const LOCAL_MEDIA_FORMATS_HINT = "Поддерживаются MP4/M4V (H.264/AAC) и WebM (VP8/VP9/Opus).";

export type SupportedMediaFormat = "mp4" | "webm";
export type MediaFileVerdict = "CAN_STREAM";

export type FileDiagnosticsResult = {
  displayName: string;
  durationMs: number;
  format: SupportedMediaFormat;
  formatLabel: string;
  hasAudio: boolean;
  hasVideo: boolean;
  height: number;
  mimeType: string;
  objectUrl: string;
  verdict: MediaFileVerdict;
  verdictLabel: string;
  width: number;
};

type MediaFormatProfile = {
  browserMimeType: string;
  extensions: string[];
  format: SupportedMediaFormat;
  label: string;
  mimeTypes: string[];
};

const MEDIA_FORMAT_PROFILES: MediaFormatProfile[] = [
  {
    browserMimeType: "video/mp4",
    extensions: ["mp4", "m4v"],
    format: "mp4",
    label: "MP4",
    mimeTypes: ["video/mp4", "video/x-m4v"],
  },
  {
    browserMimeType: "video/webm",
    extensions: ["webm"],
    format: "webm",
    label: "WebM",
    mimeTypes: ["video/webm"],
  },
];

type CapturableVideoElement = HTMLVideoElement & {
  cancelVideoFrameCallback?: (callbackId: number) => void;
  captureStream?: () => MediaStream;
  requestVideoFrameCallback?: (callback: () => void) => number;
};

const CAN_STREAM_VERDICT_LABEL = "Можно транслировать с этого устройства";
const DECODE_PREVIEW_TIMEOUT_MS = 4_000;

export class FileDiagnosticsFailure extends Error {
  constructor(
    public readonly code:
      | "UNSUPPORTED_FORMAT"
      | "NO_VIDEO_TRACK"
      | "CAPTURE_STREAM_UNAVAILABLE"
      | "CAPTURE_PREVIEW_FAILED"
      | "METADATA_LOAD_FAILED",
    message: string,
  ) {
    super(message);
    this.name = "FileDiagnosticsFailure";
  }
}

export async function diagnoseFile(file: File): Promise<FileDiagnosticsResult> {
  const objectUrl = URL.createObjectURL(file);

  try {
    return await runChecks(file, objectUrl);
  } catch (error) {
    URL.revokeObjectURL(objectUrl);
    throw error;
  }
}

async function runChecks(file: File, objectUrl: string): Promise<FileDiagnosticsResult> {
  const profile = resolveMediaFormatProfile(file);
  if (!profile) {
    throw new FileDiagnosticsFailure("UNSUPPORTED_FORMAT", unsupportedFormatMessage());
  }

  const mimeType = profile.browserMimeType;
  const video = document.createElement("video");

  if (!video.canPlayType(mimeType)) {
    throw new FileDiagnosticsFailure(
      "UNSUPPORTED_FORMAT",
      `Браузер не поддерживает выбранный ${profile.label}. ${LOCAL_MEDIA_FORMATS_HINT}`,
    );
  }

  const videoWithCapture = video as CapturableVideoElement;
  if (typeof videoWithCapture.captureStream !== "function") {
    throw new FileDiagnosticsFailure(
      "CAPTURE_STREAM_UNAVAILABLE",
      "Браузер не поддерживает захват потока. Используйте Chrome или Edge.",
    );
  }

  try {
    const metadata = await loadMetadata(video, objectUrl);

    if (!metadata.hasVideo) {
      throw new FileDiagnosticsFailure("NO_VIDEO_TRACK", "Файл не содержит видеодорожки.");
    }

    const capture = await runCapturePreview(videoWithCapture);

    return {
      displayName: file.name,
      durationMs: metadata.durationMs,
      format: profile.format,
      formatLabel: profile.label,
      hasAudio: capture.hasAudio,
      hasVideo: true,
      height: metadata.height,
      mimeType,
      objectUrl,
      verdict: "CAN_STREAM",
      verdictLabel: CAN_STREAM_VERDICT_LABEL,
      width: metadata.width,
    };
  } finally {
    cleanupDiagnosticVideo(video);
  }
}

function loadMetadata(
  video: HTMLVideoElement,
  src: string,
): Promise<{ durationMs: number; hasVideo: boolean; height: number; width: number }> {
  return new Promise((resolve, reject) => {
    video.onloadedmetadata = () => {
      resolve({
        durationMs: Number.isFinite(video.duration) ? Math.round(video.duration * 1000) : 0,
        hasVideo: video.videoWidth > 0,
        height: video.videoHeight,
        width: video.videoWidth,
      });
    };

    video.onerror = () => {
      reject(
        new FileDiagnosticsFailure(
          "METADATA_LOAD_FAILED",
          `Не удалось декодировать файл. Возможно, он повреждён или использует неподдерживаемый кодек. ${LOCAL_MEDIA_FORMATS_HINT}`,
        ),
      );
    };

    video.src = src;
  });
}

async function runCapturePreview(video: CapturableVideoElement): Promise<{ hasAudio: boolean }> {
  const stream = video.captureStream?.();
  if (!stream) {
    throw new FileDiagnosticsFailure(
      "CAPTURE_STREAM_UNAVAILABLE",
      "Браузер не поддерживает захват потока. Используйте Chrome или Edge.",
    );
  }

  try {
    video.muted = true;
    video.playsInline = true;
    await video.play();
    await waitForDecodedFrame(video);

    if (stream.getVideoTracks().length === 0) {
      throw new FileDiagnosticsFailure(
        "CAPTURE_PREVIEW_FAILED",
        "Браузер воспроизводит файл, но не смог подготовить видеопоток для комнаты. Выберите другой файл.",
      );
    }

    return { hasAudio: stream.getAudioTracks().length > 0 };
  } catch (error) {
    if (error instanceof FileDiagnosticsFailure) {
      throw error;
    }

    throw new FileDiagnosticsFailure(
      "CAPTURE_PREVIEW_FAILED",
      `Не удалось проверить видеопоток перед публикацией. ${LOCAL_MEDIA_FORMATS_HINT}`,
    );
  } finally {
    for (const track of stream.getTracks()) {
      track.stop();
    }
  }
}

function waitForDecodedFrame(video: CapturableVideoElement): Promise<void> {
  return new Promise((resolve, reject) => {
    let callbackId: number | null = null;
    let settled = false;
    let timeoutId: number | null = null;
    const canListenForProgress =
      typeof video.addEventListener === "function" &&
      typeof video.removeEventListener === "function";
    const cleanup = () => {
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
      if (callbackId !== null) {
        video.cancelVideoFrameCallback?.(callbackId);
      }
      if (canListenForProgress) {
        video.removeEventListener("timeupdate", onTimeUpdate);
      }
    };
    const resolvePreview = () => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      resolve();
    };
    const onTimeUpdate = () => resolvePreview();
    timeoutId = window.setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      reject(
        new FileDiagnosticsFailure(
          "CAPTURE_PREVIEW_FAILED",
          "Браузер не смог декодировать первый кадр для публикации. Выберите другой файл.",
        ),
      );
    }, DECODE_PREVIEW_TIMEOUT_MS);

    if (canListenForProgress) {
      video.addEventListener("timeupdate", onTimeUpdate, { once: true });
    }

    if (typeof video.requestVideoFrameCallback === "function") {
      callbackId = video.requestVideoFrameCallback(resolvePreview);
    } else if (!canListenForProgress) {
      resolvePreview();
    }
  });
}

function cleanupDiagnosticVideo(video: HTMLVideoElement): void {
  video.pause();
  video.removeAttribute("src");
  video.load();
}

function resolveMediaFormatProfile(file: File): MediaFormatProfile | null {
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  const mimeType = normalizeMimeType(file.type);

  return (
    MEDIA_FORMAT_PROFILES.find((profile) => profile.extensions.includes(extension)) ??
    MEDIA_FORMAT_PROFILES.find((profile) => profile.mimeTypes.includes(mimeType)) ??
    null
  );
}

function normalizeMimeType(value: string): string {
  return value.split(";", 1)[0]?.trim().toLowerCase() ?? "";
}

function unsupportedFormatMessage(): string {
  return `Этот контейнер пока не поддерживается в браузерной версии. ${LOCAL_MEDIA_FORMATS_HINT}`;
}
