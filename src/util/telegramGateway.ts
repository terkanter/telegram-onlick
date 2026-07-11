import { GATEWAY_ALLOWED_ORIGINS, IS_GATEWAY } from '../config';
import { logGateway, logGatewayError } from './gatewayLog';
import { debounce } from './schedulers';
import { createSignal } from './signals';

// Handshake between the fork (inside the platform iframe) and the platform parent,
// which brokers a short-lived gateway token. See `telegram-fork-spec.md` §A.
// All messages carry `source: GATEWAY_SOURCE`; everything else is ignored.

const GATEWAY_SOURCE = 'fanbeast-tg';
// Route memory contract: longer routes must not reach the platform's `localStorage`
const MAX_ROUTE_LENGTH = 512;
const ROUTE_CHANGE_DEBOUNCE_MS = 300;

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

// Per-user platform settings pushed right after `auth` and on every toggle change.
// Named `settings` (not `blur`) so future user settings ride the same channel.
type SettingsMessage = {
  source: typeof GATEWAY_SOURCE;
  type: 'settings';
  blurImages?: boolean;
};

// Route memory (see `telegram-fork-route-memory.md`): the platform stores `route` verbatim
// per account and echoes it back in `navigate` after `ready`. The route is our own message
// list hash serialization (`createLocationHash`); `accountId` guards against races on
// account switch.
type RouteChangeMessage = {
  source: typeof GATEWAY_SOURCE;
  type: 'route-change';
  accountId: string;
  route: string;
};

type NavigateMessage = {
  source: typeof GATEWAY_SOURCE;
  type: 'navigate';
  accountId: string;
  route: string;
};

export type FormContentUsername = {
  username: string;
  isActive?: boolean;
};

type FormContentChatType = 'private' | 'group' | 'channel';

export type FormContentChat = {
  type: FormContentChatType;
  id: string;
  title?: string;
  usernames?: FormContentUsername[];
};

export type FormContentUser = {
  usernames?: FormContentUsername[];
};

// Content selected in a chat, forwarded to the platform's post-creation form. See
// `telegram-fork-form-content.md`. Carries conversation data, so it is only sent to a
// verified platform origin (never `'*'`), unlike the token-less handshake messages.
type FormContentMessage = {
  source: typeof GATEWAY_SOURCE;
  type: 'form-content';
  image?: string;
  text?: string;
  chat: FormContentChat;
  user?: FormContentUser;
};

const [getGatewayStatus, setGatewayStatus] = createSignal<GatewayStatus>('connecting');
export { getGatewayStatus, setGatewayStatus };

// `0` means blur is off. Each enable produces a new monotonic generation, so media
// revealed with the per-media eye control get hidden again on re-enable.
const [getBlurImagesGeneration, setBlurImagesGeneration] = createSignal(0);
export { getBlurImagesGeneration };

let blurGenerationCounter = 0;

let authHandler: ((auth: GatewayAuth) => void) | undefined;
let navigateHandler: ((route: string) => void) | undefined;
let latestAuth: GatewayAuth | undefined;
let isBridgeInited = false;
// The account announced to the parent in the last `ready`; stamps outgoing `route-change`
// and fences off `navigate` from a stale account during a switch
let currentAccountId: string | undefined;
// Set when a reconnect (same account, expired/revoked token) is in flight, so the next `auth`
// is treated as an in-place reconnect rather than an account switch.
let isReconnectPending = false;
// The platform origin confirmed during the auth handshake; private-data messages
// (`form-content`, `route-change`) are posted only here.
let verifiedParentOrigin: string | undefined;

// The parent (cross-origin) does not know when the iframe is ready, so the fork
// asks first; the parent replies with a freshly minted token (lives ~2 min).
export function requestGatewayAuth() {
  logGateway('→ parent: request-auth');
  postToParent({ type: 'request-auth' });
}

// Registers the handler invoked for every valid `auth` — both the initial token
// and later ones pushed when the manager switches account in the platform switcher.
export function setGatewayAuthHandler(handler: (auth: GatewayAuth) => void) {
  authHandler = handler;
  if (latestAuth) handler(latestAuth);
}

export function notifyGatewayReady(accountId: string) {
  logGateway('→ parent: ready', { accountId });
  currentAccountId = accountId;
  postToParent({ type: 'ready', accountId });
}

// Registers the handler invoked for every valid `navigate` addressed to the current account
export function setGatewayNavigateHandler(handler: (route: string) => void) {
  navigateHandler = handler;
}

// Debounced so rapid chat hopping produces one message; the trailing call guarantees
// the final state is sent
export const reportGatewayRouteChange = debounce(postRouteChangeToParent, ROUTE_CHANGE_DEBOUNCE_MS, false);

// Sent strictly to the verified platform origin (never `'*'`) — `route` contains private chat ids
function postRouteChangeToParent(route: string) {
  if (!currentAccountId) {
    logGatewayError('route-change dropped: account not announced via `ready` yet');
    return;
  }
  if (route.length > MAX_ROUTE_LENGTH) {
    logGatewayError('route-change dropped: route exceeds', MAX_ROUTE_LENGTH, 'chars');
    return;
  }

  const message: RouteChangeMessage = {
    source: GATEWAY_SOURCE, type: 'route-change', accountId: currentAccountId, route,
  };
  if (!postToTrustedParent(message)) {
    logGatewayError('route-change dropped: no trusted platform origin known');
    return;
  }

  logGateway('→ parent: route-change', { accountId: currentAccountId, route });
}

// Re-request a token after the WS dropped; the next `auth` reconnects the same account in place.
export function markGatewayReconnect() {
  logGateway('reconnect requested (broken WS)');
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

  logGateway('bridge installed; trusted origins:', GATEWAY_ALLOWED_ORIGINS);
  window.addEventListener('message', handleParentMessage);
}

function handleParentMessage(event: MessageEvent) {
  const data = event.data as { source?: unknown; type?: unknown } | undefined;
  // Only trace our own messages to avoid noise from unrelated postMessage traffic.
  if (data?.source !== 'fanbeast-tg') return;

  if (!isTrustedOrigin(event.origin)) {
    logGatewayError('rejected message from untrusted origin', event.origin, '(allowed:', GATEWAY_ALLOWED_ORIGINS, ')');
    return;
  }
  if (isSettingsMessage(event.data)) {
    handleSettingsMessage(event.data);
    return;
  }
  if (isNavigateMessage(event.data)) {
    handleNavigateMessage(event.data);
    return;
  }
  if (!isAuthMessage(event.data)) {
    logGatewayError('ignored malformed message from', event.origin, 'type:', data?.type);
    return;
  }

  logGateway('← parent: auth accepted from', event.origin, '| gatewayUrl', event.data.gatewayUrl,
    '| token len', event.data.token.length);
  verifiedParentOrigin = event.origin;
  latestAuth = { token: event.data.token, gatewayUrl: event.data.gatewayUrl };
  authHandler?.(latestAuth);
}

// Posts selected chat content to the platform. Strictly targeted at the verified origin
// (falls back to the configured allow-list) — never `'*'`, since it carries conversation data.
export function postFormContentToParent(content: Omit<FormContentMessage, 'source' | 'type'>) {
  const message: FormContentMessage = { source: GATEWAY_SOURCE, type: 'form-content', ...content };
  if (!postToTrustedParent(message)) {
    logGatewayError('form-content dropped: no trusted platform origin known');
    return;
  }

  logGateway('→ parent: form-content', {
    hasImage: Boolean(content.image),
    hasText: Boolean(content.text),
    chatType: content.chat.type,
  });
}

// Posts a private-data message strictly to the verified platform origin (falls back to the
// configured allow-list) — never `'*'`. Returns false when no trusted origin is known.
function postToTrustedParent(message: Record<string, unknown>) {
  const origins = verifiedParentOrigin ? [verifiedParentOrigin] : GATEWAY_ALLOWED_ORIGINS;
  if (!origins.length) {
    return false;
  }

  for (const origin of origins) {
    window.parent.postMessage(message, origin);
  }

  return true;
}

function isTrustedOrigin(origin: string) {
  return GATEWAY_ALLOWED_ORIGINS.includes(origin);
}

// Applies only known settings; unknown fields from newer platform versions are ignored.
// Re-enabling blur mints a fresh generation, duplicate `blurImages: true` is a no-op.
function handleSettingsMessage(message: SettingsMessage) {
  logGateway('← parent: settings | blurImages', message.blurImages);

  if (typeof message.blurImages !== 'boolean') return;

  if (!message.blurImages) {
    setBlurImagesGeneration(0);
  } else if (getBlurImagesGeneration() === 0) {
    blurGenerationCounter += 1;
    setBlurImagesGeneration(blurGenerationCounter);
  }
}

function isSettingsMessage(data: unknown): data is SettingsMessage {
  if (typeof data !== 'object' || !data) return false;
  const message = data as Partial<SettingsMessage>;
  return message.source === GATEWAY_SOURCE && message.type === 'settings';
}

// A `navigate` from a mismatched account is a race during account switch — ignore silently.
// Route validity is checked by the navigate handler; an unusable route keeps the default screen.
function handleNavigateMessage(message: NavigateMessage) {
  if (!currentAccountId || message.accountId !== currentAccountId) {
    logGateway('navigate ignored: accountId mismatch (message:', message.accountId,
      '| current:', currentAccountId, ')');
    return;
  }
  if (message.route.length > MAX_ROUTE_LENGTH) {
    logGatewayError('navigate ignored: route exceeds', MAX_ROUTE_LENGTH, 'chars');
    return;
  }

  logGateway('← parent: navigate', { route: message.route });
  navigateHandler?.(message.route);
}

function isNavigateMessage(data: unknown): data is NavigateMessage {
  if (typeof data !== 'object' || !data) return false;
  const message = data as Partial<NavigateMessage>;
  return message.source === GATEWAY_SOURCE
    && message.type === 'navigate'
    && typeof message.accountId === 'string'
    && typeof message.route === 'string';
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
