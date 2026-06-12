import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { dbGetInspection, dbSavePhotoBlob, dbSaveInspection } from '../services/db';
import { useCameraCapture } from '../hooks/useCameraCapture';
import { analyzePhoto } from '../services/ml';
import { checkImageQuality, type QualityIssue } from '../services/imageQuality';
import { ImageQualityModal } from '../components/ImageQualityModal';
import type { Inspection, InspectionPhoto, Suggestable, Delivery } from '../types/inspection';

export function CaptureBOLRoute() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [inspection, setInspection] = useState<Inspection | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [pages, setPages] = useState<InspectionPhoto[]>([]);
  const [pending, setPending] = useState<{
    blob: Blob;
    previewUrl: string;
    issues: QualityIssue[];
  } | null>(null);

  useEffect(() => {
    if (!id) return;
    dbGetInspection(id).then((i) => {
      if (!i) navigate('/');
      else setInspection(i);
    });
  }, [id, navigate]);

  const capture = useCameraCapture(async (blob) => {
    const quality = await checkImageQuality(blob);
    if (!quality.passed) {
      const previewUrl = URL.createObjectURL(blob);
      setPending({ blob, previewUrl, issues: quality.issues });
      return;
    }
    await processBOL(blob, false);
  });

  async function processBOL(blob: Blob, wasFlagged: boolean) {
    if (!inspection) return;

    const bitmap = await createImageBitmap(blob);
    const photo: InspectionPhoto = {
      id: crypto.randomUUID(),
      capturedAt: new Date().toISOString(),
      capturedBy: inspection.startedBy || 'unknown',
      category: 'BOL',
      localBlobUrl: URL.createObjectURL(blob),
      metadata: {
        deviceModel: navigator.userAgent.includes('iPad') ? 'iPad' : 'web',
        orientation: bitmap.width > bitmap.height ? 'landscape' : 'portrait',
        originalWidth: bitmap.width,
        originalHeight: bitmap.height,
        fileSizeBytes: blob.size,
      },
    };

    if (wasFlagged) {
      photo.mlTrainingFlag = {
        flaggedAt: new Date().toISOString(),
        flaggedBy: inspection.startedBy || 'unknown',
        hint: 'unusual_lighting',
        notes: 'Auto-flagged: failed in-browser quality check',
      };
    }

    await dbSavePhotoBlob(photo.id, inspection.id, blob);

    setAnalyzing(true);
    try {
      const mlResults = await analyzePhoto({
        photoBlob: blob,
        category: 'BOL',
        photoId: photo.id,
        inspectionId: inspection.id,
      });
      photo.mlResults = mlResults;

      // Merge this page's extraction into the BOL accumulated from earlier
      // pages: header fields are kept from the first page that has them
      // (later pages of a multi-page BOL often lack the header), and
      // deliveries are merged by delivery number across pages.
      const fields = mlResults.bolFields;
      const updatedBOL = { ...inspection.bol };
      updatedBOL.photoIds = [...updatedBOL.photoIds, photo.id];

      if (fields) {
        if (fields.loadNumber && !updatedBOL.loadNumber?.value) {
          updatedBOL.loadNumber = {
            value: fields.loadNumber,
            source: 'manual',
            mlSuggestion: fields.loadNumber,
            mlConfidence: fields.confidence,
          } as Suggestable<string>;
        }
        if (fields.shipDate && !updatedBOL.shipDate?.value) {
          updatedBOL.shipDate = {
            value: fields.shipDate,
            source: 'manual',
            mlSuggestion: fields.shipDate,
            mlConfidence: fields.confidence,
          } as Suggestable<string>;
        }
        if (fields.numberOfStops !== undefined) {
          updatedBOL.numberOfStops = Math.max(updatedBOL.numberOfStops || 0, fields.numberOfStops);
        }
        if (fields.carrier && !updatedBOL.carrier) {
          updatedBOL.carrier = fields.carrier;
        }
        if (fields.deliveries && fields.deliveries.length > 0) {
          const existing: Delivery[] = updatedBOL.deliveries || [];
          const merged = [...existing];
          for (const d of fields.deliveries) {
            const num = d.deliveryNumber || '';
            const already = num && merged.find((m) => m.deliveryNumber === num);
            if (already) {
              if (already.stopNumber === undefined && d.stopNumber !== undefined) {
                already.stopNumber = d.stopNumber;
              }
            } else {
              merged.push({
                id: crypto.randomUUID(),
                deliveryNumber: num,
                stopNumber: d.stopNumber,
                lineItemIds: [],
              } as Delivery);
            }
          }
          updatedBOL.deliveries = merged;
        }
      }

      const updated: Inspection = {
        ...inspection,
        bol: updatedBOL,
        lastEditedAt: new Date().toISOString(),
      };
      await dbSaveInspection(updated);
      setInspection(updated);
      setPages((p) => [...p, photo]);
    } finally {
      setAnalyzing(false);
    }
  }

  const handleRetake = () => {
    if (pending) URL.revokeObjectURL(pending.previewUrl);
    setPending(null);
    setTimeout(() => capture(), 50);
  };

  const handleKeep = async () => {
    if (!pending) return;
    const { blob, previewUrl } = pending;
    URL.revokeObjectURL(previewUrl);
    setPending(null);
    await processBOL(blob, true);
  };

  const skipToPicklist = async () => {
    if (!inspection) return;
    navigate(`/inspection/${inspection.id}/capture-picklist`);
  };

  if (!inspection) return null;

  return (
    <main style={{ maxWidth: 560 }}>
      <div className="page-head">
        <div>
          <h1 className="page-head__title">
            Capture <em>BOL</em>
          </h1>
          <div className="page-head__sub">
            Step 2 of 4 · Photograph the Bill of Lading first
          </div>
        </div>
      </div>

      {pages.length === 0 ? (
        <div
          style={{
            aspectRatio: '4 / 3',
            background: 'var(--surface-tint)',
            border: '2px dashed var(--rule-soft)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: 20,
            padding: 24,
          }}
        >
          <div style={{ fontSize: 48, color: 'var(--ink-faint)', marginBottom: 8 }}>⌗</div>
          <div className="small soft">
            {analyzing ? 'Analyzing BOL page…' : 'No pages yet'}
          </div>
        </div>
      ) : (
        <div className="photo-grid" style={{ marginBottom: 20 }}>
          {pages.map((p, idx) => (
            <div key={p.id} className="photo-tile">
              <img src={p.localBlobUrl} alt={`BOL page ${idx + 1}`} />
              <div className="photo-slot__label-overlay">Page {idx + 1}</div>
              {p.mlResults?.source === 'mock' && (
                <div
                  className="photo-tile__badge"
                  style={{ background: 'var(--warn, #b45309)', color: '#fff' }}
                >
                  ⚠ MOCK DATA
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {pages.length > 0 && (
        <div className="banner banner--info" style={{ marginBottom: 12 }}>
          <span className="banner__icon">✓</span>
          <div className="banner__body">
            {pages.length} page{pages.length > 1 ? 's' : ''} captured ·{' '}
            {inspection.bol.deliveries?.length || 0} deliver
            {(inspection.bol.deliveries?.length || 0) === 1 ? 'y' : 'ies'} ·{' '}
            {inspection.bol.numberOfStops || 0} stop{(inspection.bol.numberOfStops || 0) === 1 ? '' : 's'}
            {inspection.bol.loadNumber?.value ? ` · Load ${inspection.bol.loadNumber.value}` : ''}
          </div>
        </div>
      )}

      <div className="banner banner--info">
        <span className="banner__icon">i</span>
        <div className="banner__body">
          Photograph every page of the BOL — it determines how many stops and deliveries are
          on this load. AI extracts the Load #, ship date, stop count, and delivery numbers
          and merges them across pages. The picklist comes next.
        </div>
      </div>

      <button
        className="btn btn--accent btn--lg"
        onClick={capture}
        disabled={analyzing}
        style={{ width: '100%' }}
      >
        {analyzing ? 'Analyzing…' : pages.length === 0 ? '📷 Take photo' : '📷 Add another page'}
      </button>

      {pages.length > 0 && (
        <button
          className="btn btn--lg mt-16"
          onClick={skipToPicklist}
          disabled={analyzing}
          style={{ width: '100%' }}
        >
          Done — continue to picklist →
        </button>
      )}

      <div className="center mt-16">
        <button className="btn btn--ghost" onClick={skipToPicklist}>
          Skip — enter BOL data manually
        </button>
      </div>

      {pending && (
        <ImageQualityModal
          previewUrl={pending.previewUrl}
          issues={pending.issues}
          onRetake={handleRetake}
          onKeep={handleKeep}
        />
      )}
    </main>
  );
}
