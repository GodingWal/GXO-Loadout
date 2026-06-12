// Tests for the training-data labeling helpers (pure, no DOM / no DB).
// Run with `npm test` — Node's built-in test runner + type-stripping.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  boxIoU,
  buildLabelQueue,
  buildManifest,
  comparePassAgreement,
  computeDistributionCheck,
  computeProvenance,
  computeQCState,
  displayBoxToNatural,
  fittedSize,
  inferPrefix,
  inferProductFamily,
  isFormatValid,
  MANIFEST_SCHEMA_VERSION,
  naturalBoxToDisplay,
  pickQCSample,
  QC_BUCKET_COUNT,
  QC_MINIMUM_LABELS,
  QUEUE_HARD_FRACTION,
  sampleWithoutReplacement,
  validateForSave,
  type NormalizedBox,
  type PhotoWithInspection,
  type TrainingLabel,
} from './trainingLabels.ts';
import type { InspectionPhoto } from '../types/inspection.ts';

// ============================================================
// Coordinate round-trip
// ============================================================

test('coords: round-trips through display→natural→display without drift', () => {
  // Image 3000x2000 in container 1200x900 → scale 0.4 → fitted 1200x800
  const fitted = fittedSize(3000, 2000, 1200, 900);
  assert.equal(fitted.w, 1200);
  assert.equal(fitted.h, 800);

  const displayBox = { x: 240, y: 160, w: 480, h: 320 };
  const norm = displayBoxToNatural(displayBox, fitted.w, fitted.h);
  assert.equal(norm.x, 0.2);
  assert.equal(norm.y, 0.2);
  assert.equal(norm.w, 0.4);
  assert.equal(norm.h, 0.4);

  const back = naturalBoxToDisplay(norm, fitted.w, fitted.h);
  assert.deepEqual(back, displayBox);
});

test('coords: same normalized box renders proportionally across display sizes', () => {
  const norm: NormalizedBox = { x: 0.25, y: 0.5, w: 0.5, h: 0.25 };
  const small = naturalBoxToDisplay(norm, 800, 600);
  const large = naturalBoxToDisplay(norm, 1600, 1200);
  assert.equal(large.x, small.x * 2);
  assert.equal(large.y, small.y * 2);
  assert.equal(large.w, small.w * 2);
  assert.equal(large.h, small.h * 2);
});

test('coords: out-of-bounds inputs are clamped to [0, 1]', () => {
  const norm = displayBoxToNatural({ x: 50, y: 50, w: 200, h: 200 }, 100, 100);
  assert.equal(norm.w, 1);
  assert.equal(norm.h, 1);
});

// ============================================================
// Provenance
// ============================================================

test('provenance: unmodified pre-fill → tesseract_unmodified', () => {
  assert.equal(computeProvenance('P28S8W5M8', 'P28S8W5M8'), 'tesseract_unmodified');
});
test('provenance: edited pre-fill → tesseract_corrected', () => {
  assert.equal(computeProvenance('P28S8W5M8', 'P28S8W5M9'), 'tesseract_corrected');
  assert.equal(computeProvenance('P28S8W5M8', ''), 'tesseract_corrected');
});
test('provenance: no pre-fill, typed → typed_from_scratch', () => {
  assert.equal(computeProvenance('', 'P28S8W5M8'), 'typed_from_scratch');
});

// ============================================================
// Save validation
// ============================================================

const aBox: NormalizedBox = { x: 0.1, y: 0.1, w: 0.2, h: 0.2 };

test('save: batch text without box is rejected', () => {
  const r = validateForSave({
    batch: { box: null, text: 'P28S8W5M8' },
    varietyState: 'not_present',
    variety: { box: null, text: '' },
  });
  assert.equal(r.ok, false);
  assert.ok(r.errors.includes('batch_box_missing'));
});

test('save: variety present without box is rejected', () => {
  const r = validateForSave({
    batch: { box: aBox, text: 'P28S8W5M8' },
    varietyState: 'present',
    variety: { box: null, text: 'DKC105-35RIB' },
  });
  assert.equal(r.ok, false);
  assert.ok(r.errors.includes('variety_box_missing'));
});

test('save: batch-only with varietyState=not_present is accepted', () => {
  const r = validateForSave({
    batch: { box: aBox, text: 'P28S8W5M8' },
    varietyState: 'not_present',
    variety: { box: null, text: '' },
  });
  assert.equal(r.ok, true);
});

test('save: variety present without text is rejected', () => {
  const r = validateForSave({
    batch: { box: aBox, text: 'P28S8W5M8' },
    varietyState: 'present',
    variety: { box: aBox, text: '' },
  });
  assert.equal(r.ok, false);
  assert.ok(r.errors.includes('variety_text_missing'));
});

test('save: both regions fully populated is accepted', () => {
  const r = validateForSave({
    batch: { box: aBox, text: 'P28S8W5M8' },
    varietyState: 'present',
    variety: { box: aBox, text: 'DKC105-35RIB' },
  });
  assert.equal(r.ok, true);
});

// ============================================================
// Format validation
// ============================================================

test('isFormatValid: batch passes for corn/soy patterns', () => {
  assert.equal(isFormatValid('P28S8W5M8', 'batch'), true);
  assert.equal(isFormatValid('H77MFM7JX', 'batch'), true);
  assert.equal(isFormatValid('RF5SBU1E', 'batch'), true);
});

test('isFormatValid: variety passes for known brand patterns', () => {
  assert.equal(isFormatValid('DKC105-35RIB', 'variety'), true);
  assert.equal(isFormatValid('200-44VT4PRIB', 'variety'), true);
});

test('isFormatValid: empty / noise → false', () => {
  assert.equal(isFormatValid('', 'batch'), false);
  assert.equal(isFormatValid('ZZZ', 'batch'), false);
});

// ============================================================
// Queue sampling
// ============================================================

function makePhoto(id: string, opts: Partial<InspectionPhoto> = {}): PhotoWithInspection {
  const photo: InspectionPhoto = {
    id,
    capturedAt: '2026-05-10T12:00:00Z',
    capturedBy: 'tester',
    category: 'Pallet_BagFlap',
    metadata: {},
    ...opts,
  };
  return { photo, inspectionId: 'i1' };
}

function flagged(id: string): PhotoWithInspection {
  return makePhoto(id, {
    mlTrainingFlag: { flaggedAt: 'x', flaggedBy: 'y', hint: 'unusual_lighting' },
  });
}

// Deterministic LCG so the sampling tests don't flake.
function seededRng(seed = 12345): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

test('queue: hits ~40/60 split when both pools are large', () => {
  const photos = [
    ...Array.from({ length: 50 }, (_, i) => flagged('h' + i)),
    ...Array.from({ length: 200 }, (_, i) => makePhoto('e' + i)),
  ];
  const { queue, flaggedCount, sampledCount } = buildLabelQueue(
    photos,
    new Set(),
    seededRng()
  );
  // All 50 hard photos included; sampled = 50 * 0.6/0.4 = 75
  assert.equal(flaggedCount, 50);
  assert.equal(sampledCount, 75);
  assert.equal(queue.length, 125);
  // Hard fraction is within tolerance of target
  const hardActual = flaggedCount / queue.length;
  assert.ok(Math.abs(hardActual - QUEUE_HARD_FRACTION) < 0.01);
});

test('queue: excludes photos that already have a pass-1 label', () => {
  const photos = [flagged('a'), flagged('b'), makePhoto('c'), makePhoto('d')];
  const { queue } = buildLabelQueue(photos, new Set(['a', 'c']), seededRng());
  const ids = queue.map((q) => q.photo.id).sort();
  assert.deepEqual(ids, ['b', 'd']);
});

test('queue: no hard photos → takes the whole easy pool', () => {
  const photos = [makePhoto('a'), makePhoto('b'), makePhoto('c')];
  const { queue, flaggedCount, sampledCount } = buildLabelQueue(
    photos,
    new Set(),
    seededRng()
  );
  assert.equal(flaggedCount, 0);
  assert.equal(sampledCount, 3);
  assert.equal(queue.length, 3);
});

test('queue: easy pool smaller than the 60% target → cap to pool size', () => {
  const photos = [
    flagged('h1'),
    flagged('h2'),
    flagged('h3'),
    flagged('h4'),
    flagged('h5'),
    // target sampled = 5 * 0.6/0.4 = 7.5 → ceiling effectively 8; only 2 easy available
    makePhoto('e1'),
    makePhoto('e2'),
  ];
  const { sampledCount } = buildLabelQueue(photos, new Set(), seededRng());
  assert.equal(sampledCount, 2);
});

test('sampleWithoutReplacement: returns all when k ≥ n; returns 0 when k ≤ 0', () => {
  assert.deepEqual(sampleWithoutReplacement([1, 2, 3], 5, seededRng()).sort(), [1, 2, 3]);
  assert.deepEqual(sampleWithoutReplacement([1, 2, 3], 0, seededRng()), []);
});

// ============================================================
// IoU
// ============================================================

test('IoU: identical boxes → 1', () => {
  const a: NormalizedBox = { x: 0.1, y: 0.1, w: 0.3, h: 0.3 };
  // Float-point: union math can yield 1 ± epsilon when both boxes are
  // identical because of the (area_a + area_b - intersection) cancellation.
  assert.ok(Math.abs(boxIoU(a, a) - 1) < 1e-9);
});

test('IoU: disjoint boxes → 0', () => {
  const a: NormalizedBox = { x: 0, y: 0, w: 0.1, h: 0.1 };
  const b: NormalizedBox = { x: 0.5, y: 0.5, w: 0.1, h: 0.1 };
  assert.equal(boxIoU(a, b), 0);
});

test('IoU: half-overlapping unit boxes → 1/3', () => {
  const a: NormalizedBox = { x: 0, y: 0, w: 0.4, h: 0.4 };
  const b: NormalizedBox = { x: 0.2, y: 0, w: 0.4, h: 0.4 };
  // intersect = 0.2 * 0.4 = 0.08
  // union     = 0.16 + 0.16 - 0.08 = 0.24
  // IoU       = 0.08 / 0.24 = 1/3
  assert.ok(Math.abs(boxIoU(a, b) - 1 / 3) < 1e-9);
});

// ============================================================
// Agreement
// ============================================================

function makeLabel(over: Partial<TrainingLabel> = {}): TrainingLabel {
  const base: TrainingLabel = {
    id: 'l-' + Math.random().toString(36).slice(2, 8),
    photoId: 'p1',
    inspectionId: 'i1',
    createdAt: '2026-05-10T12:00:00Z',
    labeledBy: 'AB',
    pass: 1,
    status: 'labeled',
    varietyState: 'not_present',
    batch: { box: aBox, text: 'P28S8W5M8', provenance: 'typed_from_scratch', formatValid: true },
    ...over,
  };
  return base;
}

test('agreement: identical → agree', () => {
  const p1 = makeLabel({ pass: 1 });
  const p2 = makeLabel({ pass: 2 });
  const r = comparePassAgreement(p1, p2);
  assert.equal(r.agree, true);
  assert.deepEqual(r.reasons, []);
});

test('agreement: one-character batch difference → disagree', () => {
  const p1 = makeLabel({ pass: 1 });
  const p2 = makeLabel({
    pass: 2,
    batch: { ...p1.batch!, text: 'P28S8W5M9' },
  });
  const r = comparePassAgreement(p1, p2);
  assert.equal(r.agree, false);
  assert.ok(r.reasons.includes('batch_text_mismatch'));
});

test('agreement: box IoU below threshold → disagree', () => {
  const p1 = makeLabel({ pass: 1 });
  const farBox: NormalizedBox = { x: 0.6, y: 0.6, w: 0.2, h: 0.2 };
  const p2 = makeLabel({
    pass: 2,
    batch: { ...p1.batch!, box: farBox },
  });
  const r = comparePassAgreement(p1, p2);
  assert.equal(r.agree, false);
  assert.ok(r.reasons.includes('batch_box_iou_low'));
});

test('agreement: variety state mismatch → disagree', () => {
  const p1 = makeLabel({ pass: 1, varietyState: 'not_present' });
  const p2 = makeLabel({
    pass: 2,
    varietyState: 'present',
    variety: { box: aBox, text: 'DKC105-35RIB', provenance: 'typed_from_scratch', formatValid: true },
  });
  const r = comparePassAgreement(p1, p2);
  assert.equal(r.agree, false);
  assert.ok(r.reasons.includes('variety_state_mismatch'));
});

// ============================================================
// Export gating
// ============================================================

function labeledP1(photoId: string, batchText = 'P28S8W5M8'): TrainingLabel {
  return makeLabel({
    id: 'p1-' + photoId,
    photoId,
    pass: 1,
    batch: {
      box: aBox,
      text: batchText,
      provenance: 'typed_from_scratch',
      formatValid: true,
    },
  });
}

function labeledP2(photoId: string, batchText: string): TrainingLabel {
  return {
    ...labeledP1(photoId, batchText),
    id: 'p2-' + photoId,
    pass: 2,
  };
}

test('export gate: below QC_MINIMUM_LABELS → no QC required', () => {
  const labels: TrainingLabel[] = [labeledP1('a'), labeledP1('b'), labeledP1('c')];
  assert.ok(labels.length < QC_MINIMUM_LABELS);
  const qc = computeQCState(labels);
  assert.equal(qc.exportBlockedReason, null);
});

test('export gate: ≥QC_MINIMUM_LABELS without pass-2 → blocked on QC pending', () => {
  const labels = Array.from({ length: 12 }, (_, i) => labeledP1('p' + i));
  const qc = computeQCState(labels);
  assert.ok(qc.qcSampled.length > 0);
  assert.equal(qc.qcCompleted, 0);
  assert.match(qc.exportBlockedReason || '', /QC pending/);
});

test('export gate: pass-2 labels matching pass-1 → unblocked', () => {
  const labels: TrainingLabel[] = [];
  for (let i = 0; i < 12; i++) labels.push(labeledP1('p' + i));
  const qcPreview = computeQCState(labels);
  // Add agreeing pass-2 labels for every sampled photo
  for (const p1 of qcPreview.qcSampled) {
    labels.push(labeledP2(p1.photoId, p1.batch!.text));
  }
  const qc = computeQCState(labels);
  assert.equal(qc.qcCompleted, qc.qcSampled.length);
  assert.equal(qc.qcDisagreements.length, 0);
  assert.equal(qc.exportBlockedReason, null);
});

test('export gate: disagreement → blocked on adjudication', () => {
  const labels: TrainingLabel[] = [];
  for (let i = 0; i < 12; i++) labels.push(labeledP1('p' + i));
  const qcPreview = computeQCState(labels);
  // Pass-2 disagrees on batch text
  for (const p1 of qcPreview.qcSampled) {
    labels.push(labeledP2(p1.photoId, 'P99S8W5M8'));
  }
  const qc = computeQCState(labels);
  assert.ok(qc.qcDisagreements.length > 0);
  assert.match(qc.exportBlockedReason || '', /adjudication/);
});

test('export manifest: contains schemaVersion, metadata, entries only for pass-1', () => {
  const labels: TrainingLabel[] = [
    labeledP1('a'),
    labeledP1('b'),
    { ...labeledP1('c'), status: 'skipped', skipReason: 'unreadable' },
    labeledP2('a', 'P28S8W5M8'),
  ];
  const photos = new Map<string, InspectionPhoto>();
  const manifest = buildManifest(labels, photos);
  assert.equal(manifest.schemaVersion, MANIFEST_SCHEMA_VERSION);
  assert.equal(manifest.schemaVersion, 3);
  assert.equal(manifest.entries.length, 3); // pass-1 only (incl. skipped); pass-2 excluded
  assert.equal(manifest.metadata.totalLabeled, 2);
  assert.equal(manifest.metadata.totalSkipped, 1);
});

// ============================================================
// Distribution check — re-keyed to corn / soy / unknown
// ============================================================

test('distribution: inferProductFamily uses CORN/SOY patterns, not prefix alone', () => {
  assert.equal(inferProductFamily('P28S8W5M8'), 'corn');
  assert.equal(inferProductFamily('H77MFM7JX'), 'corn');
  assert.equal(inferProductFamily('RF5SBU1E'), 'soy');
  // P prefix but fails CORN_BATCH_PATTERN (too short, etc.) → unknown
  assert.equal(inferProductFamily('PXX'), 'unknown');
  assert.equal(inferProductFamily('XYZ'), 'unknown');
  assert.equal(inferProductFamily(''), 'unknown');
  assert.equal(inferProductFamily(undefined), 'unknown');
});

test('distribution: countsByFamily always exposes corn/soy/unknown keys (zero-initialized)', () => {
  const labels: TrainingLabel[] = [labeledP1('p1', 'P28S8W5M8')];
  const d = computeDistributionCheck(labels);
  assert.equal(d.countsByFamily.corn, 1);
  assert.equal(d.countsByFamily.soy, 0);
  assert.equal(d.countsByFamily.unknown, 0);
});

test('distribution: dominance warning fires on the family count, not prefix', () => {
  const labels: TrainingLabel[] = [];
  for (let i = 0; i < 9; i++) labels.push(labeledP1('p' + i, 'P28S8W5M' + i));
  labels.push(labeledP1('s0', 'RF5SBU1E'));
  const d = computeDistributionCheck(labels);
  assert.equal(d.countsByFamily.corn, 9);
  assert.equal(d.countsByFamily.soy, 1);
  // 9/10 = 90% corn → fires "dominates" on corn; soy at 10% sits at the boundary
  assert.ok(d.warnings.some((w) => /corn/.test(w) && /dominates/.test(w)));
});

test('distribution: countsByPrefix breaks out raw first-char / RF (informational only)', () => {
  const labels: TrainingLabel[] = [
    labeledP1('a', 'P28S8W5M8'),
    labeledP1('b', 'P22FS42N8'),
    labeledP1('c', 'H77MFM7JX'),
    labeledP1('d', 'RF5SBU1E'),
  ];
  const d = computeDistributionCheck(labels);
  assert.equal(d.countsByPrefix.P, 2);
  assert.equal(d.countsByPrefix.H, 1);
  assert.equal(d.countsByPrefix.RF, 1);
  // Prefix imbalance never fires a warning; only family imbalance does.
  // Here corn = 3/4 (75%) → fires; soy = 1/4 (25%) → fine. So warnings
  // come from family, not from prefix being uneven.
  for (const w of d.warnings) assert.match(w, /^corn|^soy|^unknown/);
});

test('distribution: inferPrefix returns "RF" for soy, first char otherwise, "none" for empty', () => {
  assert.equal(inferPrefix('RF5SBU1E'), 'RF');
  assert.equal(inferPrefix('P28S8W5M8'), 'P');
  assert.equal(inferPrefix('H77MFM7JX'), 'H');
  assert.equal(inferPrefix(''), 'none');
  assert.equal(inferPrefix(undefined), 'none');
});

// ============================================================
// Per-region agreement
// ============================================================

test('agreement: surfaces batchAgrees / varietyAgrees / varietyConsidered for callers', () => {
  const p1 = makeLabel({ pass: 1 });
  const p2 = makeLabel({ pass: 2 });
  const r = comparePassAgreement(p1, p2);
  assert.equal(r.agree, true);
  assert.equal(r.batchAgrees, true);
  assert.equal(r.varietyAgrees, true);
  // Both default to 'not_present' in makeLabel → variety not considered
  assert.equal(r.varietyConsidered, false);
});

test('agreement: variety state mismatch makes varietyAgrees false and consider it', () => {
  const p1 = makeLabel({ pass: 1, varietyState: 'not_present' });
  const p2 = makeLabel({
    pass: 2,
    varietyState: 'present',
    variety: { box: aBox, text: 'DKC105-35RIB', provenance: 'typed_from_scratch', formatValid: true },
  });
  const r = comparePassAgreement(p1, p2);
  assert.equal(r.varietyConsidered, true);
  assert.equal(r.varietyAgrees, false);
  // Batch unchanged → batchAgrees stays true
  assert.equal(r.batchAgrees, true);
});

test('agreement: batch diff only — batchAgrees false but varietyAgrees true when both not_present', () => {
  const p1 = makeLabel({ pass: 1 });
  const p2 = makeLabel({
    pass: 2,
    batch: { ...p1.batch!, text: 'P28S8W5M9' },
  });
  const r = comparePassAgreement(p1, p2);
  assert.equal(r.batchAgrees, false);
  assert.equal(r.varietyAgrees, true);
  assert.equal(r.varietyConsidered, false);
});

test('manifest blindQC: batch / variety rates computed independently', () => {
  const labels: TrainingLabel[] = [];
  for (let i = 0; i < 20; i++) labels.push(labeledP1('p' + i));
  const sampledIds = computeQCState(labels).qcSampled.map((p) => p.photoId);

  // For every sampled photo, add a pass-2: half disagree on batch, half on variety state
  sampledIds.forEach((photoId, i) => {
    const variant: TrainingLabel = {
      ...labeledP2(photoId, i % 2 === 0 ? 'P99S8W5M8' /* batch diff */ : 'P28S8W5M8'),
      varietyState: i % 2 === 0 ? 'not_present' : 'present',
      variety:
        i % 2 === 0
          ? undefined
          : {
              box: aBox,
              text: 'DKC105-35RIB',
              provenance: 'typed_from_scratch',
              formatValid: true,
            },
    };
    labels.push(variant);
  });

  const manifest = buildManifest(labels, new Map());
  const qc = manifest.metadata.blindQC;
  assert.equal(qc.sampled, sampledIds.length);
  assert.equal(qc.completed, sampledIds.length);
  // i%2==0 pairs: batch disagrees, variety state matches (both not_present) → batch fail
  // i%2==1 pairs: batch agrees, variety state mismatches → variety fail
  // Overall agreement: 0
  assert.equal(qc.agreementRate, 0);
  // Batch rate: only odd-i pairs agree on batch
  const expectedBatchRate = sampledIds.filter((_, i) => i % 2 === 1).length / sampledIds.length;
  assert.ok(Math.abs((qc.batchAgreementRate ?? -1) - expectedBatchRate) < 1e-9);
  // Variety rate considered = pairs where at least one had variety present (only odd-i: p2 had present)
  // Even-i pairs: both not_present → varietyConsidered false → excluded.
  // Odd-i pairs: state matches both present, text differs (P1 had no variety so makeLabel default = not_present)
  // Wait — p1 was labeledP1 → varietyState default from makeLabel is 'not_present'.
  // So odd-i pairs: p1.not_present vs p2.present → state mismatch → variety disagree.
  // Pool = odd-i pairs only; all disagree → varietyAgreementRate = 0.
  assert.equal(qc.varietyAgreementRate, 0);
});

test('manifest blindQC: varietyAgreementRate is null when no QC pair had any variety present', () => {
  const labels: TrainingLabel[] = [];
  for (let i = 0; i < 12; i++) labels.push(labeledP1('p' + i));
  const sampled = computeQCState(labels).qcSampled;
  // Add identical pass-2 records — both passes 'not_present' → variety pool empty
  for (const p1 of sampled) labels.push(labeledP2(p1.photoId, p1.batch!.text));
  const manifest = buildManifest(labels, new Map());
  assert.equal(manifest.metadata.blindQC.varietyAgreementRate, null);
  assert.equal(manifest.metadata.blindQC.agreementRate, 1);
  assert.equal(manifest.metadata.blindQC.batchAgreementRate, 1);
});

// ============================================================
// Time-stratified QC sampling
// ============================================================

function labeledP1At(photoId: string, createdAt: string): TrainingLabel {
  return makeLabel({ id: 'p1-' + photoId, photoId, pass: 1, createdAt });
}

test('QC sampling: spreads selections across all 5 chronological buckets', () => {
  // 100 records spanning a wide createdAt range. With QC_BUCKET_COUNT=5,
  // each bucket holds 20 records and samples ceil(20*0.1)=2 → 10 total.
  // The point: every bucket contributes at least one sample, so a labeler
  // working across sessions sees their late-session work QC'd too.
  const labels: TrainingLabel[] = [];
  const start = Date.parse('2026-05-01T00:00:00Z');
  for (let i = 0; i < 100; i++) {
    // 100 evenly-spaced timestamps across one week
    const t = new Date(start + i * 60 * 60 * 1000).toISOString(); // 1 hour apart
    labels.push(labeledP1At('p' + i.toString().padStart(3, '0'), t));
  }

  const sampled = pickQCSample(labels);
  assert.ok(sampled.length >= QC_BUCKET_COUNT, `should sample at least one per bucket`);

  // Recompute which bucket each sampled record belongs to (same logic as the function)
  const sortedAll = [...labels].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const perBucket = Math.ceil(sortedAll.length / QC_BUCKET_COUNT);
  const bucketOf = (l: TrainingLabel) => {
    const idx = sortedAll.findIndex((x) => x.id === l.id);
    return Math.floor(idx / perBucket);
  };
  const bucketsHit = new Set(sampled.map(bucketOf));
  assert.equal(
    bucketsHit.size,
    QC_BUCKET_COUNT,
    `expected samples from all ${QC_BUCKET_COUNT} buckets, got from buckets: ${[...bucketsHit].sort().join(',')}`
  );
});

test('QC sampling: deterministic — same input produces the same sample', () => {
  const labels: TrainingLabel[] = [];
  const start = Date.parse('2026-05-01T00:00:00Z');
  for (let i = 0; i < 50; i++) {
    const t = new Date(start + i * 60 * 60 * 1000).toISOString();
    labels.push(labeledP1At('p' + i.toString().padStart(3, '0'), t));
  }
  const a = pickQCSample(labels).map((l) => l.id);
  const b = pickQCSample(labels).map((l) => l.id);
  assert.deepEqual(a, b);
});

test('QC sampling: empty input → empty sample', () => {
  assert.deepEqual(pickQCSample([]), []);
});

test('QC sampling: small N → at least one per non-empty bucket', () => {
  // 5 records → one per bucket of 1 → 5 sampled (everyone)
  const labels: TrainingLabel[] = [];
  const start = Date.parse('2026-05-01T00:00:00Z');
  for (let i = 0; i < 5; i++) {
    const t = new Date(start + i * 60 * 60 * 1000).toISOString();
    labels.push(labeledP1At('p' + i, t));
  }
  const sampled = pickQCSample(labels);
  assert.equal(sampled.length, 5);
});
