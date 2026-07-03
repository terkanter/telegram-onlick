import { GATEWAY_ALLOWED_ORIGINS, IS_GATEWAY } from '../config';
import { logGateway, logGatewayError } from './gatewayLog';
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

// Per-user platform settings pushed right after `auth` and on every toggle change.
// Named `settings` (not `blur`) so future user settings ride the same channel.
type SettingsMessage = {
  source: typeof GATEWAY_SOURCE;
  type: 'settings';
  blurImages?: boolean;
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
let latestAuth: GatewayAuth | undefined;
let isBridgeInited = false;
// Set when a reconnect (same account, expired/revoked token) is in flight, so the next `auth`
// is treated as an in-place reconnect rather than an account switch.
let isReconnectPending = false;
// The platform origin confirmed during the auth handshake; `form-content` is posted only here.
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
  postToParent({ type: 'ready', accountId });
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
  const origins = verifiedParentOrigin ? [verifiedParentOrigin] : GATEWAY_ALLOWED_ORIGINS;
  if (!origins.length) {
    logGatewayError('form-content dropped: no trusted platform origin known');
    return;
  }

  const message: FormContentMessage = { source: GATEWAY_SOURCE, type: 'form-content', ...content };
  for (const origin of origins) {
    window.parent.postMessage(message, origin);
  }

  logGateway('→ parent: form-content', {
    hasImage: Boolean(content.image),
    hasText: Boolean(content.text),
    chatType: content.chat.type,
    origins,
  });
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
