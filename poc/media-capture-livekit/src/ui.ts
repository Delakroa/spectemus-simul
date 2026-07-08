import type { Mode, StatusLevel } from './types';

export const defaultRoomName = 'wt-poc-room';
export const defaultTokenEndpoint = 'http://127.0.0.1:3001/token';

export function renderFrame(root: HTMLElement, mode: Mode): HTMLElement {
  const roomName = getInitialRoomName();
  const hostHref = `?mode=host&room=${encodeURIComponent(roomName)}`;
  const guestHref = `?mode=guest&room=${encodeURIComponent(roomName)}`;

  root.innerHTML = `
    <div class="app-shell">
      <header class="topbar">
        <div>
          <div class="eyebrow">WT-001 Media PoC</div>
          <h1>${mode === 'host' ? 'Host publisher' : 'Guest subscriber'}</h1>
        </div>
        <nav class="mode-nav" aria-label="PoC mode">
          <a class="${mode === 'host' ? 'active' : ''}" href="${hostHref}">Host</a>
          <a class="${mode === 'guest' ? 'active' : ''}" href="${guestHref}">Guest</a>
        </nav>
      </header>
      <div id="mode-root"></div>
    </div>
  `;

  return getRequiredElement(root, '#mode-root');
}

export function getRequiredElement<T extends Element>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (!element) {
    throw new Error(`Missing element: ${selector}`);
  }

  return element;
}

export function setStatus(element: HTMLElement, text: string, level: StatusLevel = 'idle'): void {
  element.textContent = text;
  element.dataset.level = level;
}

export function setError(element: HTMLElement, message: string | null): void {
  element.textContent = message ?? 'No error';
  element.dataset.level = message ? 'error' : 'idle';
}

export function getInitialRoomName(): string {
  const room = new URLSearchParams(window.location.search).get('room')?.trim();
  return room || defaultRoomName;
}

export function getTokenEndpoint(): string {
  return import.meta.env.VITE_TOKEN_ENDPOINT || defaultTokenEndpoint;
}

export function createIdentity(prefix: Mode): string {
  const randomPart =
    globalThis.crypto && 'randomUUID' in globalThis.crypto
      ? globalThis.crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);

  return `${prefix}-${randomPart}`;
}

export function formatSeconds(value: number): string {
  if (!Number.isFinite(value)) {
    return '0:00';
  }

  const minutes = Math.floor(value / 60);
  const seconds = Math.floor(value % 60)
    .toString()
    .padStart(2, '0');

  return `${minutes}:${seconds}`;
}
