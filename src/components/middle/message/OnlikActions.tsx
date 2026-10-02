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

type SendStatus = 'sent' | 'posted' | 'error';

// Keeps the fill visible while the progress is still unknown
const MIN_PROGRESS = 0.15;
// How long the button confirms the click while the platform has not reported the post
const SENT_STATUS_DURATION = 20000;

export function OnlickActionButton(props: IOnlikButtonProps) {
  const {
    option,
  } = props;

  const [isLoading, markLoading, unmarkLoading] = useFlag();
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState<SendStatus | undefined>();
  const unsubscribeRef = useRef<NoneToVoidFunction>();
  const sentTimeoutRef = useRef<number>();

  const resetPendingResult = useLastCallback(() => {
    unsubscribeRef.current?.();
    unsubscribeRef.current = undefined;
    window.clearTimeout(sentTimeoutRef.current);
  });

  useEffect(() => resetPendingResult, [resetPendingResult]);

  const handleClick = useLastCallback(() => {
    if (isLoading) return;

    resetPendingResult();
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

      setStatus('sent');
      sentTimeoutRef.current = window.setTimeout(() => {
        setStatus((current) => (current === 'sent' ? undefined : current));
      }, SENT_STATUS_DURATION);

      // The platform may publish the post long after the temporary status has expired
      unsubscribeRef.current = subscribeToFormContentResult(requestId, (resultStatus) => {
        window.clearTimeout(sentTimeoutRef.current);
        setStatus(resultStatus === 'cancelled' ? undefined : resultStatus === 'posted' ? 'posted' : 'error');
      });
    }, setProgress);
  });

  const fillOffset = isLoading ? (1 - Math.max(progress, MIN_PROGRESS)) * 100 : 100;
  const isPosted = status === 'posted';

  return (
    <Button
      key={option.label}
      className="message-action-button"
      color={isPosted ? 'primary' : 'translucent-white'}
      round
      ariaLabel={option.label}
      onClick={handleClick}
    >
      <span className={styles.fillClip}>
        <span className={styles.fill} style={`transform: translateY(${fillOffset}%)`} />
      </span>
      <Icon name={status === 'sent' || isPosted ? 'check' : option.icon} className={styles.icon} />
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
