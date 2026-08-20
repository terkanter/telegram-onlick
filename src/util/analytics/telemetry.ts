import { IS_GATEWAY } from '../../config';
import { callApi } from '../../api/gramjs';

// Telemetry producer/batcher (variant A). The main thread produces frames; the worker relays
// them over the open gateway WS. Contract: `telegram-analytics-tasks.md`, `telegram-fork-events.md`.

export type PresenceEvent = { kind: 'presence'; at: number; seconds: number };
export type MessageEvent = { kind: 'message'; at: number; chatId: string; messageId: number; out: boolean };
export type TelemetryEvent = PresenceEvent | MessageEvent;

// The backend silently drops everything over 500 in one frame — never send more.
const MAX_EVENTS_PER_FRAME = 500;
const FLUSH_INTERVAL_MS = 10000;

let buffer: TelemetryEvent[] = [];
// A message can be observed more than once — from another tab, a backfill overlapping a live
// event, or a retry. Dedup by its server key so each is counted once.
const seenMessageKeys = new Set<string>();
let flushTimer: number | undefined;

export function startTelemetry() {
  if (!IS_GATEWAY || flushTimer) return;
  flushTimer = window.setInterval(flush, FLUSH_INTERVAL_MS);
}

export function stopTelemetry() {
  if (flushTimer) {
    clearInterval(flushTimer);
    flushTimer = undefined;
  }
  buffer = [];
}

// Only the tab that started collecting (`startTelemetry`, i.e. the one that inits the gateway)
// buffers — other tabs must not accumulate events they will never flush.
function isCollecting() {
  return Boolean(flushTimer);
}

export function queuePresence(seconds: number) {
  if (!isCollecting() || seconds <= 0) return;
  buffer.push({ kind: 'presence', at: Date.now(), seconds: Math.min(seconds, 60) });
  maybeFlush();
}

// `at` is the message's own server time (ms) so it lands in the correct day bucket, live or
// backfilled. `dedupKey` is the message's server key (`msg<chatId>-<id>`).
export function queueMessageEvent(dedupKey: string, at: number, chatId: string, messageId: number, out: boolean) {
  if (!isCollecting() || seenMessageKeys.has(dedupKey)) return;
  seenMessageKeys.add(dedupKey);
  buffer.push({
    kind: 'message', at, chatId, messageId, out,
  });
  maybeFlush();
}

export function reportUnread(chats: number, messages: number) {
  if (!IS_GATEWAY) return;
  void callApi('sendGatewayUnread', { at: Date.now(), chats, messages });
}

// Account switch reopens the connection in place; drop the dedup so the next account's backfill
// isn't suppressed by the previous account's keys.
export function resetMessageDedup() {
  seenMessageKeys.clear();
}

function maybeFlush() {
  if (buffer.length >= MAX_EVENTS_PER_FRAME) flush();
}

function flush() {
  if (!buffer.length) return;
  const events = buffer.splice(0, MAX_EVENTS_PER_FRAME);
  void callApi('sendGatewayEvents', { events });
  // Drain the rest across frames if the queue outran a single batch
  if (buffer.length >= MAX_EVENTS_PER_FRAME) flush();
}
