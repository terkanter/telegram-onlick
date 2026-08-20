import type { ApiMessage } from '../../api/types';

import { IS_GATEWAY } from '../../config';
import { getMessageServerKey } from '../keys/messageKey';
import { queueMessageEvent } from './telemetry';

// Emits an analytics `message` event for a real server message. Local/optimistic messages have
// no server key and are skipped (the outgoing one is reported later on send-succeeded); service
// actions are not messages. Deduped by server key downstream. See `telegram-analytics-tasks.md`.
export default function reportMessage(message: ApiMessage) {
  if (!IS_GATEWAY || message.content.action) return;

  const dedupKey = getMessageServerKey(message);
  if (!dedupKey) return;

  queueMessageEvent(dedupKey, message.date * 1000, message.chatId, message.id, Boolean(message.isOutgoing));
}
