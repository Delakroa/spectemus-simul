import type { PublicConnectionEventType } from "../internet/connection-telemetry";

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
  | { bound: false; requiresRevoke?: boolean }
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

export type DesktopPublicLiveKitToken = {
  canPublish: boolean;
  canPublishData: boolean;
  expiresAt: string;
  liveKitUrl: string;
  participantId: string;
  participantIdentity: string;
  role: "HOST" | "GUEST";
  roomName: string;
  token: string;
};

/** Resolved IPC envelope — never reject across Electron invoke/contextBridge. */
export type DesktopIpcProblem = {
  code?: string;
  detail?: string;
  name?: string;
  retryable?: boolean;
  status: number;
  title?: string;
};

export type DesktopIpcResult<T> = { data: T; ok: true } | { ok: false; problem: DesktopIpcProblem };

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
  mintPublicLiveKitToken?: (
    publicRoomId: string,
  ) => Promise<DesktopIpcResult<DesktopPublicLiveKitToken>>;
  submitPublicConnectionEvent?: (payload: {
    publicRoomId: string;
    type: PublicConnectionEventType;
  }) => Promise<{ accepted: true }>;
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
