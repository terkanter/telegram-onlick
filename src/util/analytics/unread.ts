import { ALL_FOLDER_ID } from '../../config';
import { isCurrentTabMaster } from '../establishMultitabRole';
import { addUnreadCountersCallback } from '../folderManager';
import { reportUnread } from './telemetry';

// Reports the summary unread counters on every change (master tab only). `chatsCount` /
// `notificationsCount` of the "All" folder are what the app's own badge shows. See
// `telegram-analytics-tasks.md` §5.

let lastChats = -1;
let lastMessages = -1;
let unsubscribe: NoneToVoidFunction | undefined;

export function startUnreadTracking() {
  if (unsubscribe) return;
  unsubscribe = addUnreadCountersCallback((counters) => {
    if (!isCurrentTabMaster()) return;

    const all = counters[ALL_FOLDER_ID];
    const chats = all?.chatsCount || 0;
    const messages = all?.notificationsCount || 0;
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
