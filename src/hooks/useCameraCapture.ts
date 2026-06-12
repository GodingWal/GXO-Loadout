import { useCallback, useRef } from 'react';
import {
  readExifOrientation,
  setOrientationTransform,
  uprightSizeForOrientation,
} from '../services/exifOrientation.ts';

/**
 * Cross-device photo capture.
 *
 * Uses native <input type="file" capture="environment">. Works on:
 *   - iPad Safari: opens rear camera directly
 *   - Android Chrome: prompts camera vs gallery
 *   - Desktop: opens file picker
 *
 * Photos are downscaled to ~1600px on longest edge AND normalized to
 * upright pixel orientation (any EXIF rotation is baked into the pixel
 * buffer; the output JPEG has no orientation tag). This guarantees a
 * single coordinate space across display, OCR, and labeling — without
 * it, iPad photos store rotated raw pixels but display upright, and
 * every bounding box drawn on the display would map to the wrong region
 * when cropped from the stored bytes. Original (camera-resolution,
 * EXIF-intact) blob is also passed to the caller so the raw bytes can
 * still be archived for re-export.
 */
export function useCameraCapture(onCapture: (blob: Blob, originalBlob: Blob) => void) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  const ensureInput = useCallback(() => {
    if (inputRef.current) return inputRef.current;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.setAttribute('capture', 'environment');
    input.style.display = 'none';
    input.addEventListener('change', async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const downscaled = await downscaleAndNormalize(file, 1600);
      onCapture(downscaled, file);
      (e.target as HTMLInputElement).value = '';
    });
    document.body.appendChild(input);
    inputRef.current = input;
    return input;
  }, [onCapture]);

  return useCallback(() => {
    ensureInput().click();
  }, [ensureInput]);
}

async function downscaleAndNormalize(file: File, maxEdge: number): Promise<Blob> {
  // 1. Read EXIF orientation BEFORE decoding so we know whether axes swap.
  const orientation = await readExifOrientation(file);

  // 2. Decode raw pixels. `imageOrientation: 'none'` forces every browser
  //    to give us the un-rotated pixel buffer; without it Chrome/Firefox
  //    would pre-apply EXIF and our explicit transform would double-rotate.
  //    Safari 14+ honors this option.
  const bitmap = await createImageBitmap(file, { imageOrientation: 'none' });

  // 3. Compute the upright dimensions, then the downscaled output size.
  const upright = uprightSizeForOrientation(orientation, bitmap.width, bitmap.height);
  const scale = Math.min(1, maxEdge / Math.max(upright.w, upright.h));
  const outW = Math.round(upright.w * scale);
  const outH = Math.round(upright.h * scale);

  // 4. Draw bitmap into canvas with the orientation transform AND scale
  //    applied in a single matrix. Output canvas dimensions are the
  //    physically upright dimensions; output bytes have no EXIF tag.
  const canvas = document.createElement('canvas');
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext('2d')!;
  setOrientationTransform(ctx, orientation, bitmap.width, bitmap.height, outW, outH);
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close?.();

  return new Promise<Blob>((resolve) =>
    canvas.toBlob((b) => resolve(b!), 'image/jpeg', 0.85)
  );
}
