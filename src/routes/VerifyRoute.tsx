import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { dbGetInspection } from '../services/db';
import { useInspection } from '../hooks/useInspection';
import type { Inspection, Suggestable, PicklistLineItemEntry } from '../types/inspection';
import { emptySuggestable } from '../types/inspection';
import { SuggestableField } from '../components/SuggestableField';

export function VerifyRoute() {
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

  return <VerifyInner initial={loaded} onVerified={() => navigate(`/inspection/${id}`)} />;
}

function VerifyInner({
  initial,
  onVerified,
}: {
  initial: Inspection;
  onVerified: () => void;
}) {
  const { inspection, dispatch } = useInspection(initial);

  const confirm = () => {
    dispatch({ type: 'VERIFY_PICKLIST', verifiedBy: inspection.startedBy || 'unknown' });
    onVerified();
  };

  const addLine = () => {
    const firstDelivery = inspection.bol.deliveries[0];
    dispatch({
      type: 'ADD_PICKLIST_LINE',
      line: {
        id: crypto.randomUUID(),
        batchCode: emptySuggestable(),
        productName: emptySuggestable(),
        expectedQuantity: emptySuggestable(),
        uom: 'BAG',
        deliveryId: firstDelivery?.id,
        actualQuantity: 0,
        fulfilled: false,
      },
    });
  };

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
    if (!window.confirm('Remove this delivery? Any line items assigned to it will need reassignment.')) return;
    dispatch({ type: 'REMOVE_DELIVERY', id: deliveryId });
  };

  // Cross-reference: load numbers should match between picklist and BOL
  const picklistLoad = inspection.picklist.loadNumber.value;
  const bolLoad = inspection.bol.loadNumber.value;
  const loadMismatch = picklistLoad && bolLoad && picklistLoad !== bolLoad;
  const sharedLoadNumber = bolLoad || picklistLoad;

  const canConfirm =
    sharedLoadNumber &&
    inspection.picklist.lineItems.length > 0 &&
    inspection.bol.deliveries.length > 0 &&
    inspection.picklist.lineItems.every(
      (li) => li.batchCode.value && (li.expectedQuantity.value ?? 0) > 0
    );

  return (
    <main>
      <div className="page-head">
        <div>
          <h1 className="page-head__title">
            Verify <em>load data</em>
          </h1>
          <div className="page-head__sub">
            Step 4 of 4 · Confirm AI-extracted data and reconcile picklist vs BOL
          </div>
        </div>
      </div>

      <div className="banner banner--warn">
        <span className="banner__icon">⚠</span>
        <div className="banner__body">
          Verify each row carefully. <strong>Mistakes here affect the whole inspection.</strong>{' '}
          Bag counts and batch codes drive every per-pallet check.
        </div>
      </div>

      {loadMismatch && (
        <div className="banner banner--danger">
          <span className="banner__icon">✕</span>
          <div className="banner__body">
            <strong>Load # mismatch.</strong> Picklist says <span className="mono">{picklistLoad}</span>,
            BOL says <span className="mono">{bolLoad}</span>. These should be the same — pick the correct one.
          </div>
        </div>
      )}

      {/* ===== Load header ===== */}
      <section className="section">
        <div className="section__head">
          <h2 className="section__title">Load <em>header</em></h2>
        </div>
        <div className="field-row">
          <SuggestableField
            label="Load # (matches BOL #)"
            field={inspection.picklist.loadNumber}
            mono
            placeholder="835554312"
            onChange={(field) => {
              dispatch({ type: 'SET_PICKLIST', patch: { loadNumber: field } });
              // Mirror to BOL since they're the same number
              dispatch({ type: 'SET_BOL', patch: { loadNumber: field } });
            }}
          />
          <ShipDateField
            field={inspection.picklist.shipDate}
            onChange={(field) => {
              dispatch({ type: 'SET_PICKLIST', patch: { shipDate: field } });
              dispatch({ type: 'SET_BOL', patch: { shipDate: field } });
            }}
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

        <div className="banner banner--info">
          <span className="banner__icon">i</span>
          <div className="banner__body">
            {inspection.type === 'returns'
              ? 'One Load can have multiple Delivery #s. Each line item below is assigned to a specific delivery.'
              : 'One Load can have multiple Delivery #s (for one or many stops). Each line item below is assigned to a specific delivery.'}
          </div>
        </div>

        {inspection.bol.deliveries.length === 0 ? (
          <div className="empty">
            <div className="empty__title">No deliveries yet</div>
            <div className="empty__sub">Tap "+ Add delivery" to enter at least one.</div>
          </div>
        ) : (
          <div className="delivery-list">
            {inspection.bol.deliveries.map((d) => (
              <div key={d.id} className="card">
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
                  {inspection.type !== 'returns' && (
                    <div className="field">
                      <div className="field__label">Stop #</div>
                      <input
                        type="number"
                        value={d.stopNumber ?? ''}
                        onChange={(e) =>
                          dispatch({
                            type: 'UPDATE_DELIVERY',
                            id: d.id,
                            patch: {
                              stopNumber: e.target.value === '' ? undefined : Number(e.target.value),
                            },
                          })
                        }
                        placeholder="1"
                      />
                    </div>
                  )}
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

      {/* ===== Line items ===== */}
      <section className="section">
        <div className="section__head">
          <h2 className="section__title">
            Line <em>items</em>
          </h2>
          <span className="section__meta">
            {inspection.picklist.lineItems.length} detected
          </span>
        </div>

        {inspection.picklist.lineItems.length === 0 ? (
          <div className="empty">
            <div className="empty__title">No line items detected</div>
            <div className="empty__sub">Add them manually using the button below.</div>
          </div>
        ) : (
          inspection.picklist.lineItems.map((li, idx) => (
            <LineItemRow
              key={li.id}
              li={li}
              deliveries={inspection.bol.deliveries}
              onUpdate={(patch) =>
                dispatch({ type: 'UPDATE_PICKLIST_LINE', index: idx, patch })
              }
              onRemove={() => dispatch({ type: 'REMOVE_PICKLIST_LINE', index: idx })}
            />
          ))
        )}

        <button
          className="btn"
          onClick={addLine}
          style={{ width: '100%', borderStyle: 'dashed', marginTop: 8 }}
          disabled={inspection.bol.deliveries.length === 0}
          title={inspection.bol.deliveries.length === 0 ? 'Add a delivery first' : ''}
        >
          + Add line item manually
        </button>
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
  // Use HTML5 date picker - works well on iPad (native picker UI)
  return (
    <div className="field">
      <div className="field__label">Ship date</div>
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

function LineItemRow({
  li,
  deliveries,
  onUpdate,
  onRemove,
}: {
  li: PicklistLineItemEntry;
  deliveries: { id: string; deliveryNumber: string }[];
  onUpdate: (patch: Partial<PicklistLineItemEntry>) => void;
  onRemove: () => void;
}) {
  const lowConf = li.batchCode.mlConfidence !== undefined && li.batchCode.mlConfidence < 0.85;

  return (
    <div className="card" style={lowConf ? { borderLeft: '3px solid var(--warn)' } : {}}>
      <div className="field-row" style={{ marginBottom: 8 }}>
        <SuggestableField
          label="Batch code"
          field={li.batchCode}
          mono
          placeholder="P18GY43M8"
          onChange={(field) => onUpdate({ batchCode: field })}
        />
        <SuggestableField
          label="Quantity"
          field={li.expectedQuantity}
          type="number"
          placeholder="40"
          onChange={(field) => onUpdate({ expectedQuantity: field })}
        />
        <div className="field">
          <div className="field__label">UOM</div>
          <select
            value={li.uom}
            onChange={(e) => onUpdate({ uom: e.target.value as 'BAG' | 'SP' | 'PCE' })}
          >
            <option value="BAG">BAG</option>
            <option value="SP">SP</option>
            <option value="PCE">PCE</option>
          </select>
        </div>
        <div className="field">
          <div className="field__label">Delivery</div>
          <select
            value={li.deliveryId || ''}
            onChange={(e) => onUpdate({ deliveryId: e.target.value || undefined })}
          >
            <option value="">—</option>
            {deliveries.map((d) => (
              <option key={d.id} value={d.id}>{d.deliveryNumber}</option>
            ))}
          </select>
        </div>
      </div>
      <SuggestableField
        label="Product (optional)"
        field={li.productName}
        placeholder="Field Corn 201-40VT4PRIB"
        onChange={(field) => onUpdate({ productName: field })}
      />
      {lowConf && (
        <div className="small" style={{ color: 'var(--warn)', marginTop: 6 }}>
          ⚠ AI low confidence ({Math.round((li.batchCode.mlConfidence || 0) * 100)}%) — verify this
        </div>
      )}
      <div className="row-between mt-8">
        <span className="xs faint">Line item</span>
        <button className="btn btn--sm btn--ghost" onClick={onRemove}>
          Remove
        </button>
      </div>
    </div>
  );
}
