import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { dbGetInspection, dbSavePhotoBlob, dbSaveInspection } from '../services/db';
import { useCameraCapture } from '../hooks/useCameraCapture';
import { analyzePhoto } from '../services/ml';
import { checkImageQuality, type QualityIssue } from '../services/imageQuality';
import { ImageQualityModal } from '../components/ImageQualityModal';
import type { Inspection, InspectionPhoto, Suggestable } from '../types/inspection';

export function CaptureReturnsBOLRoute() {
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
    await processReturnsBOL(blob, false);
  });

  async function processReturnsBOL(blob: Blob, wasFlagged: boolean) {
    if (!inspection) return;

    const bitmap = await createImageBitmap(blob);
    const photo: InspectionPhoto = {
      id: crypto.randomUUID(),
      capturedAt: new Date().toISOString(),
      capturedBy: inspection.startedBy || 'unknown',
      category: 'Returns_BOL',
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
        category: 'Returns_BOL',
        photoId: photo.id,
        inspectionId: inspection.id,
      });
      photo.mlResults = mlResults;

      const fields = mlResults.returnsBolFields;
      // Use non-null assertion or default fallback since we added it to emptyInspection
      const currentReturnsBol = inspection.returnsBol || {
        photoIds: [],
        bolNumber: { value: null, source: 'empty' },
        receivedDate: { value: null, source: 'empty' },
        expectedPallets54x40: { value: null, source: 'empty' },
        expectedEmptySeedPaks: { value: null, source: 'empty' },
        expectedPallets40x40: { value: null, source: 'empty' },
        expectedProductSeedPaks: { value: null, source: 'empty' },
        expectedBaggedProduct: { value: null, source: 'empty' },
      };
      
      const updatedReturnsBol = { ...currentReturnsBol };
      updatedReturnsBol.photoIds = [...(updatedReturnsBol.photoIds || []), photo.id];

      if (fields) {
        if (fields.bolNumber) {
          updatedReturnsBol.bolNumber = {
            value: fields.bolNumber,
            source: 'manual', // start as manual so user can override, or ml-accepted if we auto-trust
            mlSuggestion: fields.bolNumber,
            mlConfidence: fields.confidence,
          } as Suggestable<string>;
        }
        if (fields.receivedDate) {
          updatedReturnsBol.receivedDate = {
            value: fields.receivedDate,
            source: 'manual',
            mlSuggestion: fields.receivedDate,
            mlConfidence: fields.confidence,
          } as Suggestable<string>;
        }
        if (fields.expectedPallets54x40 !== undefined) {
          updatedReturnsBol.expectedPallets54x40 = {
            value: fields.expectedPallets54x40,
            source: 'manual',
            mlSuggestion: fields.expectedPallets54x40,
            mlConfidence: fields.confidence,
          } as Suggestable<number>;
        }
        if (fields.expectedEmptySeedPaks !== undefined) {
          updatedReturnsBol.expectedEmptySeedPaks = {
            value: fields.expectedEmptySeedPaks,
            source: 'manual',
            mlSuggestion: fields.expectedEmptySeedPaks,
            mlConfidence: fields.confidence,
          } as Suggestable<number>;
        }
        if (fields.expectedPallets40x40 !== undefined) {
          updatedReturnsBol.expectedPallets40x40 = {
            value: fields.expectedPallets40x40,
            source: 'manual',
            mlSuggestion: fields.expectedPallets40x40,
            mlConfidence: fields.confidence,
          } as Suggestable<number>;
        }
        if (fields.expectedProductSeedPaks !== undefined) {
          updatedReturnsBol.expectedProductSeedPaks = {
            value: fields.expectedProductSeedPaks,
            source: 'manual',
            mlSuggestion: fields.expectedProductSeedPaks,
            mlConfidence: fields.confidence,
          } as Suggestable<number>;
        }
        if (fields.expectedBaggedProduct !== undefined) {
          updatedReturnsBol.expectedBaggedProduct = {
            value: fields.expectedBaggedProduct,
            source: 'manual',
            mlSuggestion: fields.expectedBaggedProduct,
            mlConfidence: fields.confidence,
          } as Suggestable<number>;
        }
      }

      const updated: Inspection = {
        ...inspection,
        returnsBol: updatedReturnsBol,
        lastEditedAt: new Date().toISOString(),
      };
      await dbSaveInspection(updated);
      // Next step: Verify the extracted BOL data
      navigate(`/inspection/${inspection.id}/verify-returns`);
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
    await processReturnsBOL(blob, true);
  };

  const skipToVerify = async () => {
    if (!inspection) return;
    navigate(`/inspection/${inspection.id}/verify-returns`);
  };

  if (!inspection) return null;

  return (
    <main style={{ maxWidth: 560 }}>
      <div className="page-head">
        <div>
          <h1 className="page-head__title">
            Capture <em>Returns BOL</em>
          </h1>
          <div className="page-head__sub">
            Step 2 of 4 · Photograph the Returns BOL & Packing List
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
          {analyzing ? 'Analyzing Returns BOL…' : 'No photo yet'}
        </div>
      </div>

      <div className="banner banner--info">
        <span className="banner__icon">i</span>
        <div className="banner__body">
          Photograph the Returns BOL. The AI will automatically extract the expected quantities
          for pallets, empty SeedPaks, lids, and product bags.
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
          Skip — enter data manually
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
