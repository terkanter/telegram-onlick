import { GATEWAY_ALLOWED_ORIGINS, IS_GATEWAY } from '../config';
import { createSignal } from './signals';

// Handshake between the fork (inside the platform iframe) and the platform parent,
// which brokers a short-lived gateway token. See `telegram-fork-spec.md` §A.
// All messages carry `source: GATEWAY_SOURCE`; everything else is ignored.

const GATEWAY_SOURCE = 'fanbeast-tg';

export type GatewayAuth = {
  token: string;
  gatewayUrl: string;
};

export type GatewayStatus = 'connecting' | 'ready' | 'revoked' | 'error';

type AuthMessage = {
  source: typeof GATEWAY_SOURCE;
  type: 'auth';
  token: string;
  gatewayUrl: string;
};

const [getGatewayStatus, setGatewayStatus] = createSignal<GatewayStatus>('connecting');
export { getGatewayStatus, setGatewayStatus };

let authHandler: ((auth: GatewayAuth) => void) | undefined;
let latestAuth: GatewayAuth | undefined;
let isBridgeInited = false;
// Set when a reconnect (same account, expired/revoked token) is in flight, so the next `auth`
// is treated as an in-place reconnect rather than an account switch.
let isReconnectPending = false;

// The parent (cross-origin) does not know when the iframe is ready, so the fork
// asks first; the parent replies with a freshly minted token (lives ~2 min).
export function requestGatewayAuth() {
  postToParent({ type: 'request-auth' });
}

// Registers the handler invoked for every valid `auth` — both the initial token
// and later ones pushed when the manager switches account in the platform switcher.
export function setGatewayAuthHandler(handler: (auth: GatewayAuth) => void) {
  authHandler = handler;
  if (latestAuth) handler(latestAuth);
}

export function notifyGatewayReady(accountId: string) {
  postToParent({ type: 'ready', accountId });
}

// Re-request a token after the WS dropped; the next `auth` reconnects the same account in place.
export function markGatewayReconnect() {
  isReconnectPending = true;
  requestGatewayAuth();
}

// Reads and clears the reconnect flag — true means "reconnect", false means "account switch".
export function consumeGatewayReconnect() {
  const wasReconnect = isReconnectPending;
  isReconnectPending = false;
  return wasReconnect;
}

// Installs the single `message` listener. Idempotent; safe to call on every init.
export function initGatewayBridge() {
  if (!IS_GATEWAY || isBridgeInited) return;
  isBridgeInited = true;

  window.addEventListener('message', handleParentMessage);
}

function handleParentMessage(event: MessageEvent) {
  if (!isTrustedOrigin(event.origin)) return;
  if (!isAuthMessage(event.data)) return;

  latestAuth = { token: event.data.token, gatewayUrl: event.data.gatewayUrl };
  authHandler?.(latestAuth);
}

function isTrustedOrigin(origin: string) {
  return GATEWAY_ALLOWED_ORIGINS.includes(origin);
}

function isAuthMessage(data: unknown): data is AuthMessage {
  if (typeof data !== 'object' || !data) return false;
  const message = data as Partial<AuthMessage>;
  return message.source === GATEWAY_SOURCE
    && message.type === 'auth'
    && typeof message.token === 'string'
    && typeof message.gatewayUrl === 'string';
}

// Outgoing messages are non-secret (`request-auth`/`ready`/`auth-error` carry no
// token), so `'*'` is acceptable for sending; on receive we validate origin strictly.
function postToParent(message: Record<string, unknown>) {
  window.parent.postMessage({ source: GATEWAY_SOURCE, ...message }, '*');
}
