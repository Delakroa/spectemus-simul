import './styles.css';
import { mountGuest } from './guest';
import { mountHost } from './host';
import { renderFrame } from './ui';
import type { Mode } from './types';

const app = document.querySelector<HTMLElement>('#app');

if (!app) {
  throw new Error('Missing #app root element.');
}

const mode = resolveMode();
const modeRoot = renderFrame(app, mode);

if (mode === 'guest') {
  mountGuest(modeRoot);
} else {
  mountHost(modeRoot);
}

function resolveMode(): Mode {
  const requestedMode = new URLSearchParams(window.location.search).get('mode');
  return requestedMode === 'guest' ? 'guest' : 'host';
}
