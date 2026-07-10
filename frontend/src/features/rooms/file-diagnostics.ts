export type FileDiagnosticsResult = {
  displayName: string;
  durationMs: number;
  hasAudio: boolean;
  hasVideo: boolean;
  mimeType: string;
  objectUrl: string;
};

export class FileDiagnosticsFailure extends Error {
  constructor(
    public readonly code:
      | "UNSUPPORTED_FORMAT"
      | "NO_VIDEO_TRACK"
      | "CAPTURE_STREAM_UNAVAILABLE"
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
  const mimeType = file.type || guessMimeType(file.name);
  const video = document.createElement("video");

  if (!video.canPlayType(mimeType)) {
    throw new FileDiagnosticsFailure(
      "UNSUPPORTED_FORMAT",
      "Этот формат не поддерживается браузером. Используйте MP4 с кодеками H.264 и AAC.",
    );
  }

  const videoWithCapture = video as HTMLVideoElement & { captureStream?: () => MediaStream };
  if (typeof videoWithCapture.captureStream !== "function") {
    throw new FileDiagnosticsFailure(
      "CAPTURE_STREAM_UNAVAILABLE",
      "Браузер не поддерживает захват потока. Используйте Chrome или Edge.",
    );
  }

  const metadata = await loadMetadata(video, objectUrl);

  if (!metadata.hasVideo) {
    throw new FileDiagnosticsFailure(
      "NO_VIDEO_TRACK",
      "Файл не содержит видеодорожки.",
    );
  }

  return {
    displayName: file.name,
    durationMs: metadata.durationMs,
    hasAudio: metadata.hasAudio,
    hasVideo: true,
    mimeType,
    objectUrl,
  };
}

function loadMetadata(
  video: HTMLVideoElement,
  src: string,
): Promise<{ durationMs: number; hasVideo: boolean; hasAudio: boolean }> {
  return new Promise((resolve, reject) => {
    video.onloadedmetadata = () => {
      resolve({
        durationMs: Number.isFinite(video.duration) ? Math.round(video.duration * 1000) : 0,
        hasAudio: true,
        hasVideo: video.videoWidth > 0,
      });
    };

    video.onerror = () => {
      reject(
        new FileDiagnosticsFailure(
          "METADATA_LOAD_FAILED",
          "Не удалось прочитать файл. Возможно, он повреждён или пуст.",
        ),
      );
    };

    video.src = src;
  });
}

function guessMimeType(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  const types: Record<string, string> = {
    m4v: "video/mp4",
    mp4: "video/mp4",
    ogg: "video/ogg",
    ogv: "video/ogg",
    webm: "video/webm",
  };
  return types[ext] ?? "video/*";
}
