// Admin-only training-data labeling tool.
//
// Lives in the admin console as a new tab. Three runtime modes:
//
//   first-pass   — primary labeling loop (with Tesseract pre-fill option)
//   blind-qc     — re-label a 10% sample of pass-1 labels with the prior
//                  answer hidden and pre-fill forced off. Gates export.
//   adjudicate   — side-by-side compare of pass-1 vs pass-2 disagreements;
//                  the chosen value overwrites pass-1 as final.
//   review-scan  — fast advisory scan of recent pass-1 labels with boxes
//                  and text visible. Does NOT satisfy the export gate.
//
// IMPORTANT — Review-mode QC is structurally weak: showing the labeler
// their prior answer anchors them on it and is poor at catching their own
// fatigue drift. Blind re-label is the only check that catches that. Both
// modes ship per product decision, but ONLY blind QC gates export so
// review mode cannot accidentally become the relied-upon check. Making
// review mode satisfy the export gate in future is a deliberate quality-
// risk decision and must be called out explicitly, not done silently.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  dbCountTrainingLabels,
  dbDeleteTrainingLabel,
  dbGetLabelablePhoto,
  dbGetPhotoBlob,
  dbGetPhotosForLabels,
  dbGetTrainingLabels,
  dbListLabelQueue,
  dbListTrainingLabels,
  dbSaveTrainingLabel,
} from '../services/db';
import {
  buildManifest,
  comparePassAgreement,
  computeProvenance,
  computeQCState,
  displayBoxToNatural,
  fittedSize,
  isFormatValid,
  naturalBoxToDisplay,
  validateForSave,
  type NormalizedBox,
  type PhotoWithInspection,
  type Provenance,
  type RegionKind,
  type SkipReason,
  type TrainingLabel,
  type TrainingRegion,
  type VarietyState,
} from '../services/trainingLabels';

// Field-test toggle: when true, an Enter on a still-unedited Tesseract
// pre-fill requires a second confirm press. Flip false once we trust
// labelers to inspect every field.
const REQUIRE_CONFIRM_ON_UNMODIFIED = true;

// SessionStorage keys
const SS_INITIALS = 'loadout.label.initials';
const SS_PREFILL = 'loadout.label.prefill';

type Mode = 'first-pass' | 'blind-qc' | 'adjudicate' | 'review-scan';

type Pending = { box: NormalizedBox | null; text: string; initialPrefill: string };

const emptyPending = (): Pending => ({ box: null, text: '', initialPrefill: '' });

export function TrainingLabelingPanel() {
  // ----- Session state -----
  const [initials, setInitials] = useState<string>(() =>
    typeof window === 'undefined' ? '' : window.sessionStorage.getItem(SS_INITIALS) || ''
  );
  const [mode, setMode] = useState<Mode>('first-pass');

  // ----- Counts / progress -----
  const [counts, setCounts] = useState({
    labeled: 0,
    skipped: 0,
    remaining: 0,
    flaggedInQueue: 0,
    sampledInQueue: 0,
  });
  const [allLabels, setAllLabels] = useState<TrainingLabel[]>([]);
  const qcState = useMemo(() => computeQCState(allLabels), [allLabels]);

  const refreshAll = useCallback(async () => {
    const [c, queue, labels] = await Promise.all([
      dbCountTrainingLabels(),
      dbListLabelQueue(),
      dbListTrainingLabels(),
    ]);
    setCounts({
      labeled: c.labeled,
      skipped: c.skipped,
      remaining: queue.queue.length,
      flaggedInQueue: queue.flaggedCount,
      sampledInQueue: queue.sampledCount,
    });
    setAllLabels(labels);
  }, []);
  useEffect(() => {
    refreshAll();
  }, [refreshAll]);

  // ----- Export -----
  const [exportError, setExportError] = useState<string | null>(null);
  const exportManifest = useCallback(async () => {
    const labels = await dbListTrainingLabels();
    const qc = computeQCState(labels);
    if (qc.exportBlockedReason) {
      setExportError(
        `Export blocked: ${qc.exportBlockedReason}. Switch to the Blind QC tab to complete it.`
      );
      return;
    }
    setExportError(null);
    const photos = await dbGetPhotosForLabels(labels);
    const manifest = buildManifest(labels, photos);
    const blob = new Blob([JSON.stringify(manifest, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `loadout-training-manifest-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, []);

  return (
    <>
      <section className="section">
        <div className="section__head">
          <h2 className="section__title">
            Training <em>data</em>
          </h2>
          <span className="section__meta">
            {counts.labeled} labeled · {counts.skipped} skipped · {counts.remaining} in queue
          </span>
        </div>

        <div className="banner banner--info">
          <span className="banner__icon">i</span>
          <div className="banner__body">
            Draw boxes around the batch code (required) and variety code (or mark "not present")
            on each photo. Provenance is tracked — Tesseract suggestions you don't edit are
            recorded as <code>tesseract_unmodified</code> so we can filter on human-verified
            labels later. <strong>Blind QC</strong> re-labels a 10% sample and gates export;
            review-scan is advisory only.
          </div>
        </div>

        <div className="field-row">
          <div className="field" style={{ maxWidth: 200 }}>
            <div className="field__label">Your initials</div>
            <input
              value={initials}
              onChange={(e) => setInitials(e.target.value.toUpperCase().slice(0, 4))}
              placeholder="MJ"
              maxLength={4}
            />
          </div>
          <div className="field" style={{ alignSelf: 'flex-end', marginLeft: 'auto' }}>
            <button
              className="btn"
              onClick={exportManifest}
              disabled={counts.labeled + counts.skipped === 0}
              title={
                qcState.exportBlockedReason
                  ? `Blocked: ${qcState.exportBlockedReason}`
                  : 'Download manifest JSON'
              }
            >
              ⬇ Export manifest
            </button>
          </div>
        </div>

        <div className="small soft" style={{ marginTop: 8 }}>
          queue: {counts.flaggedInQueue} flagged / {counts.sampledInQueue} sampled ·{' '}
          {qcState.passOneLabeled >= 10 ? (
            <>
              blind QC: {qcState.qcCompleted}/{qcState.qcSampled.length} re-labeled,{' '}
              {qcState.qcDisagreements.length} disagreement(s)
            </>
          ) : (
            <>blind QC: not required until ≥10 pass-1 labels</>
          )}
        </div>

        {exportError && (
          <div className="banner banner--danger" style={{ marginTop: 12 }}>
            <span className="banner__icon">✕</span>
            <div className="banner__body">{exportError}</div>
          </div>
        )}
      </section>

      <div className="label-mode-toggle">
        <ModeTab mode={mode} setMode={setMode} value="first-pass" label="First-pass" />
        <ModeTab
          mode={mode}
          setMode={setMode}
          value="blind-qc"
          label={`Blind QC (${Math.max(0, qcState.qcSampled.length - qcState.qcCompleted)} pending)`}
          disabled={qcState.qcSampled.length - qcState.qcCompleted === 0 && qcState.qcDisagreements.length === 0}
        />
        <ModeTab
          mode={mode}
          setMode={setMode}
          value="adjudicate"
          label={`Adjudicate (${qcState.qcDisagreements.length})`}
          disabled={qcState.qcDisagreements.length === 0}
        />
        <ModeTab mode={mode} setMode={setMode} value="review-scan" label="Review scan (advisory)" />
      </div>

      {mode === 'first-pass' && (
        <FirstPassMode
          initials={initials}
          onChanged={refreshAll}
        />
      )}
      {mode === 'blind-qc' && (
        <BlindQCMode
          qcState={qcState}
          initials={initials}
          onChanged={refreshAll}
        />
      )}
      {mode === 'adjudicate' && (
        <AdjudicateMode qcState={qcState} onChanged={refreshAll} />
      )}
      {mode === 'review-scan' && <ReviewScanMode allLabels={allLabels} />}
    </>
  );
}

function ModeTab(props: {
  mode: Mode;
  setMode: (m: Mode) => void;
  value: Mode;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      className={`label-mode-tab ${props.mode === props.value ? 'active' : ''}`}
      onClick={() => props.setMode(props.value)}
      disabled={props.disabled}
    >
      {props.label}
    </button>
  );
}

// =====================================================================
// First-pass mode
// =====================================================================

function FirstPassMode({
  initials,
  onChanged,
}: {
  initials: string;
  onChanged: () => void;
}) {
  const [current, setCurrent] = useState<PhotoWithInspection | null>(null);
  const [empty, setEmpty] = useState(false);

  const loadNext = useCallback(async () => {
    const { queue } = await dbListLabelQueue();
    const next = queue[0] || null;
    setCurrent(next);
    setEmpty(next === null);
  }, []);

  useEffect(() => {
    loadNext();
  }, [loadNext]);

  if (empty) {
    return (
      <div className="empty">
        <div className="empty__title">No photos in queue</div>
        <div className="empty__sub">
          Bag-flap photos and ML-flagged photos from the inspector flow show up here.
        </div>
      </div>
    );
  }
  if (!current) return null;

  return (
    <PhotoLabeler
      key={current.photo.id}
      target={current}
      pass={1}
      initials={initials}
      onSaved={async () => {
        await onChanged();
        await loadNext();
      }}
      onSkipped={async () => {
        await onChanged();
        await loadNext();
      }}
    />
  );
}

// =====================================================================
// Blind QC mode — pass=2, prefill forced off, no prior answer visible
// =====================================================================

function BlindQCMode({
  qcState,
  initials,
  onChanged,
}: {
  qcState: ReturnType<typeof computeQCState>;
  initials: string;
  onChanged: () => void;
}) {
  // Among the QC-sampled pass-1 labels, find those without a matching pass-2 yet.
  const [target, setTarget] = useState<PhotoWithInspection | null>(null);
  const [empty, setEmpty] = useState(false);

  const loadNext = useCallback(async () => {
    const allLabels = await dbListTrainingLabels();
    const pass2PhotoIds = new Set(
      allLabels.filter((l) => l.pass === 2).map((l) => l.photoId)
    );
    const nextP1 = qcState.qcSampled.find((p1) => !pass2PhotoIds.has(p1.photoId));
    if (!nextP1) {
      setTarget(null);
      setEmpty(true);
      return;
    }
    const photo = await dbGetLabelablePhoto(nextP1.photoId);
    setTarget(photo || null);
    setEmpty(!photo);
  }, [qcState.qcSampled]);

  useEffect(() => {
    loadNext();
  }, [loadNext]);

  if (empty) {
    return (
      <div className="empty">
        <div className="empty__title">Blind QC complete</div>
        <div className="empty__sub">
          {qcState.qcDisagreements.length > 0
            ? `Move to Adjudicate to resolve ${qcState.qcDisagreements.length} disagreement(s).`
            : 'All re-labels agree with the originals. Export is unblocked.'}
        </div>
      </div>
    );
  }
  if (!target) return null;

  return (
    <>
      <div className="banner banner--info">
        <span className="banner__icon">i</span>
        <div className="banner__body">
          <strong>Blind QC.</strong> Label this photo as if you've never seen it. Prior answer
          is hidden and Tesseract pre-fill is disabled to keep this re-label independent.
        </div>
      </div>
      <PhotoLabeler
        key={target.photo.id}
        target={target}
        pass={2}
        initials={initials}
        onSaved={async () => {
          await onChanged();
          await loadNext();
        }}
        onSkipped={async () => {
          await onChanged();
          await loadNext();
        }}
      />
    </>
  );
}

// =====================================================================
// Adjudicate mode — pick a winner for each disagreement
// =====================================================================

function AdjudicateMode({
  qcState,
  onChanged,
}: {
  qcState: ReturnType<typeof computeQCState>;
  onChanged: () => void;
}) {
  const [photosByLabelId, setPhotosByLabelId] = useState<Map<string, Blob>>(new Map());
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const map = new Map<string, Blob>();
      const wanted = new Set(qcState.qcDisagreements.map((d) => d.pass1.photoId));
      for (const photoId of wanted) {
        const blob = await dbGetPhotoBlob(photoId);
        if (blob) map.set(photoId, blob);
        if (cancelled) return;
      }
      if (!cancelled) setPhotosByLabelId(map);
    })();
    return () => {
      cancelled = true;
    };
  }, [qcState.qcDisagreements]);

  if (qcState.qcDisagreements.length === 0) {
    return (
      <div className="empty">
        <div className="empty__title">No disagreements to adjudicate</div>
      </div>
    );
  }

  const choose = async (winner: TrainingLabel, loser: TrainingLabel) => {
    // Winner becomes the canonical pass-1 record. Carry winner data into a
    // pass-1-shaped record (same id as the original p1 so we overwrite it).
    const p1 = winner.pass === 1 ? winner : loser; // we need the pass-1 id
    const finalRecord: TrainingLabel = {
      ...winner,
      id: p1.id,
      pass: 1,
      createdAt: new Date().toISOString(),
    };
    await dbSaveTrainingLabel(finalRecord);
    // Remove the pass-2 record now that the disagreement is resolved.
    const p2 = winner.pass === 2 ? winner : loser;
    await dbDeleteTrainingLabel(p2.id);
    await onChanged();
  };

  return (
    <section className="section">
      {qcState.qcDisagreements.map((d) => {
        const blob = photosByLabelId.get(d.pass1.photoId);
        return (
          <AdjudicationCard
            key={d.pass1.id}
            photoBlob={blob}
            pass1={d.pass1}
            pass2={d.pass2}
            reasons={d.reasons}
            onChoose={choose}
          />
        );
      })}
    </section>
  );
}

function AdjudicationCard({
  photoBlob,
  pass1,
  pass2,
  reasons,
  onChoose,
}: {
  photoBlob: Blob | undefined;
  pass1: TrainingLabel;
  pass2: TrainingLabel;
  reasons: string[];
  onChoose: (winner: TrainingLabel, loser: TrainingLabel) => Promise<void>;
}) {
  const url = useObjectURL(photoBlob);

  return (
    <div className="card adjudication">
      <div className="row-between" style={{ marginBottom: 8 }}>
        <div className="fw-500">Photo {pass1.photoId.slice(0, 8)}</div>
        <div className="small" style={{ color: 'var(--warn)' }}>
          {reasons.join(' · ')}
        </div>
      </div>
      <div className="adjudication__grid">
        <AdjudicationSide
          title="Pass 1"
          subtitle={`labeled by ${pass1.labeledBy} · ${pass1.createdAt.slice(0, 10)}`}
          imageUrl={url}
          label={pass1}
          onPick={() => onChoose(pass1, pass2)}
        />
        <AdjudicationSide
          title="Pass 2 (blind)"
          subtitle={`labeled by ${pass2.labeledBy} · ${pass2.createdAt.slice(0, 10)}`}
          imageUrl={url}
          label={pass2}
          onPick={() => onChoose(pass2, pass1)}
        />
      </div>
    </div>
  );
}

function AdjudicationSide({
  title,
  subtitle,
  imageUrl,
  label,
  onPick,
}: {
  title: string;
  subtitle: string;
  imageUrl: string | null;
  label: TrainingLabel;
  onPick: () => void;
}) {
  return (
    <div className="adjudication__side">
      <div className="fw-500" style={{ marginBottom: 2 }}>{title}</div>
      <div className="small soft" style={{ marginBottom: 6 }}>{subtitle}</div>
      <ReadOnlyImageWithBoxes imageUrl={imageUrl} label={label} maxHeight="40vh" />
      <div className="small mono" style={{ marginTop: 6 }}>
        batch: <strong>{label.batch?.text || '—'}</strong>{' '}
        <span className="soft">({label.batch?.provenance || '—'})</span>
      </div>
      <div className="small mono">
        variety: {label.varietyState === 'not_present' ? (
          <em className="soft">not present</em>
        ) : (
          <>
            <strong>{label.variety?.text || '—'}</strong>{' '}
            <span className="soft">({label.variety?.provenance || '—'})</span>
          </>
        )}
      </div>
      <button className="btn btn--accent" style={{ marginTop: 8 }} onClick={onPick}>
        Use this one ✓
      </button>
    </div>
  );
}

// =====================================================================
// Review scan — advisory only, gross-error sweep
// =====================================================================

function ReviewScanMode({ allLabels }: { allLabels: TrainingLabel[] }) {
  const items = useMemo(
    () =>
      allLabels
        .filter((l) => l.pass === 1 && l.status === 'labeled')
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [allLabels]
  );
  const [index, setIndex] = useState(0);
  const item = items[index];

  const [blob, setBlob] = useState<Blob | null>(null);
  useEffect(() => {
    if (!item) return;
    let cancelled = false;
    dbGetPhotoBlob(item.photoId).then((b) => {
      if (!cancelled) setBlob(b || null);
    });
    return () => {
      cancelled = true;
    };
  }, [item]);
  const imageUrl = useObjectURL(blob || undefined);

  if (items.length === 0) {
    return <div className="empty"><div className="empty__title">No labels to review yet</div></div>;
  }

  return (
    <section className="section">
      <div className="banner banner--warn">
        <span className="banner__icon">⚠</span>
        <div className="banner__body">
          <strong>Advisory mode.</strong> This is a gross-error sweep (wrong photo, box wildly
          misplaced, obviously wrong string) — not character-level verification. Showing you
          the prior answer anchors you on it, so this is structurally weak at catching your
          own fatigue drift. <strong>Blind QC is the only check that gates export.</strong>
        </div>
      </div>

      <div className="row-between" style={{ marginBottom: 12 }}>
        <div className="small soft">
          {index + 1} of {items.length}
        </div>
        <div className="flex gap-8">
          <button
            className="btn btn--sm"
            onClick={() => setIndex((i) => Math.max(0, i - 1))}
            disabled={index === 0}
          >
            ← Prev
          </button>
          <button
            className="btn btn--sm"
            onClick={() => setIndex((i) => Math.min(items.length - 1, i + 1))}
            disabled={index === items.length - 1}
          >
            Next →
          </button>
        </div>
      </div>

      <ReadOnlyImageWithBoxes imageUrl={imageUrl} label={item} maxHeight="70vh" />
      <div className="small mono" style={{ marginTop: 6 }}>
        batch: <strong>{item.batch?.text}</strong> ({item.batch?.provenance}) · variety:{' '}
        {item.varietyState === 'not_present' ? (
          <em>not present</em>
        ) : (
          <>
            <strong>{item.variety?.text}</strong> ({item.variety?.provenance})
          </>
        )}
      </div>
    </section>
  );
}

// =====================================================================
// PhotoLabeler — the shared editing surface used by First-pass and Blind-QC
// =====================================================================

interface PhotoLabelerProps {
  target: PhotoWithInspection;
  pass: 1 | 2;
  initials: string;
  onSaved: () => void;
  onSkipped: () => void;
}

function PhotoLabeler({
  target,
  pass,
  initials,
  onSaved,
  onSkipped,
}: PhotoLabelerProps) {
  const [blob, setBlob] = useState<Blob | null>(null);
  useEffect(() => {
    let cancelled = false;
    dbGetPhotoBlob(target.photo.id).then((b) => {
      if (!cancelled) setBlob(b || null);
    });
    return () => {
      cancelled = true;
    };
  }, [target.photo.id]);
  const imageUrl = useObjectURL(blob || undefined);

  const [activeRegion, setActiveRegion] = useState<RegionKind>('batch');
  const [batchDraft, setBatchDraft] = useState<Pending>(emptyPending);
  const [varietyDraft, setVarietyDraft] = useState<Pending>(emptyPending);
  const [varietyState, setVarietyState] = useState<VarietyState>('present');
  const [analyzing, setAnalyzing] = useState(false);
  const [saveErrors, setSaveErrors] = useState<string[]>([]);
  const [confirmArmed, setConfirmArmed] = useState(false);
  const [showSkipMenu, setShowSkipMenu] = useState(false);

  const onMarkNotPresent = useCallback(() => {
    setVarietyState('not_present');
    setVarietyDraft(emptyPending);
    if (activeRegion === 'variety') setActiveRegion('batch');
  }, [activeRegion]);

  const onMarkPresent = useCallback(() => {
    setVarietyState('present');
  }, []);

  const onSave = useCallback(async () => {
    const draft = {
      batch: { box: batchDraft.box, text: batchDraft.text.trim() },
      varietyState,
      variety: { box: varietyDraft.box, text: varietyDraft.text.trim() },
    };
    const validation = validateForSave(draft);
    if (!validation.ok) {
      setSaveErrors(validation.errors);
      return;
    }
    const batchProv = computeProvenance(batchDraft.initialPrefill, batchDraft.text.trim());
    const varietyProv = computeProvenance(
      varietyDraft.initialPrefill,
      varietyDraft.text.trim()
    );

    if (REQUIRE_CONFIRM_ON_UNMODIFIED) {
      const anyUnmodified =
        (batchDraft.text.trim().length > 0 && batchProv === 'tesseract_unmodified') ||
        (varietyState === 'present' &&
          varietyDraft.text.trim().length > 0 &&
          varietyProv === 'tesseract_unmodified');
      if (anyUnmodified && !confirmArmed) {
        setConfirmArmed(true);
        return;
      }
    }

    const buildRegion = (
      d: Pending,
      prov: Provenance,
      kind: RegionKind
    ): TrainingRegion | undefined => {
      if (!d.box || d.text.trim().length === 0) return undefined;
      return {
        box: d.box,
        text: d.text.trim(),
        provenance: prov,
        formatValid: isFormatValid(d.text.trim(), kind),
      };
    };

    const existing = await dbGetTrainingLabels(target.photo.id);
    const sameSlot = existing.find((l) => l.pass === pass);

    const record: TrainingLabel = {
      id: sameSlot?.id || crypto.randomUUID(),
      photoId: target.photo.id,
      inspectionId: target.inspectionId,
      createdAt: new Date().toISOString(),
      labeledBy: initials || 'unknown',
      pass,
      status: 'labeled',
      batch: buildRegion(batchDraft, batchProv, 'batch'),
      varietyState,
      variety:
        varietyState === 'present'
          ? buildRegion(varietyDraft, varietyProv, 'variety')
          : undefined,
    };
    await dbSaveTrainingLabel(record);
    onSaved();
  }, [
    target,
    pass,
    batchDraft,
    varietyDraft,
    varietyState,
    confirmArmed,
    initials,
    onSaved,
  ]);

  const onSkip = useCallback(
    async (reason: SkipReason) => {
      const existing = await dbGetTrainingLabels(target.photo.id);
      const sameSlot = existing.find((l) => l.pass === pass);
      const record: TrainingLabel = {
        id: sameSlot?.id || crypto.randomUUID(),
        photoId: target.photo.id,
        inspectionId: target.inspectionId,
        createdAt: new Date().toISOString(),
        labeledBy: initials || 'unknown',
        pass,
        status: 'skipped',
        skipReason: reason,
        varietyState: 'not_present',
      };
      await dbSaveTrainingLabel(record);
      onSkipped();
    },
    [target, pass, initials, onSkipped]
  );

  // Keyboard
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const inField =
        e.target instanceof HTMLElement &&
        (e.target.tagName === 'INPUT' ||
          e.target.tagName === 'TEXTAREA' ||
          e.target.tagName === 'SELECT');
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        onSave();
        return;
      }
      if (inField) return;
      if (e.key === 's' || e.key === 'S') {
        e.preventDefault();
        setActiveRegion((r) => (r === 'batch' ? 'variety' : 'batch'));
      }
      if (e.key === 'n' || e.key === 'N') {
        e.preventDefault();
        onMarkNotPresent();
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        if (activeRegion === 'batch') setBatchDraft((d) => ({ ...d, box: null }));
        else setVarietyDraft((d) => ({ ...d, box: null }));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [activeRegion, onSave, onMarkNotPresent]);

  return (
    <section className="section">
      <div className="section__head">
        <h2 className="section__title">
          {pass === 2 ? 'Blind QC label' : 'Label photo'}
        </h2>
        <span className="section__meta mono small">
          {target.photo.category} · {target.photo.id.slice(0, 8)} · captured{' '}
          {target.photo.capturedAt.slice(0, 10)}
        </span>
      </div>

      <div className="label-region-toggle">
        <button
          className={`label-region-toggle__btn ${activeRegion === 'batch' ? 'active' : ''}`}
          onClick={() => setActiveRegion('batch')}
        >
          Batch
        </button>
        <button
          className={`label-region-toggle__btn ${activeRegion === 'variety' ? 'active' : ''}`}
          onClick={() => {
            setActiveRegion('variety');
            if (varietyState === 'not_present') setVarietyState('present');
          }}
          disabled={varietyState === 'not_present'}
        >
          Variety
        </button>
        <button
          className={`label-region-toggle__btn label-region-toggle__btn--not-present ${
            varietyState === 'not_present' ? 'active' : ''
          }`}
          onClick={varietyState === 'not_present' ? onMarkPresent : onMarkNotPresent}
        >
          {varietyState === 'not_present' ? 'Variety: not present ✓' : 'Mark variety not present'}
        </button>
        <span className="small soft" style={{ marginLeft: 'auto' }}>
          Draw/drag/resize · <kbd>S</kbd> swap · <kbd>N</kbd> not-present · <kbd>Esc</kbd>{' '}
          clear · <kbd>Enter</kbd> save
        </span>
      </div>

      <LabelingCanvas
        imageUrl={imageUrl}
        activeRegion={activeRegion}
        batchDraft={batchDraft}
        varietyDraft={varietyDraft}
        varietyState={varietyState}
        setActiveDraft={(updater) => {
          if (activeRegion === 'batch') setBatchDraft(updater);
          else setVarietyDraft(updater);
        }}
      />

      <div className="field-row" style={{ marginTop: 12 }}>
        <RegionTextInput
          label="Batch"
          kind="batch"
          draft={batchDraft}
          setDraft={setBatchDraft}
          onFocus={() => setActiveRegion('batch')}
          onClearBox={() => setBatchDraft((d) => ({ ...d, box: null }))}
          disabled={false}
        />
        <RegionTextInput
          label="Variety"
          kind="variety"
          draft={varietyDraft}
          setDraft={setVarietyDraft}
          onFocus={() => {
            setActiveRegion('variety');
            if (varietyState === 'not_present') setVarietyState('present');
          }}
          onClearBox={() => setVarietyDraft((d) => ({ ...d, box: null }))}
          disabled={varietyState === 'not_present'}
        />
      </div>

      {analyzing && (
        <div className="small soft" style={{ marginTop: 8 }}>
          Tesseract pre-fill running…
        </div>
      )}

      {saveErrors.length > 0 && (
        <div className="banner banner--danger" style={{ marginTop: 12 }}>
          <span className="banner__icon">✕</span>
          <div className="banner__body">
            {saveErrors.map((e) => humanReadableError(e)).join(' · ')}
          </div>
        </div>
      )}

      {confirmArmed && (
        <div className="banner banner--warn" style={{ marginTop: 12 }}>
          <span className="banner__icon">⚠</span>
          <div className="banner__body">
            Field still holds unedited Tesseract output. Press <kbd>Enter</kbd> (or click
            Save) again to confirm.
          </div>
        </div>
      )}

      <div className="row-between" style={{ marginTop: 16 }}>
        <div className="flex gap-8" style={{ position: 'relative' }}>
          <button className="btn btn--ghost" onClick={() => setShowSkipMenu(!showSkipMenu)}>
            Skip photo
          </button>
          {showSkipMenu && (
            <div className="skip-menu">
              {(['unreadable', 'no_code_visible', 'duplicate', 'other'] as SkipReason[]).map(
                (r) => (
                  <button key={r} className="skip-menu__item" onClick={() => onSkip(r)}>
                    {r.replace(/_/g, ' ')}
                  </button>
                )
              )}
            </div>
          )}
        </div>
        <button className="btn btn--accent btn--lg" onClick={onSave}>
          {confirmArmed ? '✓ Confirm and save' : 'Save and next →'}
        </button>
      </div>
    </section>
  );
}

// =====================================================================
// LabelingCanvas — drawable image + corner-handle resize
// =====================================================================

const HANDLE_HIT_RADIUS = 14; // px from corner to count as a handle drag

type DragMode = 'draw' | 'move' | 'nw' | 'ne' | 'sw' | 'se' | null;

function LabelingCanvas(props: {
  imageUrl: string | null;
  activeRegion: RegionKind;
  batchDraft: Pending;
  varietyDraft: Pending;
  varietyState: VarietyState;
  setActiveDraft: (updater: (d: Pending) => Pending) => void;
}) {
  const { imageUrl, activeRegion, batchDraft, varietyDraft, varietyState, setActiveDraft } = props;

  const containerRef = useRef<HTMLDivElement | null>(null);
  const [natural, setNatural] = useState({ w: 0, h: 0 });
  const [containerSize, setContainerSize] = useState({ w: 0, h: 0 });

  useEffect(() => {
    const update = () => {
      const el = containerRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      setContainerSize({ w: r.width, h: r.height });
    };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  const fitted = fittedSize(natural.w, natural.h, containerSize.w, containerSize.h);
  const activeBox =
    activeRegion === 'batch' ? batchDraft.box : varietyDraft.box;

  const dragRef = useRef<{
    mode: DragMode;
    startX: number;
    startY: number;
    origBox: NormalizedBox | null;
  }>({ mode: null, startX: 0, startY: 0, origBox: null });

  const cornerHit = (
    px: number,
    py: number,
    box: { x: number; y: number; w: number; h: number }
  ): DragMode | null => {
    const corners: Array<{ name: 'nw' | 'ne' | 'sw' | 'se'; cx: number; cy: number }> = [
      { name: 'nw', cx: box.x, cy: box.y },
      { name: 'ne', cx: box.x + box.w, cy: box.y },
      { name: 'sw', cx: box.x, cy: box.y + box.h },
      { name: 'se', cx: box.x + box.w, cy: box.y + box.h },
    ];
    for (const c of corners) {
      if (Math.abs(px - c.cx) <= HANDLE_HIT_RADIUS && Math.abs(py - c.cy) <= HANDLE_HIT_RADIUS) {
        return c.name;
      }
    }
    return null;
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (activeRegion === 'variety' && varietyState === 'not_present') return;
    if (!fitted.w || !fitted.h) return;
    const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    if (px < 0 || py < 0 || px > fitted.w || py > fitted.h) return;

    (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);

    const existing = activeBox ? naturalBoxToDisplay(activeBox, fitted.w, fitted.h) : null;
    if (existing) {
      const corner = cornerHit(px, py, existing);
      if (corner) {
        dragRef.current = { mode: corner, startX: px, startY: py, origBox: activeBox };
        return;
      }
      const inside =
        px >= existing.x &&
        py >= existing.y &&
        px <= existing.x + existing.w &&
        py <= existing.y + existing.h;
      if (inside) {
        dragRef.current = { mode: 'move', startX: px, startY: py, origBox: activeBox };
        return;
      }
    }
    dragRef.current = { mode: 'draw', startX: px, startY: py, origBox: null };
    const norm = displayBoxToNatural({ x: px, y: py, w: 0, h: 0 }, fitted.w, fitted.h);
    setActiveDraft((d) => ({ ...d, box: norm }));
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const state = dragRef.current;
    if (!state.mode || !fitted.w || !fitted.h) return;
    const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;

    if (state.mode === 'draw') {
      const x = Math.min(state.startX, px);
      const y = Math.min(state.startY, py);
      const w = Math.abs(px - state.startX);
      const h = Math.abs(py - state.startY);
      setActiveDraft((d) => ({ ...d, box: displayBoxToNatural({ x, y, w, h }, fitted.w, fitted.h) }));
      return;
    }
    if (!state.origBox) return;
    const orig = naturalBoxToDisplay(state.origBox, fitted.w, fitted.h);

    if (state.mode === 'move') {
      const dx = px - state.startX;
      const dy = py - state.startY;
      setActiveDraft((d) => ({
        ...d,
        box: displayBoxToNatural(
          { x: orig.x + dx, y: orig.y + dy, w: orig.w, h: orig.h },
          fitted.w,
          fitted.h
        ),
      }));
      return;
    }
    // Corner resize — keep the opposite corner fixed
    let x1 = orig.x;
    let y1 = orig.y;
    let x2 = orig.x + orig.w;
    let y2 = orig.y + orig.h;
    if (state.mode === 'nw') {
      x1 = px;
      y1 = py;
    } else if (state.mode === 'ne') {
      x2 = px;
      y1 = py;
    } else if (state.mode === 'sw') {
      x1 = px;
      y2 = py;
    } else if (state.mode === 'se') {
      x2 = px;
      y2 = py;
    }
    const nx = Math.min(x1, x2);
    const ny = Math.min(y1, y2);
    const nw = Math.abs(x2 - x1);
    const nh = Math.abs(y2 - y1);
    setActiveDraft((d) => ({
      ...d,
      box: displayBoxToNatural({ x: nx, y: ny, w: nw, h: nh }, fitted.w, fitted.h),
    }));
  };

  const onPointerUp = () => {
    dragRef.current = { mode: null, startX: 0, startY: 0, origBox: null };
  };

  const renderBox = (norm: NormalizedBox | null, kind: RegionKind, isActive: boolean) => {
    if (!norm) return null;
    const p = naturalBoxToDisplay(norm, fitted.w, fitted.h);
    return (
      <div
        key={kind + '-box'}
        className={`label-box label-box--${kind} ${isActive ? 'label-box--active' : ''}`}
        style={{ left: p.x, top: p.y, width: p.w, height: p.h }}
      >
        <span className="label-box__tag">{kind}</span>
        {isActive && (
          <>
            <span className="label-box__handle label-box__handle--nw" />
            <span className="label-box__handle label-box__handle--ne" />
            <span className="label-box__handle label-box__handle--sw" />
            <span className="label-box__handle label-box__handle--se" />
          </>
        )}
      </div>
    );
  };

  return (
    <div
      ref={containerRef}
      className="label-canvas"
      style={{ maxHeight: '70vh' }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      {imageUrl ? (
        <img
          src={imageUrl}
          alt="bag flap"
          draggable={false}
          className="label-canvas__img"
          style={{ width: fitted.w || 'auto', height: fitted.h || 'auto' }}
          onLoad={(e) => {
            const im = e.currentTarget;
            setNatural({ w: im.naturalWidth, h: im.naturalHeight });
          }}
        />
      ) : (
        <div className="empty"><div className="empty__title">Loading photo…</div></div>
      )}
      {/* Inactive region drawn dimmed and underneath */}
      {activeRegion === 'batch' && renderBox(varietyDraft.box, 'variety', false)}
      {activeRegion === 'variety' && renderBox(batchDraft.box, 'batch', false)}
      {renderBox(activeBox, activeRegion, true)}
    </div>
  );
}

// =====================================================================
// Read-only image + boxes (adjudication, review scan)
// =====================================================================

function ReadOnlyImageWithBoxes({
  imageUrl,
  label,
  maxHeight,
}: {
  imageUrl: string | null;
  label: TrainingLabel;
  maxHeight: string;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [natural, setNatural] = useState({ w: 0, h: 0 });
  const [containerSize, setContainerSize] = useState({ w: 0, h: 0 });

  useEffect(() => {
    const update = () => {
      const el = containerRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      setContainerSize({ w: r.width, h: r.height });
    };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  const fitted = fittedSize(natural.w, natural.h, containerSize.w, containerSize.h);

  const renderRO = (norm: NormalizedBox | undefined, kind: RegionKind) => {
    if (!norm) return null;
    const p = naturalBoxToDisplay(norm, fitted.w, fitted.h);
    return (
      <div
        className={`label-box label-box--${kind} label-box--active`}
        style={{ left: p.x, top: p.y, width: p.w, height: p.h, pointerEvents: 'none' }}
      >
        <span className="label-box__tag">{kind}</span>
      </div>
    );
  };

  return (
    <div
      ref={containerRef}
      className="label-canvas"
      style={{ maxHeight }}
    >
      {imageUrl && (
        <img
          src={imageUrl}
          alt="labeled bag flap"
          draggable={false}
          className="label-canvas__img"
          style={{ width: fitted.w || 'auto', height: fitted.h || 'auto' }}
          onLoad={(e) => {
            const im = e.currentTarget;
            setNatural({ w: im.naturalWidth, h: im.naturalHeight });
          }}
        />
      )}
      {renderRO(label.batch?.box, 'batch')}
      {label.varietyState === 'present' && renderRO(label.variety?.box, 'variety')}
    </div>
  );
}

// =====================================================================
// Region text input
// =====================================================================

function RegionTextInput(props: {
  label: string;
  kind: RegionKind;
  draft: Pending;
  setDraft: (next: Pending | ((p: Pending) => Pending)) => void;
  onFocus: () => void;
  onClearBox: () => void;
  disabled: boolean;
}) {
  const { label, kind, draft, setDraft, onFocus, onClearBox, disabled } = props;
  const text = draft.text;
  const isPrefilled = draft.initialPrefill.length > 0 && text === draft.initialPrefill;
  const valid = text.length > 0 ? isFormatValid(text, kind) : null;

  return (
    <div className="field">
      <div className="field__label">{label}</div>
      <input
        className={`label-input mono ${isPrefilled ? 'label-input--prefilled' : ''}`}
        value={text}
        onFocus={onFocus}
        onChange={(e) =>
          setDraft((d) => ({ ...d, text: e.target.value.toUpperCase() }))
        }
        placeholder={kind === 'batch' ? 'P28S8W5M8' : 'DKC45-74RIB'}
        disabled={disabled}
      />
      <div className="row-between" style={{ marginTop: 4 }}>
        <span className="small">
          {disabled ? (
            <span className="soft">disabled — variety marked not present</span>
          ) : valid === null ? (
            <span className="soft">enter text</span>
          ) : valid ? (
            <span style={{ color: 'var(--accent)' }}>✓ format match</span>
          ) : (
            <span style={{ color: 'var(--warn)' }}>⚠ no format match (still ok to save)</span>
          )}
        </span>
        <button
          className="btn btn--sm btn--ghost"
          onClick={onClearBox}
          type="button"
          disabled={disabled}
        >
          clear box
        </button>
      </div>
    </div>
  );
}

// =====================================================================
// useObjectURL — manage object URL lifecycle for a Blob
// =====================================================================

function useObjectURL(blob: Blob | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!blob) {
      setUrl(null);
      return;
    }
    const u = URL.createObjectURL(blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [blob]);
  return url;
}

function humanReadableError(code: string): string {
  switch (code) {
    case 'batch_box_missing':
      return 'Batch needs a bounding box';
    case 'batch_text_missing':
      return 'Batch needs text';
    case 'variety_box_missing':
      return 'Variety has text but no box (or click "Mark variety not present")';
    case 'variety_text_missing':
      return 'Variety has a box but no text (or click "Mark variety not present")';
    default:
      return code;
  }
}
