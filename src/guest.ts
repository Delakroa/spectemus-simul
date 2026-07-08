import { RemoteParticipant, RemoteTrack, RemoteTrackPublication, Room, RoomEvent, Track } from 'livekit-client';
import { normalizeError } from './lib/errors';
import { connectToLiveKit } from './lib/livekit';
import {
  createIdentity,
  getInitialRoomName,
  getRequiredElement,
  getTokenEndpoint,
  setError,
  setStatus
} from './ui';

type GuestElements = {
  roomInput: HTMLInputElement;
  identityInput: HTMLInputElement;
  connectButton: HTMLButtonElement;
  reconnectButton: HTMLButtonElement;
  disconnectButton: HTMLButtonElement;
  enableSoundButton: HTMLButtonElement;
  remoteVideo: HTMLVideoElement;
  connectionStatus: HTMLElement;
  subscriptionStatus: HTMLElement;
  videoTrackStatus: HTMLElement;
  audioTrackStatus: HTMLElement;
  hostStatus: HTMLElement;
  firstFrameStatus: HTMLElement;
  playbackQualityStatus: HTMLElement;
  videoStatsStatus: HTMLElement;
  audioStatsStatus: HTMLElement;
  errorStatus: HTMLElement;
};

type ReceiverStatsSnapshot = {
  timestamp: number;
  bytesReceived?: number;
  packetsLost?: number;
  packetsReceived?: number;
  jitter?: number;
  framesDecoded?: number;
  framesDropped?: number;
  framesReceived?: number;
  frameWidth?: number;
  frameHeight?: number;
  concealedSamples?: number;
  concealmentEvents?: number;
};

type ReceiverStatsTrack = RemoteTrack & {
  getReceiverStats: () => Promise<ReceiverStatsSnapshot | undefined>;
};

export function mountGuest(root: HTMLElement): void {
  root.innerHTML = `
    <div class="layout">
      <section class="panel stack">
        <h2>Remote media</h2>
        <div class="field-grid">
          <label>
            <span class="label">Room</span>
            <input id="room-input" type="text" autocomplete="off" />
          </label>
          <label>
            <span class="label">Identity</span>
            <input id="identity-input" type="text" autocomplete="off" />
          </label>
        </div>
        <video id="remote-video" controls autoplay playsinline></video>
        <div class="inline">
          <button id="connect-button" class="primary" type="button">Connect</button>
          <button id="reconnect-button" type="button">Reconnect</button>
          <button id="disconnect-button" type="button">Disconnect</button>
          <button id="enable-sound-button" type="button">Enable sound</button>
        </div>
      </section>

      <aside class="panel stack">
        <h2>Guest state</h2>
        <div class="status-list">
          <div class="status-row"><strong>LiveKit</strong><span id="connection-status" class="status-value">Disconnected</span></div>
          <div class="status-row"><strong>Subscription</strong><span id="subscription-status" class="status-value">No tracks</span></div>
          <div class="status-row"><strong>Video track</strong><span id="video-track-status" class="status-value">Missing</span></div>
          <div class="status-row"><strong>Audio track</strong><span id="audio-track-status" class="status-value">Missing</span></div>
          <div class="status-row"><strong>Host</strong><span id="host-status" class="status-value">Unknown</span></div>
          <div class="status-row"><strong>First frame</strong><span id="first-frame-status" class="status-value">Not received</span></div>
          <div class="status-row"><strong>Playback</strong><span id="playback-quality-status" class="status-value">Waiting for video</span></div>
          <div class="status-row"><strong>Video stats</strong><span id="video-stats-status" class="status-value">No video stats</span></div>
          <div class="status-row"><strong>Audio stats</strong><span id="audio-stats-status" class="status-value">No audio stats</span></div>
        </div>
        <div>
          <div class="label">Error</div>
          <div id="error-status" class="error-box">No error</div>
        </div>
      </aside>
    </div>
  `;

  const elements = getGuestElements(root);
  const controller = new GuestController(elements);
  controller.mount();
}

class GuestController {
  private room: Room | null = null;
  private subscribedTracks = new Set<RemoteTrack>();
  private videoStatsTrack: ReceiverStatsTrack | null = null;
  private audioStatsTrack: ReceiverStatsTrack | null = null;
  private previousVideoStats: ReceiverStatsSnapshot | null = null;
  private previousAudioStats: ReceiverStatsSnapshot | null = null;
  private statsTimer: number | null = null;
  private connectStartedAt = 0;
  private firstFrameReceived = false;

  constructor(private readonly elements: GuestElements) {}

  mount(): void {
    this.elements.roomInput.value = getInitialRoomName();
    this.elements.identityInput.value = createIdentity('guest');
    this.elements.enableSoundButton.disabled = true;
    this.bindEvents();
    this.updateButtons();
  }

  private bindEvents(): void {
    this.elements.connectButton.addEventListener('click', () => void this.connect());
    this.elements.reconnectButton.addEventListener('click', () => void this.reconnect());
    this.elements.disconnectButton.addEventListener('click', () => this.disconnect());
    this.elements.enableSoundButton.addEventListener('click', () => void this.playRemoteMedia({ userGesture: true }));

    this.elements.remoteVideo.addEventListener('loadeddata', () => {
      if (!this.firstFrameReceived) {
        this.firstFrameReceived = true;
        const elapsed = Math.round(performance.now() - this.connectStartedAt);
        setStatus(this.elements.firstFrameStatus, `${elapsed} ms after Connect`, 'ok');
      }
    });

    window.addEventListener('pagehide', () => this.cleanup());
  }

  private async connect(): Promise<void> {
    this.clearError();
    this.disconnect();
    this.connectStartedAt = performance.now();
    this.firstFrameReceived = false;

    try {
      setStatus(this.elements.connectionStatus, 'Connecting...', 'warn');
      const connection = await connectToLiveKit({
        tokenEndpoint: getTokenEndpoint(),
        roomName: this.roomName(),
        identity: this.identity(),
        role: 'guest'
      });

      this.room = connection.room;
      this.bindRoomEvents(connection.room);
      setStatus(this.elements.connectionStatus, `Connected as ${connection.tokenResponse.identity}`, 'ok');
      this.attachExistingTracks(connection.room);
    } catch (error) {
      this.showErrorFromUnknown(error, 'Unable to connect guest to LiveKit.');
      setStatus(this.elements.connectionStatus, 'Connection failed', 'error');
    } finally {
      this.updateButtons();
    }
  }

  private async reconnect(): Promise<void> {
    this.disconnect();
    await this.connect();
  }

  private disconnect(): void {
    this.detachAllTracks();

    if (this.room) {
      this.room.disconnect();
      this.room = null;
    }

    setStatus(this.elements.connectionStatus, 'Disconnected', 'idle');
    setStatus(this.elements.subscriptionStatus, 'No tracks', 'idle');
    setStatus(this.elements.videoTrackStatus, 'Missing', 'idle');
    setStatus(this.elements.audioTrackStatus, 'Missing', 'idle');
    setStatus(this.elements.hostStatus, 'Unknown', 'idle');
    setStatus(this.elements.firstFrameStatus, 'Not received', 'idle');
    setStatus(this.elements.playbackQualityStatus, 'Waiting for video', 'idle');
    setStatus(this.elements.videoStatsStatus, 'No video stats', 'idle');
    setStatus(this.elements.audioStatsStatus, 'No audio stats', 'idle');
    this.updateButtons();
  }

  private bindRoomEvents(room: Room): void {
    room
      .on(RoomEvent.ConnectionStateChanged, (state) => {
        setStatus(this.elements.connectionStatus, `LiveKit ${String(state)}`, state === 'connected' ? 'ok' : 'warn');
      })
      .on(RoomEvent.Reconnecting, () => setStatus(this.elements.connectionStatus, 'Reconnecting...', 'warn'))
      .on(RoomEvent.Reconnected, () => setStatus(this.elements.connectionStatus, 'Reconnected', 'ok'))
      .on(RoomEvent.Disconnected, () => setStatus(this.elements.connectionStatus, 'Disconnected', 'warn'))
      .on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
        this.attachTrack(track, publication, participant);
      })
      .on(RoomEvent.TrackUnsubscribed, (track, publication, participant) => {
        this.detachTrack(track);
        setStatus(this.elements.hostStatus, `Track lost from ${participant.identity}: ${publication.trackName}`, 'warn');
      })
      .on(RoomEvent.ParticipantConnected, (participant) => {
        setStatus(this.elements.hostStatus, `${participant.identity} connected`, 'ok');
      })
      .on(RoomEvent.ParticipantDisconnected, (participant) => {
        setStatus(this.elements.hostStatus, `${participant.identity} disconnected`, 'warn');
      });
  }

  private attachExistingTracks(room: Room): void {
    for (const participant of room.remoteParticipants.values()) {
      for (const publication of participant.trackPublications.values()) {
        if (publication.track) {
          this.attachTrack(publication.track, publication, participant);
        }
      }
    }
  }

  private attachTrack(track: RemoteTrack, publication: RemoteTrackPublication, participant: RemoteParticipant): void {
    this.subscribedTracks.add(track);
    setStatus(this.elements.subscriptionStatus, `${this.subscribedTracks.size} subscribed track(s)`, 'ok');
    setStatus(this.elements.hostStatus, `Receiving from ${participant.identity}`, 'ok');

    if (track.kind === Track.Kind.Video) {
      this.videoStatsTrack = toReceiverStatsTrack(track);
      this.previousVideoStats = null;
      track.attach(this.elements.remoteVideo);
      setStatus(this.elements.videoTrackStatus, `${publication.trackName || 'video'} subscribed`, 'ok');
      this.startStatsTimer();
      void this.playRemoteMedia();
      return;
    }

    if (track.kind === Track.Kind.Audio) {
      this.audioStatsTrack = toReceiverStatsTrack(track);
      this.previousAudioStats = null;
      track.attach(this.elements.remoteVideo);
      setStatus(this.elements.audioTrackStatus, `${publication.trackName || 'audio'} subscribed`, 'ok');
      this.startStatsTimer();
      void this.playRemoteMedia({ markAudioPlaying: true });
    }
  }

  private detachTrack(track: RemoteTrack): void {
    track.detach(this.elements.remoteVideo);
    this.subscribedTracks.delete(track);

    if (track.kind === Track.Kind.Video) {
      this.videoStatsTrack = null;
      this.previousVideoStats = null;
      setStatus(this.elements.videoTrackStatus, 'Missing', 'warn');
      setStatus(this.elements.videoStatsStatus, 'No video stats', 'warn');
    }

    if (track.kind === Track.Kind.Audio) {
      this.audioStatsTrack = null;
      this.previousAudioStats = null;
      setStatus(this.elements.audioTrackStatus, 'Missing', 'warn');
      setStatus(this.elements.audioStatsStatus, 'No audio stats', 'warn');
    }

    if (this.subscribedTracks.size === 0) {
      this.stopStatsTimer();
      this.elements.remoteVideo.removeAttribute('src');
      this.elements.remoteVideo.srcObject = null;
      setStatus(this.elements.playbackQualityStatus, 'Waiting for video', 'idle');
    }

    setStatus(
      this.elements.subscriptionStatus,
      this.subscribedTracks.size > 0 ? `${this.subscribedTracks.size} subscribed track(s)` : 'No tracks',
      this.subscribedTracks.size > 0 ? 'ok' : 'warn'
    );
  }

  private detachAllTracks(): void {
    for (const track of this.subscribedTracks) {
      track.detach(this.elements.remoteVideo);
    }

    this.subscribedTracks.clear();
    this.videoStatsTrack = null;
    this.audioStatsTrack = null;
    this.previousVideoStats = null;
    this.previousAudioStats = null;
    this.stopStatsTimer();
    this.elements.remoteVideo.removeAttribute('src');
    this.elements.remoteVideo.srcObject = null;
    this.elements.enableSoundButton.disabled = true;
  }

  private async playRemoteMedia(options: { userGesture?: boolean; markAudioPlaying?: boolean } = {}): Promise<void> {
    try {
      if (options.userGesture) {
        this.elements.remoteVideo.muted = false;
      }

      await this.elements.remoteVideo.play();
      this.elements.enableSoundButton.disabled = true;
      if (options.markAudioPlaying) {
        setStatus(this.elements.audioTrackStatus, 'Audio playing', 'ok');
      }
    } catch (error) {
      if (isAbortError(error)) {
        return;
      }

      this.elements.enableSoundButton.disabled = false;
      this.showErrorFromUnknown(error, 'Browser blocked remote audio autoplay. Press Enable sound.');
    }
  }

  private startStatsTimer(): void {
    if (this.statsTimer !== null) {
      return;
    }

    this.statsTimer = window.setInterval(() => void this.updateStats(), 2000);
    void this.updateStats();
  }

  private stopStatsTimer(): void {
    if (this.statsTimer !== null) {
      window.clearInterval(this.statsTimer);
      this.statsTimer = null;
    }
  }

  private async updateStats(): Promise<void> {
    this.updatePlaybackQuality();
    await Promise.all([this.updateVideoReceiverStats(), this.updateAudioReceiverStats()]);
  }

  private updatePlaybackQuality(): void {
    const video = this.elements.remoteVideo;

    if (!('getVideoPlaybackQuality' in video)) {
      setStatus(this.elements.playbackQualityStatus, 'Playback quality API unavailable', 'warn');
      return;
    }

    const quality = video.getVideoPlaybackQuality();
    const total = quality.totalVideoFrames;
    const dropped = quality.droppedVideoFrames;
    const droppedPercent = total > 0 ? (dropped / total) * 100 : 0;
    const level = droppedPercent > 5 ? 'warn' : 'ok';
    setStatus(
      this.elements.playbackQualityStatus,
      `frames=${total}, dropped=${dropped} (${droppedPercent.toFixed(1)}%)`,
      level
    );
  }

  private async updateVideoReceiverStats(): Promise<void> {
    if (!this.videoStatsTrack) {
      return;
    }

    const stats = await this.videoStatsTrack.getReceiverStats();
    if (!stats) {
      setStatus(this.elements.videoStatsStatus, 'Video receiver stats unavailable', 'warn');
      return;
    }

    const bitrate = calculateBitrateKbps(stats, this.previousVideoStats);
    this.previousVideoStats = stats;

    const parts = [
      formatBitrate(bitrate),
      formatResolution(stats),
      `loss=${formatOptionalNumber(stats.packetsLost)}`,
      `jitter=${formatJitter(stats.jitter)}`,
      `decoded=${formatOptionalNumber(stats.framesDecoded)}`
    ];

    setStatus(this.elements.videoStatsStatus, parts.join(', '), getStatsLevel(stats.packetsLost, stats.jitter));
  }

  private async updateAudioReceiverStats(): Promise<void> {
    if (!this.audioStatsTrack) {
      return;
    }

    const stats = await this.audioStatsTrack.getReceiverStats();
    if (!stats) {
      setStatus(this.elements.audioStatsStatus, 'Audio receiver stats unavailable', 'warn');
      return;
    }

    const bitrate = calculateBitrateKbps(stats, this.previousAudioStats);
    this.previousAudioStats = stats;

    const parts = [
      formatBitrate(bitrate),
      `loss=${formatOptionalNumber(stats.packetsLost)}`,
      `jitter=${formatJitter(stats.jitter)}`,
      `conceal=${formatOptionalNumber(stats.concealmentEvents)}`
    ];

    setStatus(this.elements.audioStatsStatus, parts.join(', '), getStatsLevel(stats.packetsLost, stats.jitter));
  }

  private roomName(): string {
    return this.elements.roomInput.value.trim() || getInitialRoomName();
  }

  private identity(): string {
    const value = this.elements.identityInput.value.trim();
    if (value) {
      return value;
    }

    const identity = createIdentity('guest');
    this.elements.identityInput.value = identity;
    return identity;
  }

  private updateButtons(): void {
    const connected = Boolean(this.room);
    this.elements.disconnectButton.disabled = !connected;
  }

  private cleanup(): void {
    this.disconnect();
  }

  private clearError(): void {
    setError(this.elements.errorStatus, null);
  }

  private showErrorFromUnknown(error: unknown, fallback: string): void {
    const normalized = normalizeError(error, fallback);
    setError(this.elements.errorStatus, `${normalized.message} (${normalized.code})`);
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

function getGuestElements(root: HTMLElement): GuestElements {
  return {
    roomInput: getRequiredElement(root, '#room-input'),
    identityInput: getRequiredElement(root, '#identity-input'),
    connectButton: getRequiredElement(root, '#connect-button'),
    reconnectButton: getRequiredElement(root, '#reconnect-button'),
    disconnectButton: getRequiredElement(root, '#disconnect-button'),
    enableSoundButton: getRequiredElement(root, '#enable-sound-button'),
    remoteVideo: getRequiredElement(root, '#remote-video'),
    connectionStatus: getRequiredElement(root, '#connection-status'),
    subscriptionStatus: getRequiredElement(root, '#subscription-status'),
    videoTrackStatus: getRequiredElement(root, '#video-track-status'),
    audioTrackStatus: getRequiredElement(root, '#audio-track-status'),
    hostStatus: getRequiredElement(root, '#host-status'),
    firstFrameStatus: getRequiredElement(root, '#first-frame-status'),
    playbackQualityStatus: getRequiredElement(root, '#playback-quality-status'),
    videoStatsStatus: getRequiredElement(root, '#video-stats-status'),
    audioStatsStatus: getRequiredElement(root, '#audio-stats-status'),
    errorStatus: getRequiredElement(root, '#error-status')
  };
}

function toReceiverStatsTrack(track: RemoteTrack): ReceiverStatsTrack {
  return track as ReceiverStatsTrack;
}

function calculateBitrateKbps(current: ReceiverStatsSnapshot, previous: ReceiverStatsSnapshot | null): number | null {
  if (!previous || current.bytesReceived === undefined || previous.bytesReceived === undefined) {
    return null;
  }

  const elapsedMs = current.timestamp - previous.timestamp;
  if (elapsedMs <= 0) {
    return null;
  }

  return ((current.bytesReceived - previous.bytesReceived) * 8) / elapsedMs;
}

function formatBitrate(kbps: number | null): string {
  if (kbps === null || !Number.isFinite(kbps)) {
    return 'bitrate=warming up';
  }

  if (kbps >= 1000) {
    return `bitrate=${(kbps / 1000).toFixed(2)} Mbps`;
  }

  return `bitrate=${Math.round(kbps)} kbps`;
}

function formatResolution(stats: ReceiverStatsSnapshot): string {
  if (stats.frameWidth && stats.frameHeight) {
    return `${stats.frameWidth}x${stats.frameHeight}`;
  }

  return 'resolution=n/a';
}

function formatOptionalNumber(value: number | undefined): string {
  return value === undefined ? 'n/a' : String(value);
}

function formatJitter(value: number | undefined): string {
  if (value === undefined) {
    return 'n/a';
  }

  return `${Math.round(value * 1000)} ms`;
}

function getStatsLevel(packetsLost: number | undefined, jitter: number | undefined): 'ok' | 'warn' {
  if ((packetsLost ?? 0) > 0 || (jitter ?? 0) > 0.03) {
    return 'warn';
  }

  return 'ok';
}
