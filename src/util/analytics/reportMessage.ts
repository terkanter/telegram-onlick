import type { ApiMessage } from '../../api/types';

import { IS_GATEWAY } from '../../config';
import { isUserId } from '../entities/ids';
import { getMessageServerKey } from '../keys/messageKey';
import { queueMessageEvent } from './telemetry';

// Emits an analytics `message` event for a real server message. Local/optimistic messages have
// no server key and are skipped (the outgoing one is reported later on send-succeeded); service
// actions are not messages. Only private chats count — the server drops group/channel events, so
// sending them is wasted traffic. Deduped by server key downstream. See `telegram-analytics-tasks.md`.
export default function reportMessage(message: ApiMessage) {
  if (!IS_GATEWAY || message.content.action || !isUserId(message.chatId)) return;

  const dedupKey = getMessageServerKey(message);
  if (!dedupKey) return;

  queueMessageEvent(dedupKey, message.date * 1000, message.chatId, message.id, Boolean(message.isOutgoing));
}
