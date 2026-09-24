import { memo } from '../../lib/teact/teact';

import type { RegularLangKey } from '../../types/language';
import type { GatewayStopReason } from '../../util/telegramGateway';

import useLang from '../../hooks/useLang';

import Spinner from '../ui/Spinner';

import styles from './GatewayPending.module.scss';

type OwnProps = {
  stopReason?: GatewayStopReason;
};

const STOP_REASON_TO_KEY: Record<GatewayStopReason, RegularLangKey> = {
  revoked: 'GatewayRevoked',
  error: 'GatewayError',
};

const GatewayPending = ({ stopReason }: OwnProps) => {
  const lang = useLang();

  return (
    <div className={styles.root}>
      <div className={styles.box}>
        {!stopReason && <Spinner color="white" />}
        <p className={styles.text}>{lang(stopReason ? STOP_REASON_TO_KEY[stopReason] : 'GatewayConnecting')}</p>
      </div>
    </div>
  );
};

export default memo(GatewayPending);
