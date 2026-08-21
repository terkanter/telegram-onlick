import { getGlobal } from '../../global';

import { MAIN_THREAD_ID } from '../../api/types';

import { ALL_FOLDER_ID } from '../../config';
import { selectThreadReadState } from '../../global/selectors/threads';
import { isUserId } from '../entities/ids';
import { isCurrentTabMaster } from '../establishMultitabRole';
import { addUnreadCountersCallback, getOrderedIds } from '../folderManager';
import { reportUnread } from './telemetry';

// Reports the summary unread counters on every change (master tab only), counting ONLY private
// chats — group/channel unread (incl. muted groups) is noise the operator doesn't want. This is a
// telemetry-specific fold, deliberately NOT `buildFolderUnreadCounters` (that drives the app's own
// badge — touching it would change what the operator sees). See `telegram-analytics-tasks.md` §6.

let lastChats = -1;
let lastMessages = -1;
let unsubscribe: NoneToVoidFunction | undefined;

export function startUnreadTracking() {
  if (unsubscribe) return;
  unsubscribe = addUnreadCountersCallback(() => {
    if (!isCurrentTabMaster()) return;

    const { chats, messages } = computePrivateUnread();
    if (chats === lastChats && messages === lastMessages) return;

    lastChats = chats;
    lastMessages = messages;
    reportUnread(chats, messages);
  });
}

export function stopUnreadTracking() {
  unsubscribe?.();
  unsubscribe = undefined;
  lastChats = -1;
  lastMessages = -1;
}

function computePrivateUnread() {
  const global = getGlobal();
  const orderedIds = getOrderedIds(ALL_FOLDER_ID);
  let chats = 0;
  let messages = 0;

  orderedIds?.forEach((chatId) => {
    if (!isUserId(chatId)) return;
    const readState = selectThreadReadState(global, chatId, MAIN_THREAD_ID);
    const unreadCount = readState?.unreadCount || 0;
    if (unreadCount > 0 || readState?.hasUnreadMark) {
      chats += 1;
      messages += unreadCount;
    }
  });

  return { chats, messages };
}
