import { ASSET_CACHE_NAME } from '../config';
import { pause } from '../util/schedulers';

declare const self: ServiceWorkerGlobalScope;

// An attempt to fix freezing UI on iOS
const TIMEOUT = 3000;

export async function respondWithCacheNetworkFirst(e: FetchEvent) {
  const remotePromise = fetch(e.request);
  // A response that misses the timeout still refreshes the cache, so a slow network serves a stale copy only once
  e.waitUntil(saveToCache(e.request, remotePromise));

  const remote = await withTimeout(() => remotePromise, TIMEOUT);
  if (!remote?.ok) {
    return respondWithCache(e);
  }

  return remote;
}

export async function respondWithCache(e: FetchEvent) {
  const cacheResult = await withTimeout(async () => {
    const cache = await self.caches.open(ASSET_CACHE_NAME);
    const cached = await cache.match(e.request);

    return { cache, cached };
  }, TIMEOUT);

  const { cache, cached } = cacheResult || {};

  if (cache && cached) {
    if (cached.ok) {
      return cached;
    } else {
      await cache.delete(e.request);
    }
  }

  const remote = await fetch(e.request);

  if (remote.ok && cache) {
    cache.put(e.request, remote.clone());
  }

  return remote;
}

async function saveToCache(request: Request, remotePromise: Promise<Response>) {
  const remote = await remotePromise.catch(() => undefined);
  if (!remote?.ok) return;

  // Cloned before the next `await`, while the page has not started reading the body
  const toCache = remote.clone();
  const cache = await self.caches.open(ASSET_CACHE_NAME);
  await cache.put(request, toCache);
}

async function withTimeout<T>(cb: () => Promise<T>, timeout: number) {
  let isResolved = false;

  try {
    return await Promise.race([
      pause(timeout).then(() => (isResolved ? undefined : Promise.reject(new Error('TIMEOUT')))),
      cb(),
    ]);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(err);
    return undefined;
  } finally {
    isResolved = true;
  }
}

export function clearAssetCache() {
  return self.caches.delete(ASSET_CACHE_NAME);
}
