import type { MLTrainingFlag } from '../types/inspection';

interface Props {
  flag?: MLTrainingFlag;
  onFlag: (flag: MLTrainingFlag) => void;
  onUnflag: () => void;
  currentUser: string;
}

export function MLTrainingFlagButton({ flag, onFlag, onUnflag, currentUser }: Props) {
  const isFlagged = !!flag;

  const toggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isFlagged) {
      onUnflag();
    } else {
      onFlag({
        flaggedAt: new Date().toISOString(),
        flaggedBy: currentUser || 'unknown',
      });
    }
  };

  return (
    <button
      className={`photo-tile__ml-btn ${isFlagged ? 'photo-tile__ml-btn--active' : ''}`}
      onClick={toggle}
      aria-label={isFlagged ? 'Unflag for AI training' : 'Flag for AI training'}
      title={isFlagged ? 'Tap to unflag' : 'Flag this photo as a hard case for AI training'}
    >
      AI
    </button>
  );
}
