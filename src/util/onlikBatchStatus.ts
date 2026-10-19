import type { FormContentResultStatus } from './telegramGateway';

import { createSignal } from './signals';
import { subscribeToFormContentResult } from './telegramGateway';

// What became of a message sent to the platform in a batch, shown on its send button the way
// a single send shows it
export type OnlikBatchStatus = 'sent' | 'posted' | 'error';

// How long a message reads "sent" while the platform has not reported the post
const SENT_STATUS_DURATION = 20000;

const [getOnlikBatchStatuses, setOnlikBatchStatuses] = createSignal<Record<string, OnlikBatchStatus>>({});
export { getOnlikBatchStatuses };

export function buildOnlikBatchStatusKey(chatId: string, messageId: number) {
  return `${chatId}_${messageId}`;
}

// Marks the messages a batch post was built from as sent, then follows the platform's answer for
// that post: published, failed, or dropped from the batch (the mark goes away)
export function trackOnlikBatchPost(chatId: string, messageIds: number[], requestId: string) {
  const keys = messageIds.map((messageId) => buildOnlikBatchStatusKey(chatId, messageId));
  updateStatuses(keys, 'sent');

  const sentTimeout = window.setTimeout(() => {
    const statuses = getOnlikBatchStatuses();
    updateStatuses(keys.filter((key) => statuses[key] === 'sent'), undefined);
  }, SENT_STATUS_DURATION);

  const unsubscribe = subscribeToFormContentResult(requestId, (status: FormContentResultStatus) => {
    window.clearTimeout(sentTimeout);
    unsubscribe();
    updateStatuses(keys, status === 'cancelled' ? undefined : status === 'posted' ? 'posted' : 'error');
  });
}

function updateStatuses(keys: string[], status: OnlikBatchStatus | undefined) {
  if (!keys.length) return;

  const next = { ...getOnlikBatchStatuses() };
  keys.forEach((key) => {
    if (status) {
      next[key] = status;
    } else {
      delete next[key];
    }
  });
  setOnlikBatchStatuses(next);
}
