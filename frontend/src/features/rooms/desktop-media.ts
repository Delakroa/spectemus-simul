export type DesktopRuntimeStatus = {
  detail: string;
  state: string;
  url?: string;
};

export type DesktopMediaSelection = {
  displayName: string;
  id: string;
  isNormalized: boolean;
  playbackName: string;
};

export type DesktopMediaNormalizationProgress = {
  id: string;
  progress: number;
};

export type SpectemusDesktopApi = {
  cancelMediaNormalization?: (id: string) => Promise<void>;
  getPublicInviteOrigin?: () => Promise<string | null>;
  getRuntimeStatus: () => Promise<DesktopRuntimeStatus>;
  normalizeMedia?: (id: string) => Promise<DesktopMediaSelection>;
  onMediaNormalizationProgress?: (
    listener: (progress: DesktopMediaNormalizationProgress) => void,
  ) => () => void;
  onRuntimeStatus: (listener: (status: DesktopRuntimeStatus) => void) => () => void;
  pickMediaFile?: () => Promise<DesktopMediaSelection | null>;
  releaseMedia?: (id: string) => Promise<void>;
  restartRuntime: () => Promise<DesktopRuntimeStatus>;
  selectLanAddress?: (address: string) => Promise<DesktopRuntimeStatus>;
};

declare global {
  interface Window {
    spectemusDesktop?: SpectemusDesktopApi;
  }
}

export function desktopMediaUrl(id: string): string {
  return `/_desktop/media/${encodeURIComponent(id)}`;
}
