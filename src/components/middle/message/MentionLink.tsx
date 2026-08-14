import type { TeactNode } from '../../../lib/teact/teact';
import { getActions, withGlobal } from '../../../global';

import type { ApiPeer } from '../../../api/types';
import { ApiMessageEntityTypes } from '../../../api/types';

import { selectUser } from '../../../global/selectors';

import useAppLayout from '../../../hooks/useAppLayout';
import useGatewayPermissions from '../../../hooks/useGatewayPermissions';

type OwnProps = {
  userId?: string;
  username?: string;
  children: TeactNode;
};

type StateProps = {
  userOrChat?: ApiPeer;
};

const MentionLink = ({
  userId,
  username,
  userOrChat,
  children,
}: OwnProps & StateProps) => {
  const {
    openChat,
    openChatByUsername,
    closeStoryViewer,
    setShouldCloseRightColumn,
  } = getActions();

  const { isMobile } = useAppLayout();
  const { canViewUsernames } = useGatewayPermissions();

  // A username mention (`@handle`) reveals a username — fully mask it and drop the click when
  // the role forbids usernames. A `userId` mention shows a display name (not a username) and
  // leads to a profile where the username is already gated, so it stays interactive.
  const isUsernameHidden = Boolean(username) && !canViewUsernames;

  const handleClick = () => {
    if (isMobile) {
      setShouldCloseRightColumn({
        value: true,
      });
    }

    if (userOrChat) {
      openChat({ id: userOrChat.id });
    } else if (username) {
      closeStoryViewer();
      openChatByUsername({ username: username.substring(1) });
    }
  };

  if (isUsernameHidden) {
    return <span dir="auto">@…</span>;
  }

  return (
    <a
      onClick={handleClick}
      className="text-entity-link"
      dir="auto"
      data-entity-type={userId ? ApiMessageEntityTypes.MentionName : ApiMessageEntityTypes.Mention}
    >
      {children}
    </a>
  );
};

export default withGlobal<OwnProps>(
  (global, { userId }): Complete<StateProps> => {
    return {
      userOrChat: userId ? selectUser(global, userId) : undefined,
    };
  },
)(MentionLink);
