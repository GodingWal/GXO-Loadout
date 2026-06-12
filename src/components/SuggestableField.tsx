import type { Suggestable } from '../types/inspection';

interface Props<T extends string | number> {
  label: string;
  field: Suggestable<T>;
  type?: 'text' | 'number';
  placeholder?: string;
  mono?: boolean;
  onChange: (next: Suggestable<T>) => void;
}

export function SuggestableField<T extends string | number>({
  label,
  field,
  type = 'text',
  placeholder,
  mono,
  onChange,
}: Props<T>) {
  const hasSuggestion = field.mlSuggestion !== undefined && field.mlSuggestion !== null;
  const valueMatchesSuggestion =
    hasSuggestion && String(field.value ?? '') === String(field.mlSuggestion);
  const isAccepted = field.source === 'ml-accepted' || valueMatchesSuggestion;

  const acceptSuggestion = () => {
    onChange({
      ...field,
      value: field.mlSuggestion as T,
      source: 'ml-accepted',
    });
  };

  const handleChange = (raw: string) => {
    const next: T | null =
      raw === '' ? null : (type === 'number' ? (Number(raw) as T) : (raw as T));

    let source: Suggestable<T>['source'];
    if (next === null) source = 'empty';
    else if (hasSuggestion && String(next) === String(field.mlSuggestion)) source = 'ml-accepted';
    else if (hasSuggestion) source = 'ml-edited';
    else source = 'manual';

    onChange({ ...field, value: next, source });
  };

  return (
    <div className="field">
      <div className="field__label">{label}</div>

      {hasSuggestion && !valueMatchesSuggestion && (
        <div className="suggestion-banner">
          <span className="suggestion-banner__text">
            AI suggests: <strong>{String(field.mlSuggestion)}</strong>
            {field.mlConfidence !== undefined && (
              <span className="xs"> ({Math.round(field.mlConfidence * 100)}%)</span>
            )}
          </span>
          <button className="suggestion-banner__accept" onClick={acceptSuggestion}>
            Accept
          </button>
        </div>
      )}

      <input
        type={type}
        value={field.value === null ? '' : String(field.value)}
        onChange={(e) => handleChange(e.target.value)}
        placeholder={placeholder}
        className={mono ? 'mono' : ''}
      />

      {isAccepted && hasSuggestion && (
        <div className="field__hint" style={{ color: 'var(--accent)' }}>✓ AI suggestion accepted</div>
      )}
      {field.source === 'ml-edited' && (
        <div className="field__hint">Corrected from AI suggestion</div>
      )}
    </div>
  );
}
