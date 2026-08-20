import { isCurrentTabMaster } from '../establishMultitabRole';
import { queuePresence } from './telemetry';

// Presence: once a minute, report how many seconds the Telegram page was visible in that minute
// (0–60). Only the master tab reports; a hidden/minimized window contributes nothing. In the
// iframe, `visibilityState` follows the platform tab. See `telegram-analytics-tasks.md`.

const PRESENCE_WINDOW_MS = 60000;

let visibleMs = 0;
let lastVisibleStart = 0; // 0 while hidden
let timer: number | undefined;

export function startPresenceTracking() {
  if (timer) return;
  visibleMs = 0;
  lastVisibleStart = isPageVisible() ? Date.now() : 0;
  document.addEventListener('visibilitychange', handleVisibilityChange);
  timer = window.setInterval(flushWindow, PRESENCE_WINDOW_MS);
}

export function stopPresenceTracking() {
  if (timer) {
    clearInterval(timer);
    timer = undefined;
  }
  document.removeEventListener('visibilitychange', handleVisibilityChange);
  visibleMs = 0;
  lastVisibleStart = 0;
}

function isPageVisible() {
  return document.visibilityState === 'visible';
}

function handleVisibilityChange() {
  const now = Date.now();
  if (isPageVisible()) {
    lastVisibleStart = now;
  } else if (lastVisibleStart) {
    visibleMs += now - lastVisibleStart;
    lastVisibleStart = 0;
  }
}

function flushWindow() {
  const now = Date.now();
  // Fold in the currently-open visible span before reporting
  if (lastVisibleStart) {
    visibleMs += now - lastVisibleStart;
    lastVisibleStart = now;
  }

  const seconds = Math.round(visibleMs / 1000);
  if (isCurrentTabMaster()) {
    queuePresence(seconds); // `queuePresence` ignores 0 and caps at 60
  }

  visibleMs = 0;
}
