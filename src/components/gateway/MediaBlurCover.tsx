import type React from '../../lib/teact/teact';
import { memo } from '../../lib/teact/teact';

import buildClassName from '../../util/buildClassName';

import useLang from '../../hooks/useLang';
import useLastCallback from '../../hooks/useLastCallback';

import Icon from '../common/icons/Icon';

import styles from './MediaBlurCover.module.scss';

type OwnProps = {
  className?: string;
  // The media is shown: no cover, only the control to blur it again
  isRevealed?: boolean;
  isInSelectMode?: boolean;
  // Small preview (e.g. document thumbnail): a centered, shrunken control
  isCompact?: boolean;
  onToggle: NoneToVoidFunction;
};

const MediaBlurCover = ({
  className, isRevealed, isInSelectMode, isCompact, onToggle,
}: OwnProps) => {
  const lang = useLang();

  // The cover swallows clicks so a blurred media cannot be opened; only the eye reveals it
  const handleCoverClick = useLastCallback((e: React.MouseEvent<HTMLDivElement>) => {
    e.stopPropagation();
  });

  const handleToggleClick = useLastCallback((e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    onToggle();
  });

  return (
    <div
      // In select mode clicks must reach the message selection handlers underneath
      className={buildClassName(
        styles.root,
        isRevealed ? styles.revealed : styles.blurred,
        isCompact && styles.compact,
        isInSelectMode && styles.inSelectMode,
        className,
      )}
      onClick={handleCoverClick}
    >
      <button
        type="button"
        className={styles.toggleButton}
        aria-label={lang(isRevealed ? 'GatewayHideMedia' : 'GatewayShowMedia')}
        onClick={handleToggleClick}
      >
        <Icon name={isRevealed ? 'eye-crossed-outline' : 'eye-outline'} />
      </button>
    </div>
  );
};

export default memo(MediaBlurCover);
