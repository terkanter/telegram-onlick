import { useEffect, useRef, useState } from '../../../lib/teact/teact';

import type { ApiMessage } from '../../../api/types';
import type { ISendOption } from './helpers/sendMessageContentOptions';

import { subscribeToFormContentResult } from '../../../util/telegramGateway';
import { getMessageSendToParentWindowOptions } from './helpers/sendMessageContentOptions';

import useFlag from '../../../hooks/useFlag';
import useLang from '../../../hooks/useLang';
import useLastCallback from '../../../hooks/useLastCallback';

import Icon from '../../common/icons/Icon';
import Button from '../../ui/Button';

import styles from './OnlikActions.module.scss';

type OwnProps = {
  message: ApiMessage;
};

type IOnlikButtonProps = {
  option: ISendOption;
};

type SendStatus = 'success' | 'error';

// Keeps the fill visible while the progress is still unknown
const MIN_PROGRESS = 0.15;

export function OnlickActionButton(props: IOnlikButtonProps) {
  const {
    option,
  } = props;

  const [isLoading, markLoading, unmarkLoading] = useFlag();
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState<SendStatus | undefined>();
  const unsubscribeRef = useRef<NoneToVoidFunction>();

  useEffect(() => () => unsubscribeRef.current?.(), []);

  const handleClick = useLastCallback(() => {
    if (isLoading) return;

    unsubscribeRef.current?.();
    unsubscribeRef.current = undefined;
    markLoading();
    setProgress(0);
    setStatus(undefined);
    option.handler((isDone = true, requestId) => {
      unmarkLoading();
      if (!isDone) {
        setStatus('error');
        return;
      }
      if (!requestId) return;

      // Handing the content over is not a success yet: the check mark waits for the platform to publish the post
      unsubscribeRef.current = subscribeToFormContentResult(requestId, (resultStatus) => {
        if (resultStatus === 'cancelled') return;
        setStatus(resultStatus === 'posted' ? 'success' : 'error');
      });
    }, setProgress);
  });

  const fillOffset = isLoading ? (1 - Math.max(progress, MIN_PROGRESS)) * 100 : 100;

  return (
    <Button
      key={option.label}
      className="message-action-button"
      color="translucent-white"
      round
      ariaLabel={option.label}
      onClick={handleClick}
    >
      <span className={styles.fillClip}>
        <span className={styles.fill} style={`transform: translateY(${fillOffset}%)`} />
      </span>
      <Icon name={status === 'success' ? 'check' : option.icon} className={styles.icon} />
      {status === 'error' && <span className={styles.errorBadge} />}
    </Button>
  );
}

export function OnlikActionsButtons(props: OwnProps) {
  const { message } = props;

  const lang = useLang();
  const options = getMessageSendToParentWindowOptions(lang, message, true);

  return options.map((option) => (
    <OnlickActionButton option={option} />
  ));
}
