// EXIF orientation normalization for captured photos.
//
// Why this exists: iPad cameras (and most phone cameras) write JPEGs with
// the sensor's raw pixel orientation, then add an EXIF Orientation tag
// (1–8) telling viewers how to rotate the pixels for display. `<img>` and
// `background-image` honor the tag and show the image upright. But when
// we decode raw pixels via `createImageBitmap` and copy them to a canvas,
// `canvas.toBlob()` writes a JPEG with NO EXIF tag — so the stored pixels
// are in the rotated orientation while downstream displays render them
// straight. That mismatch made every labeled bounding box land in the
// wrong region when training scripts cropped from raw bytes.
//
// The fix: at capture time, parse the EXIF orientation, apply the
// inverse transform to the canvas so the pixel buffer ends up physically
// upright, and let canvas.toBlob drop the (now-redundant) EXIF tag. All
// downstream consumers — display, OCR, labeling, manifest export — then
// operate on a single coordinate space.
//
// Pure helpers are split out so they're testable under Node without a
// DOM. The canvas transform is DOM-only and lives in this file too, but
// its math has a Node-testable oracle (`mapPointThroughOrientation`).

// ============================================================
// Parser — find EXIF Orientation tag in a JPEG byte stream
// ============================================================

/**
 * Read the EXIF Orientation tag from a JPEG byte buffer. Returns a value
 * in [1, 8]; returns 1 if the file isn't JPEG, has no EXIF segment, has
 * no Orientation tag, or the tag is malformed (1 = treat as upright).
 *
 * Only looks at the first APP1 segment, which is where standard cameras
 * write EXIF. We don't search every APP segment because: (a) more than
 * one APP1 with EXIF is non-standard and shouldn't be relied on, and
 * (b) it'd let a malicious file hide a different orientation in a later
 * segment.
 */
export function parseExifOrientationFromBuffer(buf: ArrayBuffer): number {
  const view = new DataView(buf);
  if (view.byteLength < 2) return 1;
  // SOI: FF D8
  if (view.getUint16(0, false) !== 0xffd8) return 1;

  let offset = 2;
  while (offset + 4 <= view.byteLength) {
    const marker = view.getUint16(offset, false);
    // All markers start with 0xFF; padding bytes are also 0xFF.
    if ((marker & 0xff00) !== 0xff00) return 1;
    // SOS (FFDA) — start of scan, no more metadata before pixel data.
    if (marker === 0xffda || marker === 0xffd9) return 1;
    // Standalone markers have no length payload — skip past the 2 bytes.
    if (marker === 0xffd8 || (marker >= 0xffd0 && marker <= 0xffd7)) {
      offset += 2;
      continue;
    }

    const segLen = view.getUint16(offset + 2, false);
    if (segLen < 2 || offset + 2 + segLen > view.byteLength) return 1;

    if (marker === 0xffe1) {
      // APP1 — check for "Exif\0\0" identifier.
      if (offset + 4 + 6 <= view.byteLength) {
        const sig =
          (view.getUint32(offset + 4, false) === 0x45786966) && // "Exif"
          view.getUint16(offset + 8, false) === 0x0000;
        if (sig) {
          const tiffStart = offset + 10;
          const result = readOrientationFromTiff(view, tiffStart);
          if (result !== null) return result;
          return 1;
        }
      }
    }

    offset += 2 + segLen;
  }
  return 1;
}

function readOrientationFromTiff(view: DataView, tiffStart: number): number | null {
  if (tiffStart + 8 > view.byteLength) return null;
  const byteOrder = view.getUint16(tiffStart, false);
  let little: boolean;
  if (byteOrder === 0x4949) little = true;        // "II"
  else if (byteOrder === 0x4d4d) little = false;  // "MM"
  else return null;

  if (view.getUint16(tiffStart + 2, little) !== 0x002a) return null;
  const ifd0Offset = view.getUint32(tiffStart + 4, little);
  const ifd0 = tiffStart + ifd0Offset;
  if (ifd0 + 2 > view.byteLength) return null;

  const entryCount = view.getUint16(ifd0, little);
  for (let i = 0; i < entryCount; i++) {
    const entry = ifd0 + 2 + i * 12;
    if (entry + 12 > view.byteLength) return null;
    const tag = view.getUint16(entry, little);
    if (tag === 0x0112) {
      // Orientation: type SHORT (3), count 1, value in first 2 bytes of slot.
      const value = view.getUint16(entry + 8, little);
      if (value >= 1 && value <= 8) return value;
      return null;
    }
  }
  return null;
}

/** Convenience wrapper for the browser path. */
export async function readExifOrientation(blob: Blob): Promise<number> {
  // 64 KB is overkill for a metadata segment; EXIF is almost always under
  // 8 KB. We slice to avoid loading multi-MB photos for header inspection.
  const buf = await blob.slice(0, 65536).arrayBuffer();
  return parseExifOrientationFromBuffer(buf);
}

// ============================================================
// Canvas transform — apply EXIF orientation to drawing context
// ============================================================

/**
 * Compute the post-orientation upright dimensions for a source image.
 * Orientations 5–8 swap width and height; 1–4 keep them.
 */
export function uprightSizeForOrientation(
  orientation: number,
  srcW: number,
  srcH: number
): { w: number; h: number } {
  const swap = orientation >= 5 && orientation <= 8;
  return swap ? { w: srcH, h: srcW } : { w: srcW, h: srcH };
}

/**
 * Set a canvas transform that, when followed by `ctx.drawImage(bitmap, 0, 0)`
 * (drawing at natural source size), produces the bitmap rotated/mirrored
 * per the EXIF orientation AND scaled to fit `outW × outH`.
 *
 * The matrix forms are the standard EXIF rotation matrices, scaled. See
 * `mapPointThroughOrientation` for a step-by-step oracle of where each
 * source pixel ends up.
 */
export function setOrientationTransform(
  ctx: CanvasRenderingContext2D,
  orientation: number,
  srcW: number,
  srcH: number,
  outW: number,
  outH: number
): void {
  const upright = uprightSizeForOrientation(orientation, srcW, srcH);
  // Uniform scale would be ideal but we let X and Y differ to absorb any
  // rounding in outW/outH chosen by the caller; in practice the caller
  // computes both from the same `scale` and these are equal.
  const sx = outW / upright.w;
  const sy = outH / upright.h;

  // Canvas transform args are (a, b, c, d, e, f) where
  //   x' = a*x + c*y + e
  //   y' = b*x + d*y + f
  switch (orientation) {
    case 2: // horizontal flip
      ctx.setTransform(-sx, 0, 0, sy, outW, 0);
      break;
    case 3: // 180°
      ctx.setTransform(-sx, 0, 0, -sy, outW, outH);
      break;
    case 4: // vertical flip
      ctx.setTransform(sx, 0, 0, -sy, 0, outH);
      break;
    case 5: // 90° CW + horizontal flip
      ctx.setTransform(0, sy, sx, 0, 0, 0);
      break;
    case 6: // 90° CW
      ctx.setTransform(0, sy, -sx, 0, outW, 0);
      break;
    case 7: // 90° CCW + horizontal flip
      ctx.setTransform(0, -sy, -sx, 0, outW, outH);
      break;
    case 8: // 90° CCW
      ctx.setTransform(0, -sy, sx, 0, 0, outH);
      break;
    default: // 1 = identity
      ctx.setTransform(sx, 0, 0, sy, 0, 0);
  }
}

// ============================================================
// Pure point-mapping oracle (for tests / docs)
// ============================================================

/**
 * Where does source pixel (x, y) land in the upright (post-EXIF) image,
 * BEFORE any scaling? Use this to verify the canvas transform and to
 * answer "if I label a feature at raw (x, y), where does it appear after
 * normalization?" Output coordinates use the upright image's coordinate
 * space, which has dimensions per `uprightSizeForOrientation`.
 *
 * Identity case (orientation 1) is the trivial passthrough.
 */
export function mapPointThroughOrientation(
  orientation: number,
  srcW: number,
  srcH: number,
  x: number,
  y: number
): { x: number; y: number } {
  switch (orientation) {
    case 2: return { x: srcW - x, y };
    case 3: return { x: srcW - x, y: srcH - y };
    case 4: return { x, y: srcH - y };
    case 5: return { x: y, y: x };
    case 6: return { x: srcH - y, y: x };
    case 7: return { x: srcH - y, y: srcW - x };
    case 8: return { x: y, y: srcW - x };
    default: return { x, y };
  }
}
