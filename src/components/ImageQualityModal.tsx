import type { QualityIssue } from '../services/imageQuality';

interface Props {
  previewUrl: string;
  issues: QualityIssue[];
  onRetake: () => void;
  onKeep: () => void;
}

/**
 * Modal shown after image quality check fails. Inspector can retake or keep
 * anyway. If they keep, the photo is auto-flagged for ML training so we
 * collect data on what bad photos actually look like in the field.
 */
export function ImageQualityModal({ previewUrl, issues, onRetake, onKeep }: Props) {
  const hasSevere = issues.some((i) => i.severity === 'severe');

  return (
    <div className="modal-backdrop" onClick={onRetake}>
      <div className="modal modal--photo-check" onClick={(e) => e.stopPropagation()}>
        <h3 className="modal__title">
          {hasSevere ? '⚠ Photo quality issue' : '⚠ Photo could be better'}
        </h3>
        <p className="modal__sub">
          {hasSevere
            ? 'The image has problems that will make it hard to read. Please retake.'
            : "The image looks usable but isn't perfect. Retake if you can."}
        </p>

        <div className="quality-preview">
          <img src={previewUrl} alt="Captured photo preview" />
        </div>

        <ul className="quality-issues">
          {issues.map((issue, idx) => (
            <li
              key={idx}
              className={`quality-issue quality-issue--${issue.severity}`}
            >
              <span className="quality-issue__icon">
                {issue.severity === 'severe' ? '⚠' : 'i'}
              </span>
              <span className="quality-issue__text">{issue.message}</span>
            </li>
          ))}
        </ul>

        <p className="modal__sub" style={{ fontSize: 11, marginTop: 12 }}>
          If you keep this photo, it will be flagged for AI training so the model
          can learn from real-world image quality.
        </p>

        <div className="modal__actions">
          <button className="btn btn--ghost" onClick={onKeep}>
            Keep anyway
          </button>
          <button className="btn btn--accent" onClick={onRetake} autoFocus>
            📷 Retake photo
          </button>
        </div>
      </div>
    </div>
  );
}
