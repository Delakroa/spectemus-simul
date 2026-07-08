import { Room, RoomEvent, Track, type LocalTrackPublication } from 'livekit-client';
import { normalizeError } from './lib/errors';
import { connectToLiveKit } from './lib/livekit';
import {
  captureMediaElementStream,
  cleanupObjectUrl,
  detectSupportedMimeType,
  formatBytes,
  getPrimaryPublishTracks,
  stopMediaTracks,
  summarizeStreamTracks
} from './lib/media';
import {
  createIdentity,
  formatSeconds,
  getInitialRoomName,
  getRequiredElement,
  getTokenEndpoint,
  setError,
  setStatus
} from './ui';

type HostElements = {
  roomInput: HTMLInputElement;
  identityInput: HTMLInputElement;
  fileInput: HTMLInputElement;
  connectButton: HTMLButtonElement;
  reconnectButton: HTMLButtonElement;
  disconnectButton: HTMLButtonElement;
  publishButton: HTMLButtonElement;
  stopButton: HTMLButtonElement;
  playButton: HTMLButtonElement;
  pauseButton: HTMLButtonElement;
  seekInput: HTMLInputElement;
  timeReadout: HTMLElement;
  preview: HTMLVideoElement;
  connectionStatus: HTMLElement;
  fileStatus: HTMLElement;
  sourceResolutionStatus: HTMLElement;
  captureStatus: HTMLElement;
  captureResolutionStatus: HTMLElement;
  videoTrackStatus: HTMLElement;
  audioTrackStatus: HTMLElement;
  publishStatus: HTMLElement;
  errorStatus: HTMLElement;
};

type PublishTrackInput = {
  name: string;
  source: Track.Source;
  simulcast?: boolean;
};

const publishAckTimeoutMs = 5000;

type PublishOutcome =
  | { status: 'confirmed'; publication: LocalTrackPublication }
  | { status: 'pending'; publication: LocalTrackPublication | null }
  | { status: 'failed'; error: unknown };

export function mountHost(root: HTMLElement): void {
  root.innerHTML = `
    <div class="layout">
      <section class="panel stack">
        <h2>Local media</h2>
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
        <input id="file-input" type="file" accept="video/mp4" />
        <video id="host-preview" controls playsinline></video>
        <div class="inline">
          <button id="play-button" type="button">Play</button>
          <button id="pause-button" type="button">Pause</button>
          <span id="time-readout" class="time-readout">0:00 / 0:00</span>
        </div>
        <input id="seek-input" type="range" min="0" max="0" step="0.1" value="0" />
        <div class="inline">
          <button id="connect-button" class="primary" type="button">Connect</button>
          <button id="reconnect-button" type="button">Reconnect</button>
          <button id="disconnect-button" type="button">Disconnect</button>
          <button id="publish-button" class="primary" type="button">Publish captured tracks</button>
          <button id="stop-button" class="danger" type="button">Stop publication</button>
        </div>
      </section>

      <aside class="panel stack">
        <h2>Host state</h2>
        <div class="status-list">
          <div class="status-row"><strong>LiveKit</strong><span id="connection-status" class="status-value">Disconnected</span></div>
          <div class="status-row"><strong>Selected file</strong><span id="file-status" class="status-value">No file selected</span></div>
          <div class="status-row"><strong>Source resolution</strong><span id="source-resolution-status" class="status-value">No metadata</span></div>
          <div class="status-row"><strong>captureStream</strong><span id="capture-status" class="status-value">Not captured</span></div>
          <div class="status-row"><strong>Capture resolution</strong><span id="capture-resolution-status" class="status-value">Not captured</span></div>
          <div class="status-row"><strong>Video track</strong><span id="video-track-status" class="status-value">Unknown</span></div>
          <div class="status-row"><strong>Audio track</strong><span id="audio-track-status" class="status-value">Unknown</span></div>
          <div class="status-row"><strong>Publication</strong><span id="publish-status" class="status-value">Stopped</span></div>
        </div>
        <div>
          <div class="label">Error</div>
          <div id="error-status" class="error-box">No error</div>
        </div>
      </aside>
    </div>
  `;

  const elements = getHostElements(root);
  const controller = new HostController(elements);
  controller.mount();
}

class HostController {
  private room: Room | null = null;
  private objectUrl: string | null = null;
  private capturedStream: MediaStream | null = null;
  private publishedTracks: MediaStreamTrack[] = [];
  private isChangingSeek = false;
  private wantsPublication = false;
  private publishPromise: Promise<void> | null = null;
  private republishTimer: number | null = null;

  constructor(private readonly elements: HostElements) {}

  mount(): void {
    this.elements.roomInput.value = getInitialRoomName();
    this.elements.identityInput.value = createIdentity('host');
    this.bindEvents();
    this.updateButtons();
  }

  private bindEvents(): void {
    this.elements.fileInput.addEventListener('change', () => {
      const file = this.elements.fileInput.files?.[0] ?? null;
      if (file) {
        this.replaceFile(file);
      }
    });

    this.elements.connectButton.addEventListener('click', () => void this.connect());
    this.elements.reconnectButton.addEventListener('click', () => void this.reconnect());
    this.elements.disconnectButton.addEventListener('click', () => this.disconnect());
    this.elements.publishButton.addEventListener('click', () => void this.publish());
    this.elements.stopButton.addEventListener('click', () => this.stopPublication());
    this.elements.playButton.addEventListener('click', () => void this.play());
    this.elements.pauseButton.addEventListener('click', () => this.elements.preview.pause());

    this.elements.seekInput.addEventListener('input', () => {
      this.isChangingSeek = true;
      this.elements.preview.currentTime = Number.parseFloat(this.elements.seekInput.value);
    });

    this.elements.seekInput.addEventListener('change', () => {
      this.isChangingSeek = false;
    });

    this.elements.preview.addEventListener('loadedmetadata', () => {
      this.updateTimeControls();
      this.updateSourceResolution();
    });
    this.elements.preview.addEventListener('timeupdate', () => this.updateTimeControls());
    this.elements.preview.addEventListener('play', () => setStatus(this.elements.publishStatus, 'Video playing locally', 'ok'));
    this.elements.preview.addEventListener('pause', () => {
      if (this.publishedTracks.length > 0) {
        setStatus(this.elements.publishStatus, 'Published, source paused', 'warn');
      }
    });
    this.elements.preview.addEventListener('error', () => {
      this.showError('The selected file cannot be played by this browser.');
    });

    window.addEventListener('pagehide', () => this.cleanup());
  }

  private replaceFile(file: File): void {
    this.clearError();
    this.stopPublication({ resetIntent: true });

    this.objectUrl = cleanupObjectUrl(this.objectUrl);
    this.elements.preview.pause();
    this.elements.preview.removeAttribute('src');
    this.elements.preview.load();

    if (file.size === 0) {
      this.showError('Selected file is empty.');
      setStatus(this.elements.fileStatus, 'Empty file', 'error');
      setStatus(this.elements.sourceResolutionStatus, 'No metadata', 'idle');
      setStatus(this.elements.captureResolutionStatus, 'Not captured', 'idle');
      return;
    }

    const playableMimeType = detectSupportedMimeType((mimeType) => this.elements.preview.canPlayType(mimeType));
    const level = playableMimeType ? 'ok' : 'warn';
    const type = file.type || 'unknown type';

    this.objectUrl = URL.createObjectURL(file);
    this.elements.preview.src = this.objectUrl;
    this.elements.preview.volume = 1;
    this.elements.preview.muted = false;
    this.elements.preview.load();

    setStatus(
      this.elements.fileStatus,
      `${file.name} (${type}, ${formatBytes(file.size)})${playableMimeType ? '' : ' - browser did not confirm MP4 support'}`,
      level
    );
    setStatus(this.elements.sourceResolutionStatus, 'Loading metadata...', 'idle');
    setStatus(this.elements.captureStatus, 'Ready to capture after metadata loads', 'idle');
    setStatus(this.elements.captureResolutionStatus, 'Not captured', 'idle');
    setStatus(this.elements.videoTrackStatus, 'Not captured yet', 'idle');
    setStatus(this.elements.audioTrackStatus, 'Not captured yet', 'idle');
    setStatus(this.elements.publishStatus, 'Stopped', 'idle');
    this.updateButtons();
  }

  private async connect(): Promise<void> {
    this.clearError();
    this.disconnect();

    try {
      setStatus(this.elements.connectionStatus, 'Connecting...', 'warn');
      const connection = await connectToLiveKit({
        tokenEndpoint: getTokenEndpoint(),
        roomName: this.roomName(),
        identity: this.identity(),
        role: 'host'
      });

      this.room = connection.room;
      this.bindRoomEvents(connection.room);
      setStatus(this.elements.connectionStatus, `Connected as ${connection.tokenResponse.identity}`, 'ok');
    } catch (error) {
      this.showErrorFromUnknown(error, 'Unable to connect host to LiveKit.');
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
    this.stopPublication({ resetIntent: true });

    if (this.room) {
      this.room.disconnect();
      this.room = null;
    }

    setStatus(this.elements.connectionStatus, 'Disconnected', 'idle');
    this.updateButtons();
  }

  private async publish(): Promise<void> {
    if (this.publishPromise) {
      return this.publishPromise;
    }

    this.publishPromise = this.publishInternal();

    try {
      await this.publishPromise;
    } finally {
      this.publishPromise = null;
    }
  }

  private async publishInternal(): Promise<void> {
    this.clearError();
    this.wantsPublication = true;

    if (!this.room) {
      await this.connect();
    }

    if (!this.room) {
      return;
    }

    try {
      await this.ensureMetadataLoaded();
      this.stopPublication({ resetIntent: false });

      this.capturedStream = captureMediaElementStream(this.elements.preview);
      const { videoTrack, audioTrack, summary } = getPrimaryPublishTracks(this.capturedStream);

      setStatus(this.elements.captureStatus, `Captured ${summary.videoTracks.length} video / ${summary.audioTracks.length} audio`, 'ok');
      setStatus(this.elements.captureResolutionStatus, describeCaptureResolution(videoTrack), 'ok');
      setStatus(this.elements.videoTrackStatus, `Publishing ${describeTrack(videoTrack)}`, 'warn');

      this.publishedTracks.push(videoTrack);
      const videoOutcome = await this.publishTrackBestEffort(videoTrack, {
        name: 'movie-video',
        source: Track.Source.Camera,
        simulcast: false
      });

      if (videoOutcome.status === 'failed') {
        throw videoOutcome.error;
      }

      setStatus(
        this.elements.videoTrackStatus,
        describePublishOutcome(videoOutcome, videoTrack, 'movie-video'),
        videoOutcome.status === 'confirmed' ? 'ok' : 'warn'
      );

      let audioPublished = false;
      let audioPending = false;
      if (audioTrack) {
        setStatus(this.elements.audioTrackStatus, `Publishing ${describeTrack(audioTrack)}`, 'warn');

        try {
          this.publishedTracks.push(audioTrack);
          const audioOutcome = await this.publishTrackBestEffort(audioTrack, {
            name: 'movie-audio',
            source: Track.Source.ScreenShareAudio
          });

          if (audioOutcome.status === 'failed') {
            throw audioOutcome.error;
          }

          audioPublished = audioOutcome.status === 'confirmed';
          audioPending = audioOutcome.status === 'pending';
          setStatus(
            this.elements.audioTrackStatus,
            describePublishOutcome(audioOutcome, audioTrack, 'movie-audio'),
            audioOutcome.status === 'confirmed' ? 'ok' : 'warn'
          );
        } catch (error) {
          const normalized = normalizeError(error, 'Audio track publish failed.');
          setStatus(this.elements.audioTrackStatus, `${normalized.message} (${normalized.code}); video remains published`, 'warn');
        }
      } else {
        setStatus(this.elements.audioTrackStatus, 'No audio track captured; video-only publish is allowed for this check.', 'warn');
      }

      setStatus(
        this.elements.publishStatus,
        getPublicationStatusMessage({
          trackCount: this.publishedTracks.length,
          videoPending: videoOutcome.status === 'pending',
          audioPresent: Boolean(audioTrack),
          audioPublished,
          audioPending
        }),
        videoOutcome.status === 'pending' || audioPending || (audioTrack && !audioPublished) ? 'warn' : 'ok'
      );
    } catch (error) {
      if (this.publishedTracks.length === 0) {
        this.stopPublication({ resetIntent: false });
      }
      this.showErrorFromUnknown(error, 'Unable to publish captured media.');
      setStatus(this.elements.publishStatus, this.publishedTracks.length > 0 ? 'Published with warning' : 'Publish failed', this.publishedTracks.length > 0 ? 'warn' : 'error');
    } finally {
      this.updateButtons();
    }
  }

  private async publishTrackBestEffort(track: MediaStreamTrack, options: PublishTrackInput): Promise<PublishOutcome> {
    const room = this.room;

    if (!room) {
      return { status: 'failed', error: new Error('LiveKit room is not connected.') };
    }

    let timeoutId: number | null = null;
    let cleanup = () => {};

    const ackPromise = new Promise<PublishOutcome>((resolve) => {
      const onPublished = (publication: LocalTrackPublication) => {
        if (isMatchingPublication(publication, track, options.name)) {
          cleanup();
          resolve({ status: 'confirmed', publication });
        }
      };

      cleanup = () => {
        room.off(RoomEvent.LocalTrackPublished, onPublished);
        if (timeoutId !== null) {
          window.clearTimeout(timeoutId);
          timeoutId = null;
        }
      };

      room.on(RoomEvent.LocalTrackPublished, onPublished);
    });

    const publishPromise = room.localParticipant.publishTrack(track, options).then((publication) => {
      cleanup();
      return { status: 'confirmed' as const, publication };
    }).catch((error: unknown) => {
      cleanup();
      return { status: 'failed' as const, error };
    });

    const timeoutPromise = new Promise<PublishOutcome>((resolve) => {
      timeoutId = window.setTimeout(() => {
        const existingPublication = this.findLocalPublication(options.name, track);
        cleanup();

        resolve({ status: 'pending', publication: existingPublication });
      }, publishAckTimeoutMs);
    });

    return Promise.race([publishPromise, ackPromise, timeoutPromise]);
  }

  private findLocalPublication(trackName: string, mediaTrack: MediaStreamTrack): LocalTrackPublication | null {
    if (!this.room) {
      return null;
    }

    for (const publication of this.room.localParticipant.trackPublications.values()) {
      if (isMatchingPublication(publication, mediaTrack, trackName)) {
        return publication;
      }
    }

    return null;
  }

  private stopPublication(options: { resetIntent: boolean } = { resetIntent: true }): void {
    if (options.resetIntent) {
      this.wantsPublication = false;
      if (this.republishTimer !== null) {
        window.clearTimeout(this.republishTimer);
        this.republishTimer = null;
      }
    }

    for (const track of this.publishedTracks) {
      try {
        this.room?.localParticipant.unpublishTrack(track, true);
      } catch {
        track.stop();
      }
    }

    stopMediaTracks(this.capturedStream?.getTracks());
    this.publishedTracks = [];
    this.capturedStream = null;

    setStatus(this.elements.captureStatus, 'Not captured', 'idle');
    setStatus(this.elements.captureResolutionStatus, 'Not captured', 'idle');
    setStatus(this.elements.videoTrackStatus, 'Not captured', 'idle');
    setStatus(this.elements.audioTrackStatus, 'Not captured', 'idle');
    setStatus(this.elements.publishStatus, 'Stopped', 'idle');
    this.updateButtons();
  }

  private scheduleRepublish(reason: string): void {
    if (!this.wantsPublication || !this.elements.preview.currentSrc || this.publishPromise || this.republishTimer !== null) {
      return;
    }

    setStatus(this.elements.publishStatus, `${reason}; republishing captured tracks...`, 'warn');
    this.republishTimer = window.setTimeout(() => {
      this.republishTimer = null;
      void this.publish();
    }, 250);
  }

  private async play(): Promise<void> {
    try {
      await this.elements.preview.play();
    } catch (error) {
      this.showErrorFromUnknown(error, 'Browser blocked local playback.');
    }
  }

  private async ensureMetadataLoaded(): Promise<void> {
    if (!this.elements.preview.currentSrc) {
      throw new Error('Select a local MP4 file before publishing.');
    }

    if (this.elements.preview.readyState >= 1) {
      return;
    }

    await new Promise<void>((resolve, reject) => {
      const timeoutId = window.setTimeout(() => {
        cleanup();
        reject(new Error('Timed out waiting for video metadata.'));
      }, 8000);

      const cleanup = () => {
        window.clearTimeout(timeoutId);
        this.elements.preview.removeEventListener('loadedmetadata', onLoadedMetadata);
        this.elements.preview.removeEventListener('error', onError);
      };

      const onLoadedMetadata = () => {
        cleanup();
        resolve();
      };

      const onError = () => {
        cleanup();
        reject(new Error('Unable to load video metadata.'));
      };

      this.elements.preview.addEventListener('loadedmetadata', onLoadedMetadata);
      this.elements.preview.addEventListener('error', onError);
    });
  }

  private bindRoomEvents(room: Room): void {
    room
      .on(RoomEvent.ConnectionStateChanged, (state) => {
        setStatus(this.elements.connectionStatus, `LiveKit ${String(state)}`, state === 'connected' ? 'ok' : 'warn');
      })
      .on(RoomEvent.Reconnecting, () => setStatus(this.elements.connectionStatus, 'Reconnecting...', 'warn'))
      .on(RoomEvent.Reconnected, () => {
        setStatus(this.elements.connectionStatus, 'Reconnected', 'ok');
        this.scheduleRepublish('Reconnected');
      })
      .on(RoomEvent.LocalTrackUnpublished, () => this.scheduleRepublish('Local track unpublished'))
      .on(RoomEvent.Disconnected, () => setStatus(this.elements.connectionStatus, 'Disconnected', 'warn'));
  }

  private updateTimeControls(): void {
    const { preview, seekInput, timeReadout } = this.elements;
    const duration = Number.isFinite(preview.duration) ? preview.duration : 0;
    seekInput.max = String(duration);

    if (!this.isChangingSeek) {
      seekInput.value = String(preview.currentTime || 0);
    }

    timeReadout.textContent = `${formatSeconds(preview.currentTime || 0)} / ${formatSeconds(duration)}`;
  }

  private updateSourceResolution(): void {
    const { preview } = this.elements;

    if (preview.videoWidth > 0 && preview.videoHeight > 0) {
      setStatus(this.elements.sourceResolutionStatus, `${preview.videoWidth}x${preview.videoHeight}`, 'ok');
      return;
    }

    setStatus(this.elements.sourceResolutionStatus, 'Metadata loaded, resolution unavailable', 'warn');
  }

  private cleanup(): void {
    this.stopPublication({ resetIntent: true });
    this.room?.disconnect();
    this.room = null;
    this.objectUrl = cleanupObjectUrl(this.objectUrl);
  }

  private roomName(): string {
    return this.elements.roomInput.value.trim() || getInitialRoomName();
  }

  private identity(): string {
    const value = this.elements.identityInput.value.trim();
    if (value) {
      return value;
    }

    const identity = createIdentity('host');
    this.elements.identityInput.value = identity;
    return identity;
  }

  private updateButtons(): void {
    const hasFile = Boolean(this.elements.preview.currentSrc);
    const hasRoom = Boolean(this.room);
    this.elements.publishButton.disabled = !hasFile;
    this.elements.disconnectButton.disabled = !hasRoom;
    this.elements.stopButton.disabled = this.publishedTracks.length === 0;
  }

  private clearError(): void {
    setError(this.elements.errorStatus, null);
  }

  private showError(message: string): void {
    setError(this.elements.errorStatus, message);
  }

  private showErrorFromUnknown(error: unknown, fallback: string): void {
    const normalized = normalizeError(error, fallback);
    this.showError(`${normalized.message} (${normalized.code})`);
  }
}

function getHostElements(root: HTMLElement): HostElements {
  return {
    roomInput: getRequiredElement(root, '#room-input'),
    identityInput: getRequiredElement(root, '#identity-input'),
    fileInput: getRequiredElement(root, '#file-input'),
    connectButton: getRequiredElement(root, '#connect-button'),
    reconnectButton: getRequiredElement(root, '#reconnect-button'),
    disconnectButton: getRequiredElement(root, '#disconnect-button'),
    publishButton: getRequiredElement(root, '#publish-button'),
    stopButton: getRequiredElement(root, '#stop-button'),
    playButton: getRequiredElement(root, '#play-button'),
    pauseButton: getRequiredElement(root, '#pause-button'),
    seekInput: getRequiredElement(root, '#seek-input'),
    timeReadout: getRequiredElement(root, '#time-readout'),
    preview: getRequiredElement(root, '#host-preview'),
    connectionStatus: getRequiredElement(root, '#connection-status'),
    fileStatus: getRequiredElement(root, '#file-status'),
    sourceResolutionStatus: getRequiredElement(root, '#source-resolution-status'),
    captureStatus: getRequiredElement(root, '#capture-status'),
    captureResolutionStatus: getRequiredElement(root, '#capture-resolution-status'),
    videoTrackStatus: getRequiredElement(root, '#video-track-status'),
    audioTrackStatus: getRequiredElement(root, '#audio-track-status'),
    publishStatus: getRequiredElement(root, '#publish-status'),
    errorStatus: getRequiredElement(root, '#error-status')
  };
}

function describeTrack(track: MediaStreamTrack): string {
  return `${track.kind} track: ${track.label || 'unlabeled'}, state=${track.readyState}`;
}

function describeCaptureResolution(track: MediaStreamTrack): string {
  const settings = track.getSettings();
  const size = settings.width && settings.height ? `${settings.width}x${settings.height}` : 'resolution=n/a';
  const frameRate = settings.frameRate ? `, fps=${Math.round(settings.frameRate)}` : '';
  return `${size}${frameRate}`;
}

function describePublication(publication: LocalTrackPublication, fallbackTrack: MediaStreamTrack): string {
  const sid = publication.trackSid || 'pending sid';
  const name = publication.trackName || fallbackTrack.label || 'unlabeled';
  return `${fallbackTrack.kind} track: ${name}, sid=${sid}, state=${fallbackTrack.readyState}`;
}

function describePublishOutcome(outcome: PublishOutcome, fallbackTrack: MediaStreamTrack, trackName: string): string {
  if (outcome.status === 'confirmed') {
    return describePublication(outcome.publication, fallbackTrack);
  }

  if (outcome.status === 'failed') {
    return `${trackName}: ${describeTrack(fallbackTrack)}; publish failed`;
  }

  const base = outcome.publication ? describePublication(outcome.publication, fallbackTrack) : `${trackName}: ${describeTrack(fallbackTrack)}`;
  return `${base}; LiveKit ack pending`;
}

function getPublicationStatusMessage(input: {
  trackCount: number;
  videoPending: boolean;
  audioPresent: boolean;
  audioPublished: boolean;
  audioPending: boolean;
}): string {
  if (input.videoPending && input.audioPending) {
    return `Publish started for ${input.trackCount} track(s); LiveKit ack pending`;
  }

  if (input.videoPending) {
    return input.audioPresent && !input.audioPublished
      ? 'Video started; LiveKit ack pending; audio not confirmed'
      : 'Video started; LiveKit ack pending';
  }

  if (input.audioPending) {
    return 'Published video; audio ack pending';
  }

  if (input.audioPresent && !input.audioPublished) {
    return 'Published video only; audio failed';
  }

  return `Published ${input.trackCount} track(s)`;
}

function isMatchingPublication(
  publication: LocalTrackPublication,
  mediaTrack: MediaStreamTrack,
  trackName: string
): boolean {
  const publishedTrack = publication.track as { mediaStreamTrack?: MediaStreamTrack } | undefined;
  return publication.trackName === trackName || publishedTrack?.mediaStreamTrack === mediaTrack;
}
