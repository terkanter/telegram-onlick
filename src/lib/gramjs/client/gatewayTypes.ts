// Transport injected into `TelegramClient` in gateway mode (variant 2). The fork does
// no MTProto handshake and holds no key: it relays serialized requests to our WS gateway,
// which signs them with the account session and relays them to Telegram. The concrete
// implementation lives in the app layer (`src/api/gramjs/methods/gatewayTransport.ts`);
// this interface keeps the gramjs library decoupled from it. See `telegram-fork-spec.md`.

export type GatewayTransportAuth = {
  url: string;
  token: string;
};

export interface GatewayTransport {
  // Opens the WS, authenticates with the access token and resolves on the `ready` frame.
  connect(): Promise<void>;
  // Reopens the WS after a close with a fresh token; unanswered requests are re-sent on `ready`.
  reconnect(auth: GatewayTransportAuth): Promise<void>;
  // Sends a serialized request (base64) and resolves with the serialized response (base64).
  // `dcId` is forwarded for file requests so the gateway uses the right data-center.
  // An aborted request is forgotten (never re-sent after a reconnect).
  invoke(requestB64: string, dcId?: number, abortSignal?: AbortSignal): Promise<string>;
  // Registers the handler for incoming updates (base64 of a serialized TL object).
  setUpdateHandler(handler: (updateB64: string) => void): void;
  // Fire-and-forget frame (analytics `events`/`unread`) over the same WS; false if not open.
  sendData(frame: Record<string, unknown>): boolean;
}

// Rejection shape from `invoke`, carrying the fields needed to rebuild a gramjs `RPCError`.
// `gatewayErrorCode` is the backend's machine tag (e.g. `TELEGRAM_MESSAGE_BLOCKED`) used to
// branch the UI; absent for untagged errors. See `telegram-fork-roles.md` §2.
export type GatewayError = Error & {
  errorMessage: string;
  errorCode: number;
  gatewayErrorCode?: string;
};
