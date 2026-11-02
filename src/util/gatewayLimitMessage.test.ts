import { describe, expect, it } from 'vitest';

import getGatewayLimitMessage from './gatewayLimitMessage';

const NOW = new Date(2026, 10, 2, 10, 0);

describe('getGatewayLimitMessage', () => {
  it('names the time of a limit ending today', () => {
    const until = new Date(2026, 10, 2, 15, 30).toISOString();
    const time = new Date(until).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

    expect(getGatewayLimitMessage(until, undefined, NOW))
      .toBe(`Telegram limited this action for the account until ${time}`);
  });

  it('adds the day of a limit ending later', () => {
    const until = new Date(2026, 10, 5, 15, 30);
    const day = until.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

    expect(getGatewayLimitMessage(until.toISOString(), undefined, NOW)).toContain(`until ${day}, `);
  });

  it('says when the blocklist caused it', () => {
    const until = new Date(2026, 10, 2, 15, 30).toISOString();

    expect(getGatewayLimitMessage(until, 'blocklist', NOW))
      .toMatch(/: the account was blocking people from the blocklist$/);
    expect(getGatewayLimitMessage(until, 'other', NOW)).not.toContain('blocklist');
  });
});
