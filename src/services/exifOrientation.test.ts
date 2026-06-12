// Tests for EXIF orientation parsing + canvas-transform math oracle.
// Run with `npm test`.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mapPointThroughOrientation,
  parseExifOrientationFromBuffer,
  uprightSizeForOrientation,
} from './exifOrientation.ts';

// ============================================================
// Synthetic JPEG byte stream with EXIF Orientation tag
// ============================================================

/**
 * Build a minimal JPEG (SOI + APP1 with one EXIF Orientation entry + EOI)
 * carrying the given orientation. The parser only needs SOI + APP1 to
 * extract the tag, so this isn't a renderable JPEG — it's a header probe.
 */
function buildJpegWithOrientation(orientation: number): ArrayBuffer {
  // APP1 payload layout (after the 2-byte length field):
  //   "Exif\0\0"                      6 bytes
  //   TIFF header: "MM" + 0x002A + 0x00000008 (IFD0 offset)    8 bytes
  //   IFD0: count(2) + 1 entry (12) + next-IFD-offset(4)      18 bytes
  // Total = 32 bytes of payload + 2 bytes for the length field = 34.
  const segLen = 34;

  const bytes = [
    0xff, 0xd8, // SOI
    0xff, 0xe1, // APP1 marker
    (segLen >> 8) & 0xff, segLen & 0xff,
    0x45, 0x78, 0x69, 0x66, 0x00, 0x00, // "Exif\0\0"
    // TIFF header — big-endian
    0x4d, 0x4d, // "MM"
    0x00, 0x2a, // magic = 42
    0x00, 0x00, 0x00, 0x08, // IFD0 offset = 8 from TIFF start
    // IFD0
    0x00, 0x01, // 1 entry
    // Entry: tag=0x0112 (Orientation), type=3 (SHORT), count=1, value=orientation
    0x01, 0x12,
    0x00, 0x03,
    0x00, 0x00, 0x00, 0x01,
    (orientation >> 8) & 0xff, orientation & 0xff, 0x00, 0x00,
    // Next IFD offset (none)
    0x00, 0x00, 0x00, 0x00,
    // EOI (not strictly required for the parser)
    0xff, 0xd9,
  ];
  return new Uint8Array(bytes).buffer;
}

test('exif parser: reads Orientation=6 from a synthetic JPEG', () => {
  const buf = buildJpegWithOrientation(6);
  assert.equal(parseExifOrientationFromBuffer(buf), 6);
});

test('exif parser: round-trips orientations 1..8', () => {
  for (let o = 1; o <= 8; o++) {
    const buf = buildJpegWithOrientation(o);
    assert.equal(parseExifOrientationFromBuffer(buf), o, `orientation ${o}`);
  }
});

test('exif parser: returns 1 (treat as upright) for non-JPEG input', () => {
  const notJpeg = new Uint8Array([0x89, 0x50, 0x4e, 0x47]).buffer; // PNG header
  assert.equal(parseExifOrientationFromBuffer(notJpeg), 1);
});

test('exif parser: returns 1 for a JPEG with no EXIF segment', () => {
  // SOI + EOI only
  const bare = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]).buffer;
  assert.equal(parseExifOrientationFromBuffer(bare), 1);
});

test('exif parser: returns 1 for empty buffer', () => {
  assert.equal(parseExifOrientationFromBuffer(new ArrayBuffer(0)), 1);
});

// ============================================================
// Upright size — axes swap for orientations 5..8
// ============================================================

test('uprightSize: orientations 1..4 preserve dimensions', () => {
  for (const o of [1, 2, 3, 4]) {
    const s = uprightSizeForOrientation(o, 1200, 1600);
    assert.deepEqual(s, { w: 1200, h: 1600 }, `orientation ${o}`);
  }
});

test('uprightSize: orientations 5..8 swap dimensions', () => {
  for (const o of [5, 6, 7, 8]) {
    const s = uprightSizeForOrientation(o, 1200, 1600);
    assert.deepEqual(s, { w: 1600, h: 1200 }, `orientation ${o}`);
  }
});

// ============================================================
// Point-mapping oracle — confirms the canvas transform is well-defined.
//
// The contract: if you record a feature at source pixel (x, y) and apply
// the orientation N transform, the feature should appear at
// mapPointThroughOrientation(N, w, h, x, y) in the upright image.
// ============================================================

test('mapping: orientation 1 is identity', () => {
  assert.deepEqual(mapPointThroughOrientation(1, 1200, 1600, 100, 200), {
    x: 100,
    y: 200,
  });
});

test('mapping: orientation 6 (90° CW) — top-left of source → top-right of upright', () => {
  // Source 1200x1600 portrait → upright 1600x1200 landscape.
  // (0, 0) is the top-left of the rotated SOURCE; after 90° CW that pixel
  // is at the top-right of the upright image: (upright.w, 0) = (srcH, 0).
  const w = 1200;
  const h = 1600;
  assert.deepEqual(mapPointThroughOrientation(6, w, h, 0, 0), { x: h, y: 0 });
  // Bottom-left of source → top-left of upright
  assert.deepEqual(mapPointThroughOrientation(6, w, h, 0, h), { x: 0, y: 0 });
  // Top-right of source → bottom-right of upright
  assert.deepEqual(mapPointThroughOrientation(6, w, h, w, 0), { x: h, y: w });
  // Bottom-right of source → bottom-left of upright
  assert.deepEqual(mapPointThroughOrientation(6, w, h, w, h), { x: 0, y: w });
});

test('mapping: orientation 8 (90° CCW) is the inverse of orientation 6', () => {
  // For any source corner, applying orientation 6 then orientation 8
  // (with the swapped dimensions of the upright space) should round-trip.
  const w = 1200;
  const h = 1600;
  for (const [sx, sy] of [[0, 0], [w, 0], [0, h], [w, h], [500, 700]]) {
    const after6 = mapPointThroughOrientation(6, w, h, sx, sy);
    // Apply orientation 8 in the upright space (dims h × w)
    const back = mapPointThroughOrientation(8, h, w, after6.x, after6.y);
    assert.deepEqual(back, { x: sx, y: sy }, `(${sx}, ${sy})`);
  }
});

test('mapping: orientation 3 (180°) is its own inverse', () => {
  const w = 1200;
  const h = 1600;
  for (const [sx, sy] of [[0, 0], [w, h], [300, 900]]) {
    const a = mapPointThroughOrientation(3, w, h, sx, sy);
    const b = mapPointThroughOrientation(3, w, h, a.x, a.y);
    assert.deepEqual(b, { x: sx, y: sy }, `(${sx}, ${sy})`);
  }
});

test('mapping: a known horizontal-text feature on a portrait iPad photo lands at the expected coords', () => {
  // Concrete scenario from the bug report: a 1200×1600 portrait JPEG with
  // EXIF orientation 6 (90° CW for display). The batch-code label runs
  // HORIZONTALLY across what the user sees. In the raw pixel buffer it
  // runs VERTICALLY (because the buffer is rotated 90° CCW from display).
  //
  // Say the batch text spans source y = 100..400 at x = 800 (a vertical
  // stripe on the right side of the raw buffer). After upright (90° CW),
  // it should land at:
  //   - x = srcH - y, so x ranges 1200..1500 (a horizontal stripe near
  //     the right edge of the landscape upright image)
  //   - y = x = 800 (a single horizontal row)
  // Confirms that what looked like a "tall narrow sliver" in raw-pixel
  // space is actually a horizontal text region in upright space.
  const w = 1200;
  const h = 1600;
  const a = mapPointThroughOrientation(6, w, h, 800, 100);
  const b = mapPointThroughOrientation(6, w, h, 800, 400);
  assert.deepEqual(a, { x: 1500, y: 800 });
  assert.deepEqual(b, { x: 1200, y: 800 });
  // The upright bounding rectangle is (1200..1500, 800..800) — a 300px
  // wide horizontal line, matching the actual text shape.
});
