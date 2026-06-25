import type { ActionReturnType } from '../../types';
import { ManagementProgress } from '../../../types';

import {
  CUSTOM_BG_CACHE_NAME,
  IS_GATEWAY,
  LANG_CACHE_NAME,
  LOCK_SCREEN_ANIMATION_DURATION_MS,
  MEDIA_CACHE_NAME,
  MEDIA_CACHE_NAME_AVATARS,
  MEDIA_PROGRESSIVE_CACHE_NAME,
} from '../../../config';
import { updateAppBadge } from '../../../util/appBadge';
import { PASSCODE_IDB_STORE } from '../../../util/browser/idb';
import { toCredentialRequestOptions } from '../../../util/browser/passkeys';
import {
  IS_WEBAUTHN_SUPPORTED,
  IS_WEBM_SUPPORTED, MAX_BUFFER_SIZE, PLATFORM_ENV,
} from '../../../util/browser/windowEnvironment';
import * as cacheApi from '../../../util/cacheApi';
import { getCurrentTabId } from '../../../util/establishMultitabRole';
import { ACCOUNT_SLOT, getAccountsInfo } from '../../../util/multiaccount';
import { unsubscribe } from '../../../util/notifications';
import { clearEncryptedSession, encryptSession, forgetPasscode } from '../../../util/passcode';
import { logGateway } from '../../../util/gatewayLog';
import { parseInitialLocationHash, resetInitialLocationHash, resetLocationHash } from '../../../util/routing';
import { pause } from '../../../util/schedulers';
import {
  consumeGatewayReconnect, initGatewayBridge, requestGatewayAuth, setGatewayAuthHandler,
} from '../../../util/telegramGateway';
import {
  clearStoredSession,
  loadStoredSession,
  storeSession,
} from '../../../util/sessions';
import { forceWebsync } from '../../../util/websync';
import {
  callApi, callApiLocal, initApi, setShouldEnableDebugLog,
} from '../../../api/gramjs';
import { removeGlobalFromCache, removeSharedStateFromCache, serializeGlobal } from '../../cache';
import {
  addActionHandler, getGlobal, setGlobal,
} from '../../index';
import {
  clearGlobalForLockScreen, updateManagementProgress, updatePasscodeSettings,
} from '../../reducers';
import { updateAuth } from '../../reducers/auth';
import { selectSharedSettings } from '../../selectors/sharedState';
import { destroySharedStatePort } from '../../shared/sharedStateConnector';

addActionHandler('initApi', (global, actions): ActionReturnType => {
  if (IS_GATEWAY) {
    // Variant 2: the platform brokers a short-lived token; the fork never logins itself and
    // stores no session. On `auth`, init the worker with the gateway endpoint + token.
    const { language: gatewayLangCode } = selectSharedSettings(global);
    let isGatewayInited = false;

    logGateway('initApi: gateway mode');
    initGatewayBridge();
    setGatewayAuthHandler((auth) => {
      if (!isGatewayInited) {
        isGatewayInited = true;
        logGateway('auth #1 → init worker', { gatewayUrl: auth.gatewayUrl });
        void initApi(actions.apiUpdate, {
          userAgent: navigator.userAgent,
          platform: PLATFORM_ENV,
          langCode: gatewayLangCode,
          gatewayUrl: auth.gatewayUrl,
          gatewayToken: auth.token,
        });
        return;
      }

      if (consumeGatewayReconnect()) {
        // Same account, fresh token — reconnect in place, keep cache and update state.
        logGateway('auth → reconnect in place (reinitGateway)');
        void callApi('reinitGateway', { gatewayUrl: auth.gatewayUrl, gatewayToken: auth.token });
        return;
      }

      // Account switch — reinit under the new account. TODO(A.5): in-place instead of reload.
      logGateway('auth → account switch (iframe reload)');
      window.location.reload();
    });
    requestGatewayAuth();
    return;
  }

  const initialLocationHash = parseInitialLocationHash();
  const {
    shouldAllowHttpTransport,
    shouldForceHttpTransport,
    shouldDebugExportedSenders,
    shouldCollectDebugLogs,
    language,
  } = selectSharedSettings(global);

  const hasTestParam = window.location.search.includes('test') || initialLocationHash?.tgWebAuthTest === '1';

  const isTestServer = global.config?.isTestServer;
  const accountsInfo = getAccountsInfo();
  const accountIds = Object.values(accountsInfo)
    .filter((info) => info.isTest === isTestServer)
    .map(({ userId }) => userId)
    .filter(Boolean);

  void initApi(actions.apiUpdate, {
    userAgent: navigator.userAgent,
    platform: PLATFORM_ENV,
    sessionData: loadStoredSession(),
    isWebmSupported: IS_WEBM_SUPPORTED,
    maxBufferSize: MAX_BUFFER_SIZE,
    webAuthToken: initialLocationHash?.tgWebAuthToken,
    dcId: initialLocationHash?.tgWebAuthDcId ? Number(initialLocationHash?.tgWebAuthDcId) : undefined,
    mockScenario: initialLocationHash?.mockScenario,
    shouldAllowHttpTransport,
    shouldForceHttpTransport,
    shouldDebugExportedSenders,
    langCode: language,
    isTestServerRequested: hasTestParam,
    accountIds,
    hasPasskeySupport: IS_WEBAUTHN_SUPPORTED,
  });

  void setShouldEnableDebugLog(Boolean(shouldCollectDebugLogs));
});

addActionHandler('setAuthPhoneNumber', (global, actions, payload): ActionReturnType => {
  const { phoneNumber } = payload;

  void callApi('provideAuthPhoneNumber', phoneNumber.replace(/[^\d]/g, ''));

  return updateAuth(global, {
    isLoading: true,
    errorKey: undefined,
  });
});

addActionHandler('setAuthCode', (global, actions, payload): ActionReturnType => {
  const { code } = payload;

  void callApi('provideAuthCode', code);

  return updateAuth(global, {
    isLoading: true,
    errorKey: undefined,
  });
});

addActionHandler('setAuthPassword', (global, actions, payload): ActionReturnType => {
  const { password } = payload;

  void callApi('provideAuthPassword', password);

  return updateAuth(global, {
    isLoading: true,
    errorKey: undefined,
  });
});

addActionHandler('loginWithPasskey', async (global, actions, payload): Promise<void> => {
  const passkeyOption = global.auth.passkeyOption;
  if (!passkeyOption) return;

  const credential = await navigator.credentials.get(toCredentialRequestOptions(passkeyOption)).catch((e: unknown) => {
    actions.showNotification({
      message: {
        key: 'PasskeyLoginError',
      },
      tabId: getCurrentTabId(),
    });
  });
  if (!credential) return;

  const publicKeyCredential = credential as PublicKeyCredential;
  callApi('restartAuthWithPasskey', publicKeyCredential.toJSON() as AuthenticationResponseJSON);
});

addActionHandler('uploadProfilePhoto', async (global, actions, payload): Promise<void> => {
  const {
    file, isFallback, isVideo, videoTs, bot,
    tabId = getCurrentTabId(),
  } = payload;

  global = updateManagementProgress(global, ManagementProgress.InProgress, tabId);
  setGlobal(global);

  const result = await callApi('uploadProfilePhoto', file, isFallback, isVideo, videoTs, bot);
  if (!result) return;

  global = getGlobal();
  global = updateManagementProgress(global, ManagementProgress.Complete, tabId);
  setGlobal(global);

  const userId = bot?.id ?? global.currentUserId;
  if (!userId) return;

  actions.loadFullUser({ userId });
});

addActionHandler('signUp', (global, actions, payload): ActionReturnType => {
  const { firstName, lastName } = payload;

  void callApi('provideAuthRegistration', { firstName, lastName });

  return updateAuth(global, {
    isLoading: true,
    errorKey: undefined,
  });
});

addActionHandler('returnToAuthPhoneNumber', (global): ActionReturnType => {
  void callApi('restartAuth');

  return updateAuth(global, {
    errorKey: undefined,
  });
});

addActionHandler('goToAuthQrCode', (global): ActionReturnType => {
  void callApi('restartAuthWithQr');

  return updateAuth(global, {
    isLoadingQrCode: true,
    errorKey: undefined,
  });
});

addActionHandler('saveSession', (global, actions, payload): ActionReturnType => {
  if (global.passcode.isScreenLocked) {
    return;
  }

  const { sessionData } = payload;
  if (sessionData) {
    storeSession(sessionData);
  } else {
    clearStoredSession();
  }
});

addActionHandler('signOut', async (global, actions, payload): Promise<void> => {
  if ('hangUp' in actions) actions.hangUp({ tabId: getCurrentTabId() });
  if ('leaveGroupCall' in actions) actions.leaveGroupCall({ tabId: getCurrentTabId() });

  try {
    resetInitialLocationHash();
    resetLocationHash();
    await unsubscribe();
    await Promise.race([callApi('destroy'), pause(3000)]);
    await forceWebsync(false);
  } catch (err) {
    // Do nothing
  }

  actions.reset();

  if (payload?.forceInitApi) {
    actions.initApi();
  }
});

addActionHandler('requestChannelDifference', (global, actions, payload): ActionReturnType => {
  const { chatId } = payload;

  void callApi('requestChannelDifference', chatId);
});

addActionHandler('reset', (global, actions): ActionReturnType => {
  clearStoredSession(ACCOUNT_SLOT);
  clearEncryptedSession();

  void cacheApi.clear(MEDIA_CACHE_NAME);
  void cacheApi.clear(MEDIA_CACHE_NAME_AVATARS);
  void cacheApi.clear(MEDIA_PROGRESSIVE_CACHE_NAME);
  void cacheApi.clear(CUSTOM_BG_CACHE_NAME);

  removeGlobalFromCache();
  destroySharedStatePort();

  // Check if there are any accounts left
  const accounts = getAccountsInfo();
  if (!Object.values(accounts).length) {
    PASSCODE_IDB_STORE.clear();
    removeSharedStateFromCache();
  }

  const langCachePrefix = LANG_CACHE_NAME.replace(/\d+$/, '');
  const langCacheVersion = Number((LANG_CACHE_NAME.match(/\d+$/) || ['0'])[0]);
  for (let i = 0; i < langCacheVersion; i++) {
    void cacheApi.clear(`${langCachePrefix}${i === 0 ? '' : i}`);
  }

  updateAppBadge(0);

  actions.initShared({ force: true });
  Object.values(global.byTabId).forEach(({ id: otherTabId, isMasterTab }) => {
    actions.init({ tabId: otherTabId, isMasterTab });
  });
});

addActionHandler('disconnect', (): ActionReturnType => {
  void callApiLocal('disconnect');
});

addActionHandler('destroyConnection', (): ActionReturnType => {
  void callApiLocal('destroy', true, true);
});

addActionHandler('loadNearestCountry', async (global): Promise<void> => {
  if (global.connectionState !== 'connectionStateReady') {
    return;
  }

  const authNearestCountry = await callApi('fetchNearestCountry');

  global = getGlobal();
  global = updateAuth(global, {
    nearestCountry: authNearestCountry,
  });
  setGlobal(global);
});

addActionHandler('setDeviceToken', (global, actions, payload): ActionReturnType => {
  const { token } = payload;
  return {
    ...global,
    push: {
      deviceToken: token,
      subscribedAt: Date.now(),
    },
  };
});

addActionHandler('deleteDeviceToken', (global): ActionReturnType => {
  return {
    ...global,
    push: undefined,
  };
});

addActionHandler('lockScreen', async (global): Promise<void> => {
  const sessionJson = JSON.stringify({ ...loadStoredSession(), userId: global.currentUserId });
  const globalJson = serializeGlobal(global);

  await encryptSession(sessionJson, globalJson);
  forgetPasscode();
  clearStoredSession();
  updateAppBadge(0);

  global = getGlobal();
  global = updatePasscodeSettings(
    global,
    {
      isScreenLocked: true,
      invalidAttemptsCount: 0,
      timeoutUntil: undefined,
    },
  );
  setGlobal(global);

  setTimeout(() => {
    global = getGlobal();
    global = clearGlobalForLockScreen(global);
    setGlobal(global);
  }, LOCK_SCREEN_ANIMATION_DURATION_MS);

  try {
    await unsubscribe();
    await callApi('destroy', true);
  } catch (err) {
    // Do nothing
  }
});
