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

export type DesktopDeviceBindingStatus =
  | { bound: false }
  | {
      bound: true;
      expiresAt?: string;
      profile: { accountId: string; displayName: string };
    };

export type DesktopDeviceBindingStart = {
  bindingId: string;
  expiresAt: string;
  intervalSeconds: number;
  userCode: string;
  verificationUri: string;
};

export type DesktopDeviceBindingPoll =
  | { intervalSeconds: number; status: "pending" }
  | {
      expiresAt: string;
      profile: { accountId: string; displayName: string };
      status: "bound";
    };

export type DesktopPublicRoomAccess = {
  membership: { joinedAt: string; role: string };
  room: {
    createdAt: string;
    expiresAt: string;
    memberLimit: number;
    publicRoomId: string;
    status: string;
  };
};

export type DesktopPublicInvite = {
  expiresAt: string;
  inviteId: string;
  invitePath: string;
  maxRedemptions: number;
};

export type SpectemusDesktopApi = {
  cancelDeviceBinding?: () => Promise<{ cancelled: boolean }>;
  cancelMediaNormalization?: (id: string) => Promise<void>;
  clearDeviceBinding?: () => Promise<DesktopDeviceBindingStatus>;
  createPublicInviteWithDeviceBinding?: (payload: {
    expiresInMinutes: number;
    idempotencyKey: string;
    maxRedemptions: number;
    publicRoomId: string;
  }) => Promise<DesktopPublicInvite>;
  createPublicRoomWithDeviceBinding?: (payload: {
    expiresInMinutes: number;
    idempotencyKey: string;
  }) => Promise<DesktopPublicRoomAccess>;
  getDeviceBindingStatus?: () => Promise<DesktopDeviceBindingStatus>;
  getPublicInviteOrigin?: () => Promise<string | null>;
  getRuntimeStatus: () => Promise<DesktopRuntimeStatus>;
  normalizeMedia?: (id: string) => Promise<DesktopMediaSelection>;
  onMediaNormalizationProgress?: (
    listener: (progress: DesktopMediaNormalizationProgress) => void,
  ) => () => void;
  onRuntimeStatus: (listener: (status: DesktopRuntimeStatus) => void) => () => void;
  openDeviceBinding?: () => Promise<void>;
  pickMediaFile?: () => Promise<DesktopMediaSelection | null>;
  pollDeviceBinding?: () => Promise<DesktopDeviceBindingPoll>;
  releaseMedia?: (id: string) => Promise<void>;
  restartRuntime: () => Promise<DesktopRuntimeStatus>;
  selectLanAddress?: (address: string) => Promise<DesktopRuntimeStatus>;
  startDeviceBinding?: () => Promise<DesktopDeviceBindingStart>;
};

declare global {
  interface Window {
    spectemusDesktop?: SpectemusDesktopApi;
  }
}

export function desktopMediaUrl(id: string): string {
  return `/_desktop/media/${encodeURIComponent(id)}`;
}
