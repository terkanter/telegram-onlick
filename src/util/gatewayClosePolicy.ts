// Close policy for the gateway WS (see `telegram-fork-tasks-09.md` §A–B). The gateway tells
// causes apart by close code plus a stable machine `reason`; the fork branches on both and never
// shows `reason` to the user. Pure — applied by the worker transport, reported by the main thread.

// The server is redeploying
const GATEWAY_CLOSE_SHUTTING_DOWN = 1001;
// No close frame at all: the intermediary between the browser and the gateway dropped an idle socket
const GATEWAY_CLOSE_ABNORMAL = 1006;
export const GATEWAY_CLOSE_UNAUTHORIZED = 4401;
export const GATEWAY_CLOSE_ACCESS_REVOKED = 4403;
const GATEWAY_CLOSE_AUTH_TIMEOUT = 4408;
// The account cannot be served yet: no proxy assigned or no stored Telegram session
const GATEWAY_CLOSE_ACCOUNT_NOT_READY = 4412;
// Fork-side codes for sockets the transport gives up on itself, outside the gateway's `44xx`/`45xx`
export const FORK_CLOSE_SOCKET_FAILED = 4900;
export const FORK_CLOSE_READY_TIMEOUT = 4901;

const REASON_TELEGRAM_CONNECTION_DEAD = 'telegram connection is dead';
const REASON_EXPECTED_AUTH_FRAME = 'expected auth frame';

const RECONNECT_BASE_DELAY_MS = 1000;
const RECONNECT_MAX_DELAY_MS = 30 * 1000;
// An instant retry into a redeploying server is guaranteed to fail
const SHUTDOWN_MIN_DELAY_MS = 4000;
// A handshake failure is a fork bug rather than an account state: one retry, then stop
const MAX_HANDSHAKE_RETRIES = 1;

export type GatewayCloseClass = 'reconnect' | 'stop' | 'handshake';

export type GatewayCloseDecision = {
  closeClass: GatewayCloseClass;
  retrying: boolean;
  // Pause before a fresh token is requested; the old one is never reused
  delayMs: number;
  // The immediate `1006` retry: the platform is told only if it fails too
  isSilent: boolean;
};

type DecideGatewayCloseParams = {
  code: number;
  reason: string;
  // Consecutive closes since the last `ready`, not counting this one
  attempt: number;
  handshakeAttempt: number;
};

export function decideGatewayClose({
  code, reason, attempt, handshakeAttempt,
}: DecideGatewayCloseParams): GatewayCloseDecision {
  const closeClass = classifyGatewayClose(code, reason);

  if (closeClass === 'stop') {
    return {
      closeClass, retrying: false, delayMs: 0, isSilent: false,
    };
  }

  if (closeClass === 'handshake') {
    return {
      closeClass,
      retrying: handshakeAttempt < MAX_HANDSHAKE_RETRIES,
      delayMs: getBackoffDelay(attempt),
      isSilent: false,
    };
  }

  // An abnormal drop leaves the account's Telegram connection alive: retry at once and quietly,
  // backing off only from the second consecutive failure
  if (code === GATEWAY_CLOSE_ABNORMAL) {
    return attempt === 0
      ? {
        closeClass, retrying: true, delayMs: 0, isSilent: true,
      }
      : {
        closeClass, retrying: true, delayMs: getBackoffDelay(attempt - 1), isSilent: false,
      };
  }

  const backoffDelay = getBackoffDelay(attempt);
  const delayMs = code === GATEWAY_CLOSE_SHUTTING_DOWN ? Math.max(backoffDelay, SHUTDOWN_MIN_DELAY_MS) : backoffDelay;

  return {
    closeClass, retrying: true, delayMs, isSilent: false,
  };
}

function classifyGatewayClose(code: number, reason: string): GatewayCloseClass {
  switch (code) {
    case GATEWAY_CLOSE_ACCESS_REVOKED:
    case GATEWAY_CLOSE_ACCOUNT_NOT_READY:
      // A new token will not be issued either (or every attempt ends the same way)
      return 'stop';
    case GATEWAY_CLOSE_UNAUTHORIZED:
      if (reason === REASON_TELEGRAM_CONNECTION_DEAD) return 'reconnect';
      if (reason === REASON_EXPECTED_AUTH_FRAME) return 'handshake';
      return 'stop';
    case GATEWAY_CLOSE_AUTH_TIMEOUT:
      return 'handshake';
    default:
      // `4502`, `4500`, `1001`, `1006` and anything unknown: the backoff keeps an unknown cause from looping hot
      return 'reconnect';
  }
}

// 1 s → 2 s → 4 s → 8 s …, capped
function getBackoffDelay(attempt: number) {
  return Math.min(RECONNECT_BASE_DELAY_MS * 2 ** attempt, RECONNECT_MAX_DELAY_MS);
}
