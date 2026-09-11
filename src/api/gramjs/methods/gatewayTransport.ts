import type {
  GatewayError, GatewayTransport as IGatewayTransport, GatewayTransportAuth,
} from '../../../lib/gramjs/client/gatewayTypes';

import type { ApiUpdateGatewayClosed } from '../../types';

import Deferred from '../../../util/Deferred';
import {
  decideGatewayClose, FORK_CLOSE_READY_TIMEOUT, FORK_CLOSE_SOCKET_FAILED,
} from '../../../util/gatewayClosePolicy';
import { logGateway, logGatewayError, logGatewayVerbose } from '../../../util/gatewayLog';

// WS client for the gateway (variant 2). Frames in both directions are JSON; request and
// response payloads are base64 of serialized TL bytes. Protocol — `telegram-fork-spec.md` §B.
// The instance outlives its sockets: on a close the policy (`gatewayClosePolicy.ts`) decides
// whether the main thread should bring a fresh token for `reconnect`, and requests still
// unanswered are re-sent once the new socket is `ready`. See `telegram-fork-tasks-09.md` §A–B.

// TODO(contract): confirm with backend whether the error frame carries a numeric code.
const DEFAULT_ERROR_CODE = 400;
// The intermediary drops a socket idle for 60 s (close `1006`) and the gateway's own ping is too
// rare, so the fork keeps traffic flowing itself; any frame in either direction resets the timer
const KEEP_ALIVE_INTERVAL_MS = 30 * 1000;
// The gateway rejects frame types it does not know, answering `malformed invoke frame`, so the
// keep-alive rides a type it already accepts: an empty analytics batch carries no data, expects no
// reply, and still counts as traffic. TODO(contract): switch to a dedicated type once agreed.
const KEEP_ALIVE_PAYLOAD = JSON.stringify({ type: 'events', events: [] });
// The gateway may take up to 30 s between `auth` and `ready` (it dials Telegram through the
// account's proxy); the fork must not give up earlier than 35 s
const READY_TIMEOUT_MS = 45 * 1000;
const READY_TIMEOUT_REASON = 'ready timeout';
const SOCKET_FAILED_REASON = 'socket open failed';

type PendingRequest = {
  payload: string;
  resolve: (responseB64: string) => void;
  reject: (error: GatewayError) => void;
  abortSignal?: AbortSignal;
  handleAbort?: NoneToVoidFunction;
};

type GatewayInboundFrame =
  | { type: 'ready'; accountId: string }
  | { type: 'result'; id: number; response: string }
  | { type: 'error'; id: number; message: string; code?: number; errorCode?: string }
  | { type: 'update'; update: string };

// `stopped` is terminal: the policy ruled out a reconnect, nothing is sent or queued anymore
type TransportState = 'connecting' | 'ready' | 'reconnecting' | 'stopped';

export type GatewayCloseInfo = Omit<ApiUpdateGatewayClosed, '@type'>;

type GatewayTransportOptions = GatewayTransportAuth & {
  onClose: (info: GatewayCloseInfo) => void;
};

export default class GatewayTransport implements IGatewayTransport {
  private url: string;

  private token: string;

  private readonly onClose: (info: GatewayCloseInfo) => void;

  private ws?: WebSocket;

  private state: TransportState = 'connecting';

  private nextRequestId = 1;

  // Sent or queued requests without a response yet; survive a reconnect and are re-sent on `ready`
  private readonly pending = new Map<number, PendingRequest>();

  private updateHandler?: (updateB64: string) => void;

  private readyDeferred = new Deferred<void>();

  private accountId?: string;

  // Consecutive closes since the last `ready` — drive the backoff and the handshake retry cap
  private failures = 0;

  private handshakeFailures = 0;

  private keepAliveTimer?: ReturnType<typeof setTimeout>;

  private readyTimer?: ReturnType<typeof setTimeout>;

  constructor({ url, token, onClose }: GatewayTransportOptions) {
    this.url = url;
    this.token = token;
    this.onClose = onClose;
  }

  connect() {
    return this.openSocket();
  }

  reconnect({ url, token }: GatewayTransportAuth) {
    this.url = url;
    this.token = token;

    return this.openSocket();
  }

  invoke(requestB64: string, dcId?: number, abortSignal?: AbortSignal) {
    const id = this.nextRequestId++;
    const payload = JSON.stringify({
      type: 'invoke', id, request: requestB64, dcId,
    });

    return new Promise<string>((resolve, reject) => {
      if (this.state === 'stopped') {
        logGatewayError('invoke dropped — gateway stopped', { id });
        reject(toGatewayError('Gateway not connected', DEFAULT_ERROR_CODE));
        return;
      }
      if (abortSignal?.aborted) {
        reject(new Error('USER_CANCELED'));
        return;
      }

      const handleAbort = abortSignal ? () => this.pending.delete(id) : undefined;
      abortSignal?.addEventListener('abort', handleAbort!, { once: true });
      this.pending.set(id, {
        payload, resolve, reject, abortSignal, handleAbort,
      });

      if (this.state !== 'ready') {
        logGatewayVerbose('invoke queued until ready', { id, state: this.state, pending: this.pending.size });
        return;
      }

      logGatewayVerbose('invoke →', { id, dcId, bytes: requestB64.length, pending: this.pending.size });
      this.send(payload);
    });
  }

  // Fire-and-forget frame (analytics `events`/`unread`) over the same WS. No response is
  // expected; silently dropped if the socket is not ready (the next flush retries). See
  // `telegram-analytics-tasks.md`.
  sendData(frame: Record<string, unknown>) {
    if (this.state !== 'ready') {
      logGatewayVerbose('sendData dropped — WS not ready', { type: frame.type });
      return false;
    }

    this.send(JSON.stringify(frame));
    return true;
  }

  setUpdateHandler(handler: (updateB64: string) => void) {
    this.updateHandler = handler;
  }

  getAccountId() {
    return this.accountId;
  }

  private openSocket() {
    this.state = 'connecting';
    this.readyDeferred = new Deferred<void>();

    if (this.ws) {
      logGatewayError('WS reopen while a socket is still alive; dropping it');
      const stale = this.ws;
      this.ws = undefined;
      stale.close();
    }

    let ws: WebSocket;
    try {
      logGateway('WS connecting →', this.url);
      ws = new WebSocket(this.url);
    } catch (err) {
      logGatewayError('WS open failed', err);
      this.handleClose(FORK_CLOSE_SOCKET_FAILED, SOCKET_FAILED_REASON);
      return this.readyDeferred.promise;
    }
    this.ws = ws;

    // Events from a socket the transport already let go of (self-closed on timeout) are ignored
    ws.addEventListener('open', () => {
      if (this.ws !== ws) return;
      logGateway('WS open; sending auth (token len', this.token.length, ')');
      ws.send(JSON.stringify({ type: 'auth', token: this.token }));
      this.readyTimer = setTimeout(() => {
        this.closeSelf(FORK_CLOSE_READY_TIMEOUT, READY_TIMEOUT_REASON);
      }, READY_TIMEOUT_MS);
    });
    ws.addEventListener('message', (event) => {
      if (this.ws !== ws) return;
      this.handleMessage(event);
    });
    ws.addEventListener('close', (event) => {
      if (this.ws !== ws) return;
      this.handleClose(event.code, event.reason);
    });
    ws.addEventListener('error', () => {
      if (this.ws !== ws) return;
      // A `close` always follows and carries the verdict
      logGatewayError('WS error event', this.state === 'ready' ? '(after ready)' : '(before ready)');
    });

    return this.readyDeferred.promise;
  }

  private handleMessage(event: MessageEvent) {
    // Inbound traffic keeps the intermediary's idle timer away just as well
    this.armKeepAlive();

    let frame: GatewayInboundFrame;
    try {
      frame = JSON.parse(event.data as string);
    } catch {
      logGatewayError('inbound frame is not JSON', typeof event.data);
      return;
    }

    switch (frame.type) {
      case 'ready':
        this.handleReady(frame.accountId);
        break;
      case 'result': {
        const pending = this.takePending(frame.id);
        logGatewayVerbose('← result', { id: frame.id, bytes: frame.response?.length, matched: Boolean(pending) });
        pending?.resolve(frame.response);
        break;
      }
      case 'error': {
        const pending = this.takePending(frame.id);
        logGatewayError('← error', {
          id: frame.id, message: frame.message, code: frame.code, errorCode: frame.errorCode,
        });
        pending?.reject(toGatewayError(frame.message, frame.code ?? DEFAULT_ERROR_CODE, frame.errorCode));
        break;
      }
      case 'update':
        // TODO(contract): confirm `update` is base64 of serialized TL bytes (not JSON).
        logGatewayVerbose('← update', { bytes: frame.update?.length });
        this.updateHandler?.(frame.update);
        break;
      default:
        logGatewayError('← unknown frame type', (frame as { type?: unknown }).type);
    }
  }

  private handleReady(accountId: string) {
    logGateway('← ready; accountId', accountId, '| queued requests', this.pending.size);
    this.clearReadyTimer();
    this.accountId = accountId;
    this.state = 'ready';
    this.failures = 0;
    this.handshakeFailures = 0;
    this.readyDeferred.resolve();

    // Everything unanswered before the close (or issued during it) goes out again
    this.pending.forEach(({ payload }) => this.send(payload));
    this.armKeepAlive();
  }

  private handleClose(code: number, reason: string) {
    this.clearReadyTimer();
    this.clearKeepAlive();
    this.ws = undefined;

    const wasReady = this.state === 'ready';
    const decision = decideGatewayClose({
      code, reason, attempt: this.failures, handshakeAttempt: this.handshakeFailures,
    });
    this.failures += 1;
    if (decision.closeClass === 'handshake') {
      this.handshakeFailures += 1;
    }

    logGatewayError('WS closed', {
      code, reason, wasReady, pending: this.pending.size, ...decision,
    });

    const error = toGatewayError(`Gateway closed (${code})`, DEFAULT_ERROR_CODE);
    if (decision.retrying) {
      this.state = 'reconnecting';
    } else {
      this.state = 'stopped';
      Array.from(this.pending.keys()).forEach((id) => this.takePending(id)!.reject(error));
    }
    if (!wasReady) {
      this.readyDeferred.reject(error);
    }

    this.onClose({
      code, reason, accountId: this.accountId, ...decision,
    });
  }

  // Forgets the request and its abort hook, so a long-lived chat signal does not pile up listeners
  private takePending(id: number) {
    const pending = this.pending.get(id);
    if (!pending) return undefined;

    this.pending.delete(id);
    pending.abortSignal?.removeEventListener('abort', pending.handleAbort!);
    return pending;
  }

  // Gives up on the current socket; the later browser `close` event is ignored as stale
  private closeSelf(code: number, reason: string) {
    const ws = this.ws;
    if (!ws) return;

    logGatewayError('WS closed by the fork', { code, reason });
    this.ws = undefined;
    ws.close();
    this.handleClose(code, reason);
  }

  private send(payload: string) {
    this.ws!.send(payload);
    this.armKeepAlive();
  }

  private armKeepAlive() {
    this.clearKeepAlive();
    if (this.state !== 'ready') return;

    this.keepAliveTimer = setTimeout(() => {
      logGatewayVerbose('keep-alive →');
      this.send(KEEP_ALIVE_PAYLOAD);
    }, KEEP_ALIVE_INTERVAL_MS);
  }

  private clearKeepAlive() {
    if (!this.keepAliveTimer) return;
    clearTimeout(this.keepAliveTimer);
    this.keepAliveTimer = undefined;
  }

  private clearReadyTimer() {
    if (!this.readyTimer) return;
    clearTimeout(this.readyTimer);
    this.readyTimer = undefined;
  }
}

function toGatewayError(message: string, code: number, gatewayErrorCode?: string): GatewayError {
  return Object.assign(new Error(message), { errorMessage: message, errorCode: code, gatewayErrorCode });
}
