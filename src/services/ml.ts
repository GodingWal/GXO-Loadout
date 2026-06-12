// GXO Loadout — NVIDIA Cosmos API ML integration service.
// This replaces browser-side Tesseract.js client OCR and mocks with
// GPU-accelerated edge inference on the Jetson Orin server.

import type { PhotoMLResults, PhotoCategory } from '../types/inspection';

export interface MLAnalysisRequest {
  photoBlob: Blob;
  category: PhotoCategory;
  expectedBagCount?: number;
  expectedBatches?: string[];
  photoId?: string;
  inspectionId?: string;
}

/**
 * Preload the model. Since models run on the Jetson Orin edge server,
 * client-side preloading is a no-op.
 */
export async function preloadOCR(): Promise<void> {
  return Promise.resolve();
}

/**
 * Send the photographed asset to the Jetson Orin server for NVIDIA Cosmos VLM analysis.
 */
export async function analyzePhoto(req: MLAnalysisRequest): Promise<PhotoMLResults> {
  const now = new Date().toISOString();
  
  try {
    const formData = new FormData();
    formData.append('file', req.photoBlob, 'photo.jpg');
    formData.append('category', req.category);
    
    if (req.expectedBatches && req.expectedBatches.length > 0) {
      formData.append('expectedBatches', JSON.stringify(req.expectedBatches));
    }
    if (req.expectedBagCount !== undefined) {
      formData.append('expectedBagCount', String(req.expectedBagCount));
    }
    if (req.photoId) {
      formData.append('photoId', req.photoId);
    }
    if (req.inspectionId) {
      formData.append('inspectionId', req.inspectionId);
    }

    const response = await fetch('/api/analyze', {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      throw new Error(`Edge server returned status ${response.status}: ${await response.text()}`);
    }

    const result = await response.json();
    return result;
  } catch (err) {
    console.error('[loadout-ml] Edge server inference failed:', err);
    return {
      analyzedAt: now,
      errors: [`edge_inference_failed: ${err instanceof Error ? err.message : String(err)}`],
    };
  }
}

// Cross-reference helper for picklist vs BOL
export function crossReferencePicklistBOL(picklist: any, bol: any) {
  const picklistLoad = picklist?.loadNumber?.value;
  const bolLoad = bol?.loadNumber?.value;
  const picklistDate = picklist?.shipDate?.value;
  const bolDate = bol?.shipDate?.value;

  const discrepancies: any[] = [];

  // Aggregate picklist line items by batch code
  const picklistByBatch: Record<string, number> = {};
  for (const li of picklist?.lineItems || []) {
    const batch = li.batchCode?.value;
    if (batch) {
      picklistByBatch[batch] = (picklistByBatch[batch] || 0) + (li.expectedQuantity?.value || 0);
    }
  }

  return {
    loadNumberMatches: picklistLoad === bolLoad,
    shipDateMatches: picklistDate === bolDate,
    lineItemDiscrepancies: discrepancies,
    computedAt: new Date().toISOString(),
  };
}
