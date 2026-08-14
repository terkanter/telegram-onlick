import { RE_TME_LINK } from '../config';

// t.me paths that are features/invites, not a public username (so they reveal no person/channel).
const TME_RESERVED_PATHS = new Set([
  'joinchat', 'addstickers', 'addemoji', 'addlist', 'addtheme', 'setlanguage',
  'confirmphone', 'socks', 'proxy', 'share', 'iv', 'bg', 'login', 'c', 's', 'boost', 'm',
]);

// A t.me link whose first path segment is a public username — i.e. reveals a person/channel
// (`t.me/durov`, `t.me/durov/5`), as opposed to invite hashes (`t.me/+...`, `/joinchat/...`)
// or feature paths (`/addstickers/...`). Used to gate username display under the roles flag.
export function isTelegramUsernameLink(url?: string): boolean {
  if (!url || !RE_TME_LINK.test(url)) return false;
  const firstSegment = url.match(/t\.me\/([^/?#]+)/i)?.[1];
  if (!firstSegment || firstSegment.startsWith('+')) return false;
  return !TME_RESERVED_PATHS.has(firstSegment.toLowerCase());
}

// Masks the username in a t.me link for display: `https://t.me/durov/5` → `t.me/…`
export function maskTelegramUsernameLink(text: string): string {
  return text.replace(/(t\.me\/)\S*/i, '$1…');
}
