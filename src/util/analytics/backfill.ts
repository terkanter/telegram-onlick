import { getGlobal } from '../../global';

import { IS_GATEWAY } from '../../config';
import { selectChatLastMessage } from '../../global/selectors';
import reportMessage from './reportMessage';

// After dialogs load — on every connection/auth, not just startup — emit a `message` for the last
// message of each chat. Without this, conversations that arrived while the tab was closed are
// invisible and metrics 2–4 are silently undercounted. Deduped by server key against live events.
export default function backfillHistory() {
  if (!IS_GATEWAY) return;

  const global = getGlobal();

  for (const chatId of Object.keys(global.chats.byId)) {
    const message = selectChatLastMessage(global, chatId);
    if (message) reportMessage(message);
  }
}
