// Transport injected into `TelegramClient` in gateway mode (variant 2). The fork does
// no MTProto handshake and holds no key: it relays serialized requests to our WS gateway,
// which signs them with the account session and relays them to Telegram. The concrete
// implementation lives in the app layer (`src/api/gramjs/methods/gatewayTransport.ts`);
// this interface keeps the gramjs library decoupled from it. See `telegram-fork-spec.md`.

export interface GatewayTransport {
  // Opens the WS, authenticates with the access token and resolves on the `ready` frame.
  connect(): Promise<void>;
  // Sends a serialized request (base64) and resolves with the serialized response (base64).
  // `dcId` is forwarded for file requests so the gateway uses the right data-center.
  invoke(requestB64: string, dcId?: number): Promise<string>;
  // Registers the handler for incoming updates (base64 of a serialized TL object).
  setUpdateHandler(handler: (updateB64: string) => void): void;
  disconnect(): void;
}

// Rejection shape from `invoke`, carrying the fields needed to rebuild a gramjs `RPCError`.
export type GatewayError = Error & {
  errorMessage: string;
  errorCode: number;
};
