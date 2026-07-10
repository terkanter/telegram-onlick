import { memo, useEffect } from '../../lib/teact/teact';
import { withGlobal } from '../../global';

import { selectCurrentMessageList } from '../../global/selectors';
import { createLocationHash } from '../../util/routing';
import { reportGatewayRouteChange } from '../../util/telegramGateway';

type StateProps = {
  route: string;
  isConnectionReady: boolean;
};

// Mirrors the current message list to the platform parent so it can restore the last
// opened chat per account (see `telegram-fork-route-memory.md`). Gating on the connection
// also guarantees at least one `route-change` after every `ready`.
const GatewayRouteReporter = ({ route, isConnectionReady }: StateProps) => {
  useEffect(() => {
    if (!isConnectionReady) return;
    reportGatewayRouteChange(route);
  }, [isConnectionReady, route]);

  return undefined;
};

export default memo(withGlobal(
  (global): Complete<StateProps> => {
    const currentMessageList = selectCurrentMessageList(global);
    const route = currentMessageList
      ? createLocationHash(currentMessageList.chatId, currentMessageList.type, currentMessageList.threadId)
      : '';

    return {
      route,
      isConnectionReady: global.connectionState === 'connectionStateReady' && Boolean(global.currentUserId),
    };
  },
)(GatewayRouteReporter));
