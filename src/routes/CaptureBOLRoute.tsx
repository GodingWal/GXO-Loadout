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

      const fields = mlResults.bolFields;
      const updatedBOL = { ...inspection.bol };
      updatedBOL.photoIds = [...updatedBOL.photoIds, photo.id];

      if (fields) {
        if (fields.loadNumber) {
          updatedBOL.loadNumber = {
            value: fields.loadNumber,
            source: 'manual',
            mlSuggestion: fields.loadNumber,
            mlConfidence: fields.confidence,
          } as Suggestable<string>;
        }
        if (fields.shipDate) {
          updatedBOL.shipDate = {
            value: fields.shipDate,
            source: 'manual',
            mlSuggestion: fields.shipDate,
            mlConfidence: fields.confidence,
          } as Suggestable<string>;
        }
        if (fields.numberOfStops !== undefined) {
          updatedBOL.numberOfStops = fields.numberOfStops;
        }
        if (fields.carrier) {
          updatedBOL.carrier = fields.carrier;
        }
        if (fields.deliveries && fields.deliveries.length > 0) {
          updatedBOL.deliveries = fields.deliveries.map((d) => ({
            id: crypto.randomUUID(),
            deliveryNumber: d.deliveryNumber || '',
            stopNumber: d.stopNumber,
            lineItemIds: [],
          })) as Delivery[];
        }
      }

      const updated: Inspection = {
        ...inspection,
        bol: updatedBOL,
        lastEditedAt: new Date().toISOString(),
      };
      await dbSaveInspection(updated);
      // BOL done, go to picklist
      navigate(`/inspection/${inspection.id}/capture-picklist`);
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
          {analyzing ? 'Analyzing BOL…' : 'No photo yet'}
        </div>
      </div>

      <div className="banner banner--info">
        <span className="banner__icon">i</span>
        <div className="banner__body">
          Photograph the BOL first — it determines how many stops and deliveries are on this
          load. AI will extract the Load #, ship date, stop count, and delivery numbers. The
          picklist comes next.
        </div>
      </div>

      <button
        className="btn btn--accent btn--lg"
        onClick={capture}
        disabled={analyzing}
        style={{ width: '100%' }}
      >
        📷 Take photo
      </button>

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
