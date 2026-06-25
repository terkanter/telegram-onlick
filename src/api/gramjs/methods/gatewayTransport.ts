import type { GatewayError, GatewayTransport as IGatewayTransport } from '../../../lib/gramjs/client/gatewayTypes';

import Deferred from '../../../util/Deferred';

// WS client for the gateway (variant 2). Frames in both directions are JSON; request and
// response payloads are base64 of serialized TL bytes. Protocol — `telegram-fork-spec.md` §B.
// A close (incl. code 4401 "revoked/invalid") surfaces as a broken state; the main thread
// re-requests a token and reconnects.

// TODO(contract): confirm with backend whether the error frame carries a numeric code.
const DEFAULT_ERROR_CODE = 400;

type PendingRequest = {
  resolve: (responseB64: string) => void;
  reject: (error: GatewayError) => void;
};

type GatewayInboundFrame =
  | { type: 'ready'; accountId: string }
  | { type: 'result'; id: number; response: string }
  | { type: 'error'; id: number; message: string; code?: number }
  | { type: 'update'; update: string };

type GatewayTransportOptions = {
  url: string;
  token: string;
  onClose?: (code: number) => void;
};

export default class GatewayTransport implements IGatewayTransport {
  private readonly url: string;

  private readonly token: string;

  private readonly onClose?: (code: number) => void;

  private ws?: WebSocket;

  private nextRequestId = 1;

  private readonly pending = new Map<number, PendingRequest>();

  private updateHandler?: (updateB64: string) => void;

  private readyDeferred = new Deferred<void>();

  private isReady = false;

  private accountId?: string;

  constructor({ url, token, onClose }: GatewayTransportOptions) {
    this.url = url;
    this.token = token;
    this.onClose = onClose;
  }

  connect() {
    // TODO(contract): app-level keepalive (ping/pong frame) to detect a silently dropped WS
    // behind the proxy — needs a backend-defined frame. Until then we rely on the `close` event.
    const ws = new WebSocket(this.url);
    this.ws = ws;

    ws.addEventListener('open', () => {
      ws.send(JSON.stringify({ type: 'auth', token: this.token }));
    });
    ws.addEventListener('message', (event) => this.handleMessage(event));
    ws.addEventListener('close', (event) => this.handleClose(event.code));
    ws.addEventListener('error', () => {
      if (!this.isReady) {
        this.readyDeferred.reject(new Error('Gateway WS error'));
      }
    });

    return this.readyDeferred.promise;
  }

  invoke(requestB64: string, dcId?: number) {
    const id = this.nextRequestId++;
    const frame = { type: 'invoke', id, request: requestB64, dcId };

    return new Promise<string>((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        reject(toGatewayError('Gateway not connected', DEFAULT_ERROR_CODE));
        return;
      }

      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify(frame));
    });
  }

  setUpdateHandler(handler: (updateB64: string) => void) {
    this.updateHandler = handler;
  }

  disconnect() {
    this.ws?.close();
    this.ws = undefined;
  }

  getAccountId() {
    return this.accountId;
  }

  private handleMessage(event: MessageEvent) {
    let frame: GatewayInboundFrame;
    try {
      frame = JSON.parse(event.data as string);
    } catch {
      return;
    }

    switch (frame.type) {
      case 'ready':
        this.accountId = frame.accountId;
        this.isReady = true;
        this.readyDeferred.resolve();
        break;
      case 'result': {
        const pending = this.pending.get(frame.id);
        if (!pending) return;
        this.pending.delete(frame.id);
        pending.resolve(frame.response);
        break;
      }
      case 'error': {
        const pending = this.pending.get(frame.id);
        if (!pending) return;
        this.pending.delete(frame.id);
        pending.reject(toGatewayError(frame.message, frame.code ?? DEFAULT_ERROR_CODE));
        break;
      }
      case 'update':
        // TODO(contract): confirm `update` is base64 of serialized TL bytes (not JSON).
        this.updateHandler?.(frame.update);
        break;
    }
  }

  private handleClose(code: number) {
    const error = toGatewayError(`Gateway closed (${code})`, DEFAULT_ERROR_CODE);
    this.pending.forEach((pending) => pending.reject(error));
    this.pending.clear();

    if (!this.isReady) {
      this.readyDeferred.reject(error);
    }

    this.ws = undefined;
    this.onClose?.(code);
  }
}

function toGatewayError(message: string, code: number): GatewayError {
  return Object.assign(new Error(message), { errorMessage: message, errorCode: code });
}
