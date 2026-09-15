import { ASSET_CACHE_NAME, BUILD_ENTRY_FILE } from '../config';
import { logGateway, logGatewayError } from './gatewayLog';

// Holds the entry a reset already targeted in this tab, so a page that stays stale does not reload in a loop
const RESET_ENTRY_STORAGE_KEY = 'tg-gw-build-reset';
const ENTRY_FILE_NAME_REGEX = /^[\w./-]+\.js$/;

let deferredEntryUrl: string | undefined;

// The page runs a stale build when its entry script differs from the one the server ships. That happens
// when the service worker answers from its cache or the tab outlives a deploy.
export async function checkStaleBuild(shouldResetAtOnce?: boolean) {
  const entryUrl = await fetchCurrentEntryUrl();
  if (!entryUrl || checkIsEntryRunning(entryUrl)) return;

  logGateway('stale build detected, current entry:', entryUrl);

  if (shouldResetAtOnce || document.hidden) {
    await resetStaleBuild(entryUrl);
    return;
  }

  // A visible tab resets once the user leaves it, so the reload does not interrupt the work
  if (!deferredEntryUrl) {
    document.addEventListener('visibilitychange', handleVisibilityChange);
  }
  deferredEntryUrl = entryUrl;
}

function handleVisibilityChange() {
  if (!document.hidden) return;

  const entryUrl = deferredEntryUrl!;
  deferredEntryUrl = undefined;
  document.removeEventListener('visibilitychange', handleVisibilityChange);
  void resetStaleBuild(entryUrl);
}

async function fetchCurrentEntryUrl() {
  try {
    const response = await fetch(`${BUILD_ENTRY_FILE}?${Date.now()}`, { cache: 'no-store' });
    if (!response.ok) return undefined;

    const fileName = (await response.text()).trim();
    return ENTRY_FILE_NAME_REGEX.test(fileName) ? new URL(fileName, document.baseURI).href : undefined;
  } catch {
    return undefined;
  }
}

function checkIsEntryRunning(entryUrl: string) {
  return Array.from(document.scripts).some((script) => script.src === entryUrl);
}

async function resetStaleBuild(entryUrl: string) {
  if (!markResetEntry(entryUrl)) {
    logGatewayError('stale build persists after a reset, keeping the page');
    return;
  }

  try {
    // The service worker answers with this copy of the page when the network is slow
    const cache = await caches.open(ASSET_CACHE_NAME);
    await cache.delete(window.location.href, { ignoreSearch: true });
  } catch {
    // Without the cache the reload still gets the page from the network
  }

  window.location.reload();
}

// Returns `false` when this tab has already reset for the entry or cannot remember the attempt
function markResetEntry(entryUrl: string) {
  try {
    if (sessionStorage.getItem(RESET_ENTRY_STORAGE_KEY) === entryUrl) return false;

    sessionStorage.setItem(RESET_ENTRY_STORAGE_KEY, entryUrl);
    return true;
  } catch {
    return false;
  }
}
