import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { dbGetInspection } from '../services/db';
import { useInspection } from '../hooks/useInspection';
import { SlotPhotoCapture } from '../components/PhotoCapture';
import { SuggestableField } from '../components/SuggestableField';
import { QualityFlagButton } from '../components/QualityFlagButton';
import type { Inspection, Suggestable, BatchSection } from '../types/inspection';
import { getRequiredPhotoSlots, PALLET_TYPES } from '../types/inspection';

export function ScanPalletRoute() {
  const { id, palletIndex } = useParams<{ id: string; palletIndex: string }>();
  const navigate = useNavigate();
  const [loaded, setLoaded] = useState<Inspection | null>(null);

  useEffect(() => {
    if (!id) return;
    dbGetInspection(id).then((i) => {
      if (!i) navigate('/');
      else setLoaded(i);
    });
  }, [id, navigate]);

  if (!loaded) return null;
  const idx = parseInt(palletIndex || '0', 10);
  if (idx < 0 || idx >= loaded.pallets.length) {
    navigate(`/inspection/${loaded.id}`);
    return null;
  }
  return <PalletInner initial={loaded} palletIndex={idx} />;
}

function PalletInner({ initial, palletIndex }: { initial: Inspection; palletIndex: number }) {
  const { inspection, dispatch } = useInspection(initial);
  const navigate = useNavigate();
  const pallet = inspection.pallets[palletIndex];

  if (!pallet) {
    navigate(`/inspection/${inspection.id}`);
    return null;
  }

  const requiredSlots = getRequiredPhotoSlots(pallet.palletType, pallet.batchCount);
  const findSlotPhoto = (slotKey: string) =>
    pallet.photos.find((p) => p.slotKey === slotKey);

  // Expected batches for this pallet — pulled from picklist line items
  // assigned to the same delivery, plus any batches already entered manually
  // in this pallet's batchSections. Passed to OCR so it can match Tesseract's
  // imperfect output against the known-correct set.
  const expectedBatches: string[] = (() => {
    const codes = new Set<string>();
    for (const li of inspection.picklist.lineItems) {
      if (li.deliveryId === pallet.deliveryId && li.batchCode.value) {
        codes.add(li.batchCode.value);
      }
    }
    for (const bs of pallet.batchSections) {
      if (bs.batchCode.value) codes.add(bs.batchCode.value);
    }
    return Array.from(codes);
  })();

  // Map ML-detected batch codes from bag flap photos to batch sections
  useEffect(() => {
    pallet.batchSections.forEach((section, sectionIdx) => {
      const flapSlotKey = `bag-flap-${sectionIdx + 1}`;
      const flapPhoto = pallet.photos.find((p) => p.slotKey === flapSlotKey);
      const detected = flapPhoto?.mlResults?.detectedBatchCode;

      if (detected && section.batchCode.mlSuggestion !== detected) {
        // Update suggestion without overwriting manual values
        const updatedField: Suggestable<string> = {
          value:
            section.batchCode.source === 'manual' || section.batchCode.source === 'ml-edited'
              ? section.batchCode.value
              : detected,
          source:
            section.batchCode.source === 'manual' || section.batchCode.source === 'ml-edited'
              ? section.batchCode.source
              : 'ml-accepted',
          mlSuggestion: detected,
          mlConfidence: flapPhoto?.mlResults?.batchCodeConfidence,
          mlVersion: flapPhoto?.mlResults?.modelVersions?.ocr,
          mlAnalyzedAt: flapPhoto?.mlResults?.analyzedAt,
        };
        dispatch({
          type: 'UPDATE_BATCH_SECTION',
          palletIndex,
          sectionId: section.id,
          patch: { batchCode: updatedField },
        });
      }
    });
  }, [pallet.photos]);

  const removePallet = () => {
    if (!window.confirm('Remove this pallet? Photos and data will be lost.')) return;
    dispatch({ type: 'REMOVE_PALLET', index: palletIndex });
    navigate(`/inspection/${inspection.id}`);
  };

  const delivery = inspection.bol.deliveries.find((d) => d.id === pallet.deliveryId);

  const totalActualOnPallet = pallet.batchSections.reduce(
    (sum, bs) => sum + (bs.actualBagCount.value || 0),
    0
  );

  // For each section, compute how much more is "available" (i.e., remaining on picklist)
  const remainingForBatch = (batchCode: string | null) => {
    if (!batchCode) return null;
    const lineItem = inspection.picklist.lineItems.find((li) => li.batchCode.value === batchCode);
    if (!lineItem) return null;
    const expected = lineItem.expectedQuantity.value || 0;
    // Total already counted across all pallets except this one
    let countedElsewhere = 0;
    inspection.pallets.forEach((p, idx) => {
      if (idx === palletIndex) return;
      p.batchSections.forEach((bs) => {
        if (bs.batchCode.value === batchCode) {
          countedElsewhere += bs.actualBagCount.value || 0;
        }
      });
    });
    return Math.max(0, expected - countedElsewhere);
  };

  return (
    <main>
      <div className="page-head">
        <div>
          <h1 className="page-head__title">
            Pallet <em>{pallet.palletNumber}</em>
          </h1>
          <div className="page-head__sub">
            {pallet.palletType}
            {delivery && (
              <>
                {' '}· Delivery <span className="mono">{delivery.deliveryNumber}</span>
                {inspection.type !== 'returns' && delivery.stopNumber !== undefined && <> (Stop {delivery.stopNumber})</>}
              </>
            )}
          </div>
        </div>
        <div className="page-head__actions">
          <QualityFlagButton
            flag={pallet.qualityFlag}
            level="pallet"
            currentUser={inspection.startedBy || 'unknown'}
            onFlag={(flag) =>
              dispatch({ type: 'SET_PALLET_QUALITY_FLAG', index: palletIndex, flag })
            }
            onUnflag={() =>
              dispatch({ type: 'SET_PALLET_QUALITY_FLAG', index: palletIndex, flag: undefined })
            }
          />
          <button
            className="btn btn--ghost btn--sm"
            onClick={() => navigate(`/inspection/${inspection.id}`)}
          >
            ← Back
          </button>
        </div>
      </div>

      {/* Pallet type / change */}
      <section className="section">
        <div className="field">
          <div className="field__label">Pallet type</div>
          <select
            value={pallet.palletType}
            onChange={(e) =>
              dispatch({
                type: 'UPDATE_PALLET',
                index: palletIndex,
                patch: { palletType: e.target.value as any },
              })
            }
          >
            {PALLET_TYPES.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>
      </section>

      {/* Photo slots — fixed-position grid */}
      <section className="section">
        <div className="section__head">
          <h2 className="section__title">
            Required <em>photos</em>
          </h2>
          <span className="section__meta">
            {pallet.photos.filter((p) => p.slotKey).length} of {requiredSlots.length} captured
          </span>
        </div>

        {/* Stop sticker check - look at side photos for detected stop number */}
        {delivery?.stopNumber !== undefined && (() => {
          const sidePhotos = pallet.photos.filter((p) =>
            p.slotKey?.startsWith('side-') && p.mlResults?.detectedStopNumber !== undefined
          );
          if (sidePhotos.length === 0) return null;
          const detectedStops = [
            ...new Set(sidePhotos.map((p) => p.mlResults!.detectedStopNumber!)),
          ];
          const expectedStop = delivery.stopNumber;
          const mismatch = detectedStops.some((s) => s !== expectedStop);

          if (mismatch) {
            return (
              <div className="banner banner--danger">
                <span className="banner__icon">⚠</span>
                <div className="banner__body">
                  <strong>Stop sticker mismatch.</strong> This pallet is assigned to Stop{' '}
                  {expectedStop}, but the sticker visible in side photos reads Stop{' '}
                  {detectedStops.join(' / ')}. Check the sticker on the pallet — either the
                  pallet is on the wrong stop, or the sticker needs to be replaced.
                </div>
              </div>
            );
          }
          return (
            <div className="banner banner--success">
              <span className="banner__icon">✓</span>
              <div className="banner__body">
                Stop sticker matches: pallet correctly labeled for Stop {expectedStop}.
              </div>
            </div>
          );
        })()}

        {/* Returns Damage Check */}
        {inspection.type === 'returns' && (() => {
          const damagePhotos = pallet.photos.filter(
            (p) => p.mlResults?.returnsDamageAssessment?.damageDetected
          );
          if (damagePhotos.length === 0) return null;

          return (
            <div className="banner banner--danger" style={{ marginBottom: 16 }}>
              <span className="banner__icon">⚠</span>
              <div className="banner__body">
                <strong>Damage Detected by AI:</strong>
                <ul style={{ margin: '4px 0 0 16px' }}>
                  {damagePhotos.map((p) => (
                    <li key={p.id}>
                      <strong>{p.mlResults!.returnsDamageAssessment!.damageType}</strong>:{' '}
                      {p.mlResults!.returnsDamageAssessment!.damageDescription}
                    </li>
                  ))}
                </ul>
                Please verify and note the failure reason below if the pallet is unacceptable.
              </div>
            </div>
          );
        })()}

        <div className="photo-slot-grid">
          {requiredSlots.map((slot) => (
            <SlotPhotoCapture
              key={slot.key}
              inspectionId={inspection.id}
              category={
                inspection.type === 'returns' && slot.category === 'Pallet_Side'
                  ? 'Returns_Damage_Assessment'
                  : slot.category
              }
              slotKey={slot.key}
              slotLabel={slot.label}
              palletIndex={palletIndex}
              existingPhoto={findSlotPhoto(slot.key)}
              currentUser={inspection.startedBy || 'unknown'}
              expectedBatches={
                slot.category === 'Pallet_BagFlap' ||
                slot.category === 'Pallet_LPN'
                  ? expectedBatches
                  : undefined
              }
              onCaptured={(photo) =>
                dispatch({
                  type: 'REPLACE_PALLET_PHOTO',
                  palletIndex,
                  slotKey: slot.key,
                  photo,
                })
              }
              onMLComplete={(photoId, results) =>
                dispatch({ type: 'UPDATE_PHOTO_ML', photoId, results })
              }
              onQualityFlag={(photoId, flag) =>
                dispatch({ type: 'SET_PHOTO_QUALITY_FLAG', photoId, flag })
              }
              onMLFlag={(photoId, flag) =>
                dispatch({ type: 'SET_PHOTO_ML_FLAG', photoId, flag })
              }
            />
          ))}
        </div>
      </section>

      {/* Batch sections - one per batch on this pallet */}
      <section className="section">
        <div className="section__head">
          <h2 className="section__title">
            Batch <em>{pallet.batchSections.length === 1 ? 'data' : 'sections'}</em>
          </h2>
          {pallet.batchSections.length > 1 && (
            <span className="section__meta">{pallet.batchSections.length} batches on this pallet</span>
          )}
        </div>

        {pallet.batchSections.map((section, sectionIdx) => (
          <BatchSectionRow
            key={section.id}
            section={section}
            sectionNumber={sectionIdx + 1}
            isMultiple={pallet.batchSections.length > 1}
            remainingAvailable={remainingForBatch(section.batchCode.value)}
            onUpdate={(patch) =>
              dispatch({
                type: 'UPDATE_BATCH_SECTION',
                palletIndex,
                sectionId: section.id,
                patch,
              })
            }
          />
        ))}
      </section>

      {/* Inspection result */}
      <section className="section">
        <div className="section__head">
          <h2 className="section__title">
            Inspection <em>result</em>
          </h2>
        </div>
        <div className="field-row">
          <div className="field">
            <div className="field__label">Passes inspection?</div>
            <div className="toggle-group">
              <button
                className={pallet.passInspection === 'Pass' ? 'active' : ''}
                onClick={() =>
                  dispatch({
                    type: 'UPDATE_PALLET',
                    index: palletIndex,
                    patch: { passInspection: 'Pass' },
                  })
                }
              >
                ✓ Pass
              </button>
              <button
                className={pallet.passInspection === 'Fail' ? 'active danger' : ''}
                onClick={() =>
                  dispatch({
                    type: 'UPDATE_PALLET',
                    index: palletIndex,
                    patch: { passInspection: 'Fail' },
                  })
                }
              >
                ✗ Fail
              </button>
            </div>
          </div>
          {inspection.type !== 'returns' && (
            <div className="field">
              <div className="field__label">Accuracy label attached?</div>
              <div className="toggle-group">
                {(['Yes', 'No', 'N/A'] as const).map((v) => (
                  <button
                    key={v}
                    className={pallet.accuracyLabelAttached === v ? 'active' : ''}
                    onClick={() =>
                      dispatch({
                        type: 'UPDATE_PALLET',
                        index: palletIndex,
                        patch: { accuracyLabelAttached: v },
                      })
                    }
                  >
                    {v}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {pallet.passInspection === 'Fail' && (
          <div className="flex-col gap-16" style={{ marginTop: 16 }}>
            <div className="field">
              <div className="field__label">Rejected Bags (how many bags are rejected)</div>
              <input
                type="number"
                value={pallet.rejectedBagCount === undefined ? '' : String(pallet.rejectedBagCount)}
                onChange={(e) =>
                  dispatch({
                    type: 'UPDATE_PALLET',
                    index: palletIndex,
                    patch: {
                      rejectedBagCount: e.target.value === '' ? undefined : Number(e.target.value),
                    },
                  })
                }
                placeholder="0"
              />
            </div>
            <div className="field">
              <div className="field__label">Notes / Reasoning for rejection</div>
              <textarea
                value={pallet.rejectedNotes || ''}
                onChange={(e) =>
                  dispatch({
                    type: 'UPDATE_PALLET',
                    index: palletIndex,
                    patch: { rejectedNotes: e.target.value },
                  })
                }
                rows={3}
                placeholder="Describe why these bags were rejected (e.g. forklift damage, mouse holes, water damage)..."
              />
            </div>
          </div>
        )}
      </section>

      <div className="card" style={{ background: 'var(--surface-tint)', marginTop: 16 }}>
        <div className="row-between">
          <div>
            <div className="xs soft" style={{ textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              Total on this pallet
            </div>
            <div className="fw-500" style={{ fontSize: 24 }}>{totalActualOnPallet} bags</div>
          </div>
        </div>
      </div>

      <div
        className="row-between"
        style={{
          position: 'sticky',
          bottom: 0,
          background: 'var(--paper)',
          borderTop: '1px solid var(--rule-soft)',
          padding: '16px 0',
          marginTop: 24,
        }}
      >
        <button className="btn btn--danger btn--ghost" onClick={removePallet}>
          Remove pallet
        </button>
        <button
          className="btn btn--accent btn--lg"
          onClick={() => navigate(`/inspection/${inspection.id}`)}
        >
          ✓ Add to load
        </button>
      </div>
    </main>
  );
}

function BatchSectionRow({
  section,
  sectionNumber,
  isMultiple,
  remainingAvailable,
  onUpdate,
}: {
  section: BatchSection;
  sectionNumber: number;
  isMultiple: boolean;
  remainingAvailable: number | null;
  onUpdate: (patch: Partial<BatchSection>) => void;
}) {
  const actual = section.actualBagCount.value;
  const expected = section.expectedBagCount;
  const mismatch = expected > 0 && actual !== null && actual !== expected;

  return (
    <div className="card">
      {isMultiple && (
        <div
          className="xs soft fw-500"
          style={{ textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}
        >
          Batch {sectionNumber}
        </div>
      )}
      <div className="field-row">
        <SuggestableField
          label="Batch code"
          field={section.batchCode}
          mono
          placeholder="P18GY43M8"
          onChange={(field) => onUpdate({ batchCode: field })}
        />
        <div className="field">
          <div className="field__label">Expected bag count</div>
          <input
            type="number"
            value={expected || ''}
            readOnly
            disabled
            placeholder="—"
            style={{ background: 'var(--surface-tint)', cursor: 'not-allowed' }}
          />
          <div className="field__hint">
            {section.batchCode.value
              ? `From picklist line for ${section.batchCode.value}`
              : 'Enter batch code first'}
          </div>
        </div>
        <SuggestableField
          label="Actual bag count (confirm)"
          field={section.actualBagCount}
          type="number"
          placeholder={remainingAvailable !== null ? String(remainingAvailable) : '0'}
          onChange={(field) => onUpdate({ actualBagCount: field })}
        />
      </div>

      {remainingAvailable !== null && remainingAvailable > 0 && (
        <div className="small soft mt-8">
          {remainingAvailable} bags remaining on picklist for this batch (already scanned on other pallets)
        </div>
      )}

      {mismatch && (
        <div className="banner banner--warn" style={{ marginTop: 8, marginBottom: 0 }}>
          <span className="banner__icon">⚠</span>
          <div className="banner__body">
            Count mismatch: expected <strong>{expected}</strong>, you entered <strong>{actual}</strong>
            {actual !== null && expected !== 0 && (
              <> (difference {(actual - expected) > 0 ? '+' : ''}{actual - expected})</>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
