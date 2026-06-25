import { memo } from '../../lib/teact/teact';

import type { RegularLangKey } from '../../types/language';
import type { GatewayStatus } from '../../util/telegramGateway';

import { getGatewayStatus } from '../../util/telegramGateway';

import useDerivedState from '../../hooks/useDerivedState';
import useLang from '../../hooks/useLang';

import Spinner from '../ui/Spinner';

import styles from './GatewayPending.module.scss';

const STATUS_TO_KEY: Record<GatewayStatus, RegularLangKey> = {
  connecting: 'GatewayConnecting',
  ready: 'GatewayConnecting',
  revoked: 'GatewayRevoked',
  error: 'GatewayError',
};

const GatewayPending = () => {
  const lang = useLang();
  const status = useDerivedState(getGatewayStatus);
  const isPending = status === 'connecting' || status === 'ready';

  return (
    <div className={styles.root}>
      <div className={styles.box}>
        {isPending && <Spinner color="white" />}
        <p className={styles.text}>{lang(STATUS_TO_KEY[status])}</p>
      </div>
    </div>
  );
};

export default memo(GatewayPending);
