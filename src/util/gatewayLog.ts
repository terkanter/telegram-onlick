import { IS_GATEWAY } from '../config';

// Verbose tracing for the gateway integration phase. Active in any gateway build
// (`TG_GATEWAY=1`). Filter the console by `[tg-gw]`. Never logs tokens or payload bytes —
// only ids, sizes, class names and lengths.

export function logGateway(...args: unknown[]) {
  if (!IS_GATEWAY) return;
  // eslint-disable-next-line no-console
  console.log('%c[tg-gw]', 'color:#3390ec;font-weight:bold', ...args);
}

export function logGatewayError(...args: unknown[]) {
  if (!IS_GATEWAY) return;
  // eslint-disable-next-line no-console
  console.error('%c[tg-gw]', 'color:#e53935;font-weight:bold', ...args);
}

// Per-frame RPC/WS traffic tracing (every invoke/result/update) — too chatty for everyday use, so
// it is opt-in per browser. The switch lives in the main thread's `localStorage`
// (`GATEWAY_VERBOSE_STORAGE_KEY`) and is forwarded to the worker with the init args, since the
// transport that sees the frames runs there and has no `localStorage` of its own.
let isVerbose = false;

export function setGatewayVerbose(value: boolean) {
  isVerbose = value;
}

export function logGatewayVerbose(...args: unknown[]) {
  if (!isVerbose) return;
  logGateway(...args);
}
