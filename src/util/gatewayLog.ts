import { IS_GATEWAY } from '../config';

// Verbose tracing for the gateway integration phase. Active in any gateway build
// (`TG_GATEWAY=1`). Filter the console by `[tg-gw]`. Never logs tokens or payload bytes —
// only ids, sizes, class names and lengths. Flip the guard to silence.

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
