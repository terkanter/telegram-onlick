import type React from '../../lib/teact/teact';
import { memo } from '../../lib/teact/teact';

import buildClassName from '../../util/buildClassName';

import useLang from '../../hooks/useLang';
import useLastCallback from '../../hooks/useLastCallback';

import Icon from '../common/icons/Icon';

import styles from './MediaBlurCover.module.scss';

type OwnProps = {
  className?: string;
  isInSelectMode?: boolean;
  onReveal: NoneToVoidFunction;
};

const MediaBlurCover = ({ className, isInSelectMode, onReveal }: OwnProps) => {
  const lang = useLang();

  // The cover swallows clicks so a blurred media cannot be opened; only the eye reveals it
  const handleCoverClick = useLastCallback((e: React.MouseEvent<HTMLDivElement>) => {
    e.stopPropagation();
  });

  const handleRevealClick = useLastCallback((e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    onReveal();
  });

  return (
    <div
      // In select mode clicks must reach the message selection handlers underneath
      className={buildClassName(styles.root, isInSelectMode && styles.inSelectMode, className)}
      onClick={handleCoverClick}
    >
      <button
        type="button"
        className={styles.revealButton}
        aria-label={lang('GatewayShowMedia')}
        onClick={handleRevealClick}
      >
        <Icon name="eye-outline" />
      </button>
    </div>
  );
};

export default memo(MediaBlurCover);
