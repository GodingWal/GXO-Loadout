import { useState } from 'react';
import type {
  InspectionPhoto,
  PhotoCategory,
  PhotoMLResults,
  PhotoMetadata,
  QualityFlag,
  MLTrainingFlag,
} from '../types/inspection';
import { useCameraCapture } from '../hooks/useCameraCapture';
import { analyzePhoto } from '../services/ml';
import { dbSavePhotoBlob } from '../services/db';
import { checkImageQuality, type QualityIssue } from '../services/imageQuality';
import { QualityFlagButton } from './QualityFlagButton';
import { MLTrainingFlagButton } from './MLTrainingFlagButton';
import { ImageQualityModal } from './ImageQualityModal';
import { OCRDebugPanel } from './OCRDebugPanel';

// ---- Pending capture (image quality review) ----

interface PendingCapture {
  blob: Blob;
  previewUrl: string;
  issues: QualityIssue[];
  metrics: { blurScore: number; meanBrightness: number; stdDevBrightness: number };
}

// =============================================================
// SlotPhotoCapture - single fixed slot for pallet sides, bag flaps, etc.
// =============================================================

interface SlotPhotoCaptureProps {
  inspectionId: string;
  category: PhotoCategory;
  slotKey: string;
  slotLabel: string;
  palletIndex?: number;
  existingPhoto?: InspectionPhoto;
  onCaptured: (photo: InspectionPhoto) => void;
  onMLComplete: (photoId: string, results: PhotoMLResults) => void;
  onQualityFlag: (photoId: string, flag?: QualityFlag) => void;
  onMLFlag: (photoId: string, flag?: MLTrainingFlag) => void;
  currentUser: string;
  // Optional: for bag flap / LPN photos, the batches we expect on this pallet.
  // Used by OCR for format-aware matching.
  expectedBatches?: string[];
}

export function SlotPhotoCapture({
  inspectionId,
  category,
  slotKey,
  slotLabel,
  palletIndex,
  existingPhoto,
  onCaptured,
  onMLComplete,
  onQualityFlag,
  onMLFlag,
  currentUser,
  expectedBatches,
}: SlotPhotoCaptureProps) {
  const [analyzing, setAnalyzing] = useState(false);
  const [pending, setPending] = useState<PendingCapture | null>(null);

  const capture = useCameraCapture(async (blob) => {
    const quality = await checkImageQuality(blob);
    if (!quality.passed) {
      const previewUrl = URL.createObjectURL(blob);
      setPending({
        blob,
        previewUrl,
        issues: quality.issues,
        metrics: quality.metrics,
      });
      return;
    }
    await processCapture(blob, false);
  });

  async function processCapture(blob: Blob, wasFlaggedForQuality: boolean) {
    const bitmap = await createImageBitmap(blob);
    const metadata: PhotoMetadata = {
      deviceModel: navigator.userAgent.includes('iPad') ? 'iPad' : 'web',
      orientation: bitmap.width > bitmap.height ? 'landscape' : 'portrait',
      originalWidth: bitmap.width,
      originalHeight: bitmap.height,
      fileSizeBytes: blob.size,
    };

    const photo: InspectionPhoto = {
      id: crypto.randomUUID(),
      capturedAt: new Date().toISOString(),
      capturedBy: currentUser || 'unknown',
      category,
      palletIndex,
      slotKey,
      localBlobUrl: URL.createObjectURL(blob),
      metadata,
    };

    // If quality check failed and inspector kept the photo, auto-flag for ML training
    if (wasFlaggedForQuality) {
      photo.mlTrainingFlag = {
        flaggedAt: new Date().toISOString(),
        flaggedBy: currentUser || 'unknown',
        hint: 'unusual_lighting',
        notes: 'Auto-flagged: failed in-browser quality check',
      };
    }

    await dbSavePhotoBlob(photo.id, inspectionId, blob);
    onCaptured(photo);

    setAnalyzing(true);
    try {
      const mlResults = await analyzePhoto({
        photoBlob: blob,
        category,
        expectedBatches,
        photoId: photo.id,
        inspectionId,
      });
      onMLComplete(photo.id, mlResults);
    } catch (err) {
      onMLComplete(photo.id, {
        errors: [err instanceof Error ? err.message : String(err)],
        analyzedAt: new Date().toISOString(),
      });
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
    await processCapture(blob, true);
  };

  if (!existingPhoto) {
    return (
      <>
        <button
          className="photo-slot photo-slot--empty"
          onClick={capture}
          type="button"
        >
          <div className="photo-slot__icon">📷</div>
          <div className="photo-slot__label">{slotLabel}</div>
          <div className="photo-slot__hint">Tap to capture</div>
        </button>
        {pending && (
          <ImageQualityModal
            previewUrl={pending.previewUrl}
            issues={pending.issues}
            onRetake={handleRetake}
            onKeep={handleKeep}
          />
        )}
      </>
    );
  }

  const ml = existingPhoto.mlResults;
  const tileClass = [
    'photo-slot',
    'photo-slot--filled',
    existingPhoto.qualityFlag ? 'photo-slot--quality-flagged' : '',
    existingPhoto.mlTrainingFlag ? 'photo-slot--ml-flagged' : '',
  ].filter(Boolean).join(' ');

  return (
    <>
      <div className={tileClass} onClick={capture}>
        <img
          src={existingPhoto.localBlobUrl || existingPhoto.sharePointUrl}
          alt={slotLabel}
        />

        <MLTrainingFlagButton
          flag={existingPhoto.mlTrainingFlag}
          onFlag={(f) => onMLFlag(existingPhoto.id, f)}
          onUnflag={() => onMLFlag(existingPhoto.id, undefined)}
          currentUser={currentUser}
        />

        <QualityFlagButton
          flag={existingPhoto.qualityFlag}
          level="photo"
          onFlag={(f) => onQualityFlag(existingPhoto.id, f)}
          onUnflag={() => onQualityFlag(existingPhoto.id, undefined)}
          currentUser={currentUser}
        />

        <div className="photo-slot__label-overlay">{slotLabel}</div>

        {analyzing && (
          <div className="photo-slot__badge photo-slot__badge--working">analyzing…</div>
        )}
        {!analyzing && ml?.detectedBatchCode && (
          <div className="photo-slot__badge">{ml.detectedBatchCode}</div>
        )}
        {!analyzing && ml?.bagCount !== undefined && (
          <div className="photo-slot__badge">{ml.bagCount} bags</div>
        )}
        {!analyzing && ml?.detectedStopNumber !== undefined && (
          <div className="photo-slot__badge">Stop {ml.detectedStopNumber}</div>
        )}
      </div>
      <OCRDebugPanel mlResults={existingPhoto.mlResults} expectedBatches={expectedBatches} />
      {pending && (
        <ImageQualityModal
          previewUrl={pending.previewUrl}
          issues={pending.issues}
          onRetake={handleRetake}
          onKeep={handleKeep}
        />
      )}
    </>
  );
}

// =============================================================
// MultiPhotoCapture - for ad-hoc photo lists like staging-area overview
// =============================================================

interface MultiCaptureProps {
  inspectionId: string;
  category: PhotoCategory;
  existingPhotos: InspectionPhoto[];
  onPhotoAdded: (photo: InspectionPhoto) => void;
  onMLComplete: (photoId: string, results: PhotoMLResults) => void;
  onPhotoQualityFlag: (photoId: string, flag?: QualityFlag) => void;
  onPhotoMLFlag: (photoId: string, flag?: MLTrainingFlag) => void;
  label: string;
  currentUser: string;
}

export function MultiPhotoCapture({
  inspectionId,
  category,
  existingPhotos,
  onPhotoAdded,
  onMLComplete,
  onPhotoQualityFlag,
  onPhotoMLFlag,
  label,
  currentUser,
}: MultiCaptureProps) {
  const [analyzing, setAnalyzing] = useState<Record<string, boolean>>({});
  const [pending, setPending] = useState<PendingCapture | null>(null);

  const capture = useCameraCapture(async (blob) => {
    const quality = await checkImageQuality(blob);
    if (!quality.passed) {
      const previewUrl = URL.createObjectURL(blob);
      setPending({
        blob,
        previewUrl,
        issues: quality.issues,
        metrics: quality.metrics,
      });
      return;
    }
    await processCapture(blob, false);
  });

  async function processCapture(blob: Blob, wasFlaggedForQuality: boolean) {
    const bitmap = await createImageBitmap(blob);
    const metadata: PhotoMetadata = {
      deviceModel: navigator.userAgent.includes('iPad') ? 'iPad' : 'web',
      orientation: bitmap.width > bitmap.height ? 'landscape' : 'portrait',
      originalWidth: bitmap.width,
      originalHeight: bitmap.height,
      fileSizeBytes: blob.size,
    };

    const photo: InspectionPhoto = {
      id: crypto.randomUUID(),
      capturedAt: new Date().toISOString(),
      capturedBy: currentUser || 'unknown',
      category,
      localBlobUrl: URL.createObjectURL(blob),
      metadata,
    };

    if (wasFlaggedForQuality) {
      photo.mlTrainingFlag = {
        flaggedAt: new Date().toISOString(),
        flaggedBy: currentUser || 'unknown',
        hint: 'unusual_lighting',
        notes: 'Auto-flagged: failed in-browser quality check',
      };
    }

    await dbSavePhotoBlob(photo.id, inspectionId, blob);
    onPhotoAdded(photo);

    setAnalyzing((s) => ({ ...s, [photo.id]: true }));
    try {
      const mlResults = await analyzePhoto({
        photoBlob: blob,
        category,
        photoId: photo.id,
        inspectionId,
      });
      onMLComplete(photo.id, mlResults);
    } catch (err) {
      onMLComplete(photo.id, {
        errors: [err instanceof Error ? err.message : String(err)],
        analyzedAt: new Date().toISOString(),
      });
    } finally {
      setAnalyzing((s) => {
        const next = { ...s };
        delete next[photo.id];
        return next;
      });
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
    await processCapture(blob, true);
  };

  return (
    <>
      <div className="field">
        <div className="row-between mb-8">
          <div className="field__label" style={{ margin: 0 }}>{label}</div>
          <button className="btn btn--sm btn--accent" onClick={capture}>
            + Photo
          </button>
        </div>
        {existingPhotos.length > 0 && (
          <div className="photo-grid">
            {existingPhotos.map((p) => (
              <div
                key={p.id}
                className={[
                  'photo-tile',
                  p.qualityFlag ? 'photo-tile--quality-flagged' : '',
                  p.mlTrainingFlag ? 'photo-tile--ml-flagged' : '',
                ].filter(Boolean).join(' ')}
              >
                <img src={p.localBlobUrl || p.sharePointUrl} alt={p.category} />
                <MLTrainingFlagButton
                  flag={p.mlTrainingFlag}
                  onFlag={(f) => onPhotoMLFlag(p.id, f)}
                  onUnflag={() => onPhotoMLFlag(p.id, undefined)}
                  currentUser={currentUser}
                />
                <QualityFlagButton
                  flag={p.qualityFlag}
                  level="photo"
                  onFlag={(f) => onPhotoQualityFlag(p.id, f)}
                  onUnflag={() => onPhotoQualityFlag(p.id, undefined)}
                  currentUser={currentUser}
                />
                {analyzing[p.id] && (
                  <div className="photo-tile__badge photo-tile__badge--working">analyzing…</div>
                )}
              </div>
            ))}
          </div>
        )}
        {/* OCR debug panels for each photo (only renders when ?ocrdebug is on) */}
        {existingPhotos.map((p) => (
          <OCRDebugPanel key={`dbg-${p.id}`} mlResults={p.mlResults} />
        ))}
      </div>
      {pending && (
        <ImageQualityModal
          previewUrl={pending.previewUrl}
          issues={pending.issues}
          onRetake={handleRetake}
          onKeep={handleKeep}
        />
      )}
    </>
  );
}
