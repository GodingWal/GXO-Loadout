import { useState } from 'react';
import type { PhotoMLResults } from '../types/inspection';

interface Props {
  mlResults?: PhotoMLResults;
  // The expected batches we passed to OCR for this photo
  expectedBatches?: string[];
}

/**
 * Debug panel showing full OCR pipeline output. Only renders when ?ocrdebug
 * is in the URL. Used for testing accuracy and tuning preprocessing /
 * matching thresholds against real warehouse photos.
 *
 * Copyable JSON at the bottom so test reports can be pasted into chat.
 */
export function OCRDebugPanel({ mlResults, expectedBatches }: Props) {
  const [copied, setCopied] = useState(false);

  if (!isDebugOn()) return null;

  // Distinguish "no analysis yet" (just captured, OCR running, or just
  // replaced) from "analysis returned nothing." Without this, a freshly
  // captured photo briefly renders nothing — or worse, the previous photo's
  // results leak through during re-capture.
  if (!mlResults || !mlResults.analyzedAt) {
    return (
      <div className="ocr-debug">
        <div className="ocr-debug__head">
          <span className="ocr-debug__title">OCR debug</span>
        </div>
        <div className="ocr-debug__row">
          <span className="ocr-debug__value mono">
            <em>OCR pending…</em>
          </span>
        </div>
      </div>
    );
  }

  const dbg = mlResults.ocrDebug;
  const detected = mlResults.detectedBatchCode;
  const confidence = mlResults.batchCodeConfidence;
  const errors = mlResults.errors || [];

  // expected-list semantics: ocrDebug.expectedBatches is the snapshot from
  // when OCR ran; expectedBatches (prop) is the current value from props.
  // If the picklist changes after OCR runs, these will differ — we surface
  // both so testers know the result is stale.
  const expectedNow = expectedBatches || [];
  const expectedAtOCR = dbg?.expectedBatches || [];
  const expectedDiffers =
    JSON.stringify([...expectedNow].sort()) !==
    JSON.stringify([...expectedAtOCR].sort());

  const copyJSON = async () => {
    const payload = {
      detectedBatchCode: detected,
      batchCodeConfidence: confidence,
      errors,
      ocrDebug: dbg,
      expectedBatches: expectedNow,
    };
    try {
      await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  };

  const renderErrorMessage = (code: string): { severity: 'danger' | 'warn' | 'info'; text: string } => {
    switch (code) {
      case 'no_match_against_expected':
        return {
          severity: 'danger',
          text: 'OCR found candidates but none matched any expected batch. Either the wrong pallet was photographed, the picklist is missing this batch, or OCR misread the code.',
        };
      case 'no_batch_code_found':
        return {
          severity: 'warn',
          text: 'OCR ran but found nothing that looked like a batch code. The photo may be too far away or out of focus.',
        };
      case 'photo_may_be_too_distant':
        return {
          severity: 'info',
          text: 'Tesseract returned only short, low-confidence fragments. Try standing closer so the batch code fills 40–60% of the frame.',
        };
      default:
        return { severity: 'warn', text: code };
    }
  };

  return (
    <div className="ocr-debug">
      <div className="ocr-debug__head">
        <span className="ocr-debug__title">OCR debug</span>
        <button className="ocr-debug__copy" onClick={copyJSON} type="button">
          {copied ? '✓ copied' : '⎘ copy JSON'}
        </button>
      </div>

      {errors.map((code) => {
        const { severity, text } = renderErrorMessage(code);
        return (
          <div
            key={code}
            className={`ocr-debug__row ocr-debug__row--${severity}`}
          >
            <span className="ocr-debug__label">{code}</span>
            <span className="ocr-debug__value">{text}</span>
          </div>
        );
      })}

      <div className="ocr-debug__row">
        <span className="ocr-debug__label">detected</span>
        <span className="ocr-debug__value mono">
          {detected ? <strong>{detected}</strong> : <em>none</em>}
          {confidence !== undefined && (
            <span className="ocr-debug__conf"> ({(confidence * 100).toFixed(0)}%)</span>
          )}
        </span>
      </div>

      <div className="ocr-debug__row">
        <span className="ocr-debug__label">
          {expectedDiffers ? 'expected (at OCR time)' : 'expected'}
        </span>
        <span className="ocr-debug__value mono">
          {expectedAtOCR.length === 0 ? <em>none provided</em> : expectedAtOCR.join(', ')}
        </span>
      </div>

      {expectedDiffers && (
        <div className="ocr-debug__row ocr-debug__row--warn">
          <span className="ocr-debug__label">expected (now)</span>
          <span className="ocr-debug__value mono">
            {expectedNow.length === 0 ? <em>none</em> : expectedNow.join(', ')}
            <span className="ocr-debug__conf"> · picklist changed since OCR ran — re-capture to refresh</span>
          </span>
        </div>
      )}

      {dbg?.matchedAgainstExpected !== undefined && (
        <div className="ocr-debug__row">
          <span className="ocr-debug__label">match</span>
          <span className="ocr-debug__value mono">
            {dbg.matchedAgainstExpected ? (
              <>matched expected · distance {dbg.editDistance} · {dbg.matchConfidence} confidence</>
            ) : (
              'format-only (no match against expected)'
            )}
          </span>
        </div>
      )}

      {dbg && (
        <>
          <div className="ocr-debug__row">
            <span className="ocr-debug__label">raw text</span>
            <span className="ocr-debug__value mono">
              {dbg.rawText ? dbg.rawText.replace(/\s+/g, ' ').trim() : <em>(empty)</em>}
            </span>
          </div>

          <div className="ocr-debug__row">
            <span className="ocr-debug__label">ocr conf</span>
            <span className="ocr-debug__value mono">
              {dbg.ocrConfidence?.toFixed(1) ?? '—'}
              {dbg.durationMs !== undefined && (
                <span className="ocr-debug__conf"> · {dbg.durationMs.toFixed(0)}ms</span>
              )}
            </span>
          </div>

          {dbg.formatValidatedCandidates && dbg.formatValidatedCandidates.length > 0 && (
            <div className="ocr-debug__row">
              <span className="ocr-debug__label">candidates</span>
              <span className="ocr-debug__value mono">
                {dbg.formatValidatedCandidates.slice(0, 6).map((c, i) => (
                  <span key={i} style={{ marginRight: 10 }}>
                    {c.text}
                    {c.matchedPattern && (
                      <span style={{ color: 'var(--accent)', marginLeft: 2 }}>✓</span>
                    )}
                    <span className="ocr-debug__conf">({c.confidence.toFixed(0)})</span>
                  </span>
                ))}
              </span>
            </div>
          )}

          {dbg.words && dbg.words.length > 0 && (
            <details className="ocr-debug__details">
              <summary>all tesseract words ({dbg.words.length})</summary>
              <div className="ocr-debug__words">
                {dbg.words.map((w, i) => (
                  <span key={i} className="ocr-debug__word">
                    <span className="mono">{w.text}</span>
                    <span className="ocr-debug__conf">({w.confidence.toFixed(0)})</span>
                  </span>
                ))}
              </div>
            </details>
          )}
        </>
      )}
    </div>
  );
}

export const DEBUG_SS_KEY = 'loadout.ocrdebug';

/**
 * Returns true when OCR debug mode should be active.
 *
 * Activation: visit any URL with ?ocrdebug — the flag is latched into
 * sessionStorage so it survives client-side navigation. Stays on until
 * either the tab closes or the user visits ?ocrdebug=off (or clicks the
 * topbar badge, which clears sessionStorage directly).
 *
 * Idempotent and cheap; safe to call on every render.
 */
export function isDebugOn(): boolean {
  if (typeof window === 'undefined') return false;
  const params = new URLSearchParams(window.location.search);
  if (params.has('ocrdebug')) {
    if (params.get('ocrdebug') === 'off') {
      try { window.sessionStorage.removeItem(DEBUG_SS_KEY); } catch { /* ignore */ }
      return false;
    }
    try { window.sessionStorage.setItem(DEBUG_SS_KEY, '1'); } catch { /* ignore */ }
    return true;
  }
  try { return window.sessionStorage.getItem(DEBUG_SS_KEY) === '1'; } catch { return false; }
}
