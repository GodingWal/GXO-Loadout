import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { dbGetInspection, dbSavePhotoBlob, dbSaveInspection } from '../services/db';
import { useCameraCapture } from '../hooks/useCameraCapture';
import { analyzePhoto } from '../services/ml';
import { checkImageQuality, type QualityIssue } from '../services/imageQuality';
import { ImageQualityModal } from '../components/ImageQualityModal';
import type { Inspection, InspectionPhoto, Suggestable } from '../types/inspection';

export function CapturePicklistRoute() {
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
    await processPicklist(blob, false);
  });

  async function processPicklist(blob: Blob, wasFlagged: boolean) {
    if (!inspection) return;

    const bitmap = await createImageBitmap(blob);
    const photo: InspectionPhoto = {
      id: crypto.randomUUID(),
      capturedAt: new Date().toISOString(),
      capturedBy: inspection.startedBy || 'unknown',
      category: 'Picklist',
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
        category: 'Picklist',
        photoId: photo.id,
        inspectionId: inspection.id,
      });
      photo.mlResults = mlResults;

      const fields = mlResults.picklistFields;
      const updatedPicklist = { ...inspection.picklist };
      updatedPicklist.photoIds = [...updatedPicklist.photoIds, photo.id];

      if (fields) {
        if (fields.loadNumber && !inspection.picklist.loadNumber.value) {
          updatedPicklist.loadNumber = {
            value: fields.loadNumber,
            source: 'manual',
            mlSuggestion: fields.loadNumber,
            mlConfidence: fields.confidence,
          } as Suggestable<string>;
        }
        if (fields.shipDate && !inspection.picklist.shipDate.value) {
          updatedPicklist.shipDate = {
            value: fields.shipDate,
            source: 'manual',
            mlSuggestion: fields.shipDate,
            mlConfidence: fields.confidence,
          } as Suggestable<string>;
        }
        if (fields.lineItems && fields.lineItems.length > 0) {
          // Try to map each line item to a delivery based on deliveryNumber
          const deliveryByNumber: Record<string, string> = {};
          for (const d of inspection.bol.deliveries) {
            deliveryByNumber[d.deliveryNumber] = d.id;
          }
          updatedPicklist.lineItems = fields.lineItems.map((li) => ({
            id: crypto.randomUUID(),
            batchCode: {
              value: li.batchCode || null,
              source: 'manual',
              mlSuggestion: li.batchCode,
              mlConfidence: li.confidence,
            } as Suggestable<string>,
            productName: {
              value: li.productName || null,
              source: 'manual',
              mlSuggestion: li.productName,
            } as Suggestable<string>,
            expectedQuantity: {
              value: li.expectedQuantity ?? null,
              source: 'manual',
              mlSuggestion: li.expectedQuantity,
            } as Suggestable<number>,
            uom: (li.uom || 'BAG') as 'BAG' | 'SP' | 'PCE',
            deliveryId: li.deliveryNumber
              ? deliveryByNumber[li.deliveryNumber]
              : undefined,
            actualQuantity: 0,
            fulfilled: false,
          }));
        }
      }

      const updated: Inspection = {
        ...inspection,
        picklist: updatedPicklist,
        lastEditedAt: new Date().toISOString(),
      };
      await dbSaveInspection(updated);
      navigate(`/inspection/${inspection.id}/verify`);
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
    await processPicklist(blob, true);
  };

  const skipToVerify = async () => {
    if (!inspection) return;
    navigate(`/inspection/${inspection.id}/verify`);
  };

  if (!inspection) return null;

  return (
    <main style={{ maxWidth: 560 }}>
      <div className="page-head">
        <div>
          <h1 className="page-head__title">
            Capture <em>picklist</em>
          </h1>
          <div className="page-head__sub">
            Step 3 of 4 · Photograph the printed picklist
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
          {analyzing ? 'Analyzing picklist…' : 'No photo yet'}
        </div>
      </div>

      <div className="banner banner--info">
        <span className="banner__icon">i</span>
        <div className="banner__body">
          Photograph the printed picklist. AI extracts line items and matches them to the
          deliveries from the BOL.
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
        <button className="btn btn--ghost" onClick={skipToVerify}>
          Skip — enter picklist manually
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
