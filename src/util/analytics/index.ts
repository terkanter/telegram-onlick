import backfillHistory from './backfill';
import { startPresenceTracking, stopPresenceTracking } from './presence';
import { startTelemetry, stopTelemetry } from './telemetry';
import { startUnreadTracking, stopUnreadTracking } from './unread';

// Telemetry for the analytics contract (variant A — frames over the gateway WS). Started once
// when the gateway inits; `backfillHistory` is re-run after each sync. See
// `telegram-fork-events.md` / `telegram-analytics-tasks.md`.

export { backfillHistory };
export { resetMessageDedup } from './telemetry';

let isStarted = false;

export function startAnalytics() {
  if (isStarted) return;
  isStarted = true;
  startTelemetry();
  startPresenceTracking();
  startUnreadTracking();
}

export function stopAnalytics() {
  if (!isStarted) return;
  isStarted = false;
  stopTelemetry();
  stopPresenceTracking();
  stopUnreadTracking();
}
