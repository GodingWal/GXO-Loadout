import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { dbGetInspection } from '../services/db';
import { useInspection } from '../hooks/useInspection';
import type { Inspection, Suggestable, ReturnsBOLData } from '../types/inspection';
import { SuggestableField } from '../components/SuggestableField';

export function VerifyReturnsRoute() {
  const { id } = useParams<{ id: string }>();
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

  return <VerifyReturnsInner initial={loaded} onVerified={() => navigate(`/inspection/${id}`)} />;
}

function VerifyReturnsInner({
  initial,
  onVerified,
}: {
  initial: Inspection;
  onVerified: () => void;
}) {
  const { inspection, dispatch } = useInspection(initial);
  const returnsBol = inspection.returnsBol;

  // Auto-initialize a default delivery if none exist
  useEffect(() => {
    if (inspection.bol.deliveries.length === 0) {
      dispatch({
        type: 'ADD_DELIVERY',
        delivery: {
          id: crypto.randomUUID(),
          deliveryNumber: 'D1',
          stopNumber: 1,
          lineItemIds: [],
        },
      });
    }
  }, [inspection.bol.deliveries.length, dispatch]);

  const addDelivery = () => {
    dispatch({
      type: 'ADD_DELIVERY',
      delivery: {
        id: crypto.randomUUID(),
        deliveryNumber: `D${inspection.bol.deliveries.length + 1}`,
        stopNumber: inspection.bol.deliveries.length + 1,
        lineItemIds: [],
      },
    });
  };

  const removeDelivery = (deliveryId: string) => {
    if (!window.confirm('Remove this delivery?')) return;
    dispatch({ type: 'REMOVE_DELIVERY', id: deliveryId });
  };

  if (!returnsBol) return null; // Defensive check

  const confirm = () => {
    dispatch({ type: 'VERIFY_RETURNS_BOL', verifiedBy: inspection.startedBy || 'unknown' });
    onVerified();
  };

  const updateField = (patch: Partial<ReturnsBOLData>) => {
    dispatch({ type: 'SET_RETURNS_BOL', patch });
  };

  const canConfirm = inspection.bol.deliveries.length > 0;

  return (
    <main>
      <div className="page-head">
        <div>
          <h1 className="page-head__title">
            Verify <em>returns data</em>
          </h1>
          <div className="page-head__sub">
            Step 3 of 4 · Confirm AI-extracted expected quantities
          </div>
        </div>
      </div>

      <div className="banner banner--warn">
        <span className="banner__icon">⚠</span>
        <div className="banner__body">
          Verify each quantity carefully. These numbers will be cross-referenced against your physical counts during scanning.
        </div>
      </div>

      {/* ===== Load header ===== */}
      <section className="section">
        <div className="section__head">
          <h2 className="section__title">BOL <em>details</em></h2>
        </div>
        <div className="field-row">
          <SuggestableField
            label="Returns BOL #"
            field={returnsBol.bolNumber}
            mono
            placeholder="RET-99211"
            onChange={(field) => updateField({ bolNumber: field })}
          />
          <ShipDateField
            field={returnsBol.receivedDate}
            onChange={(field) => updateField({ receivedDate: field })}
          />
        </div>
      </section>

      {/* ===== Deliveries ===== */}
      <section className="section">
        <div className="section__head">
          <h2 className="section__title">
            Deliveries <em>({inspection.bol.deliveries.length})</em>
          </h2>
          <button className="btn btn--sm" onClick={addDelivery}>
            + Add delivery
          </button>
        </div>

        {inspection.bol.deliveries.length === 0 ? (
          <div className="empty">
            <div className="empty__title">No deliveries yet</div>
            <div className="empty__sub">Tap "+ Add delivery" to enter at least one.</div>
          </div>
        ) : (
          <div className="delivery-list">
            {inspection.bol.deliveries.map((d) => (
              <div key={d.id} className="card" style={{ marginBottom: 12 }}>
                <div className="field-row">
                  <div className="field">
                    <div className="field__label">Delivery #</div>
                    <input
                      className="mono"
                      value={d.deliveryNumber}
                      onChange={(e) =>
                        dispatch({
                          type: 'UPDATE_DELIVERY',
                          id: d.id,
                          patch: { deliveryNumber: e.target.value },
                        })
                      }
                      placeholder="D1"
                    />
                  </div>
                  <div className="field" style={{ alignSelf: 'flex-end' }}>
                    <button className="btn btn--sm btn--ghost" onClick={() => removeDelivery(d.id)}>
                      Remove delivery
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ===== Expected Quantities ===== */}
      <section className="section">
        <div className="section__head">
          <h2 className="section__title">Expected <em>quantities</em></h2>
        </div>

        <div className="card">
          <div className="field-row" style={{ marginBottom: 16 }}>
            <ReturnsQtyField
              label="Wooden Pallets (54x40)"
              field={returnsBol.expectedPallets54x40}
              onChange={(field) => updateField({ expectedPallets54x40: field })}
            />
            <ReturnsQtyField
              label="Wooden Pallets (40x40)"
              field={returnsBol.expectedPallets40x40}
              onChange={(field) => updateField({ expectedPallets40x40: field })}
            />
          </div>
          
          <div className="field-row" style={{ marginBottom: 16 }}>
            <ReturnsQtyField
              label="Empty SeedPaks"
              field={returnsBol.expectedEmptySeedPaks}
              onChange={(field) => updateField({ expectedEmptySeedPaks: field })}
            />
            <ReturnsQtyField
              label="Product SeedPaks"
              field={returnsBol.expectedProductSeedPaks}
              onChange={(field) => updateField({ expectedProductSeedPaks: field })}
            />
          </div>

          <div className="field-row">
            <ReturnsQtyField
              label="Bagged Product (pallets)"
              field={returnsBol.expectedBaggedProduct}
              onChange={(field) => updateField({ expectedBaggedProduct: field })}
            />
          </div>
        </div>
      </section>

      <div className="flex gap-8" style={{ justifyContent: 'flex-end', marginTop: 24 }}>
        <button className="btn btn--ghost" onClick={() => window.history.back()}>
          ← Back
        </button>
        <button className="btn btn--accent btn--lg" onClick={confirm} disabled={!canConfirm}>
          ✓ Confirm &amp; start scanning
        </button>
      </div>
    </main>
  );
}

function ShipDateField({
  field,
  onChange,
}: {
  field: Suggestable<string>;
  onChange: (next: Suggestable<string>) => void;
}) {
  return (
    <div className="field">
      <div className="field__label">Received date</div>
      {field.mlSuggestion && field.value !== field.mlSuggestion && (
        <div className="suggestion-banner">
          <span className="suggestion-banner__text">
            AI suggests: <strong>{field.mlSuggestion}</strong>
          </span>
          <button
            className="suggestion-banner__accept"
            onClick={() =>
              onChange({
                ...field,
                value: field.mlSuggestion!,
                source: 'ml-accepted',
              })
            }
          >
            Accept
          </button>
        </div>
      )}
      <input
        type="date"
        value={field.value || ''}
        onChange={(e) =>
          onChange({
            ...field,
            value: e.target.value || null,
            source: e.target.value === field.mlSuggestion ? 'ml-accepted' : 'manual',
          })
        }
      />
    </div>
  );
}

function ReturnsQtyField({
  label,
  field,
  onChange,
}: {
  label: string;
  field: Suggestable<number>;
  onChange: (next: Suggestable<number>) => void;
}) {
  const hasSuggestion = field.mlSuggestion !== undefined && field.mlSuggestion !== null;
  const expectedStr = hasSuggestion ? String(field.mlSuggestion) : 'Unknown';

  const handleChange = (raw: string) => {
    const next: number | null = raw === '' ? null : Number(raw);
    let source: Suggestable<number>['source'] = 'manual';
    if (next === null) source = 'empty';
    else if (hasSuggestion && String(next) === String(field.mlSuggestion)) source = 'ml-accepted';
    else if (hasSuggestion) source = 'ml-edited';
    onChange({ ...field, value: next, source });
  };

  return (
    <div className="field">
      <div className="field__label">{label}</div>
      <div style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 8, fontStyle: 'italic' }}>
        Expected from BOL: {expectedStr}
      </div>
      <input
        type="number"
        value={field.value === null ? '' : String(field.value)}
        onChange={(e) => handleChange(e.target.value)}
        placeholder="0"
      />
    </div>
  );
}
