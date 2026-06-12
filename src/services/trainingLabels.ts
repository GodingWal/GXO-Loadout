// Training data labeling — types and pure helpers.
//
// Collects ground-truth bounding boxes + text for the batch-code and
// (optionally) variety regions on bag-flap photos. Output feeds external
// model training via exportManifest().
//
// Two-pass labeling protocol:
//   pass=1 — primary label, Tesseract pre-fill allowed.
//   pass=2 — blind QC re-label of a random ~10% sample, pre-fill forced
//            off, prior answer hidden. Disagreements block export until
//            adjudicated; adjudication writes back to the pass=1 record
//            (the canonical training answer is always pass=1).
//
// This module is pure (no React, no IndexedDB) so it stays unit-testable
// under Node's built-in test runner. DB ops live in db.ts; the React UI is
// in components/TrainingLabelingPanel.tsx.

import type { InspectionPhoto } from '../types/inspection';
export const CORN_BATCH_PATTERN = /^[PH][0-9A-Z]{7,9}$/;
export const SOY_BATCH_PATTERN = /^RF[0-9A-Z]{5,7}$/;
export const CHANNEL_BRAND_PATTERN = /^[0-9]{3}-[0-9]{2}[A-Z]{2}[0-9][A-Z]{2,4}$/;
export const DEKALB_BRAND_PATTERN = /^DKC[0-9]{3}-[0-9]{2}[A-Z]{2,4}$/;
export const ASGROW_BRAND_PATTERN = /^[A-Z]{2}[0-9A-Z]{3,7}$/;

// ============================================================
// Constants
// ============================================================

/**
 * Schema version stamped onto exported manifests.
 *   v1 — initial (varietyState absent, no QC, no pass)
 *   v2 — adds pass/varietyState/blindQC + distribution metadata
 *   v3 — distribution.countsByFamily re-keyed to corn/soy/unknown via
 *        the matchAgainst patterns (was P/H/RF prefix); new
 *        distribution.countsByPrefix (informational); blindQC gains
 *        batchAgreementRate + varietyAgreementRate; QC sampling now
 *        time-stratified (5 buckets) instead of id-sorted top-N.
 * Bump when external training scripts would need code changes.
 */
export const MANIFEST_SCHEMA_VERSION = 3;

/**
 * Target fraction of the label queue that comes from the
 * mlTrainingFlag-set pool (hard cases). The remaining fraction is randomly
 * sampled from unflagged bag-flap photos. Tune as data quality drifts;
 * 0.4 was chosen because flagged photos are the highest-information cases
 * but the model still needs lots of easy examples not to over-fit on edge
 * cases.
 */
export const QUEUE_HARD_FRACTION = 0.4;

/**
 * Blind-QC sampling rate over completed pass-1 labels. 10% is industry-
 * standard for human labeling QA at this scale; tune up if disagreement
 * rate is high, down if labelers are bored.
 */
export const QC_SAMPLE_RATE = 0.1;

/** Minimum pass-1 labels before blind QC can be required at export. */
export const QC_MINIMUM_LABELS = 10;

/** IoU threshold above which two boxes count as the "same region." */
export const QC_IOU_THRESHOLD = 0.5;

/**
 * Chronological buckets the QC sample is drawn from. 5 was chosen so a
 * day-long labeling session split across morning / midmorning / lunch /
 * afternoon / evening lands in roughly 1 bucket each.
 */
export const QC_BUCKET_COUNT = 5;

/**
 * Fixed RNG seed for QC sampling — keep this constant. Changing it
 * silently re-rolls every dataset's QC set; treat the seed like a database
 * primary key, not a tunable.
 */
export const QC_SAMPLING_SEED = 0x21BC3589;

// ============================================================
// Core types
// ============================================================

export type Provenance =
  | 'tesseract_unmodified'
  | 'tesseract_corrected'
  | 'typed_from_scratch';

export type LabelStatus = 'labeled' | 'skipped';
export type SkipReason = 'unreadable' | 'no_code_visible' | 'duplicate' | 'other';
export type RegionKind = 'batch' | 'variety';

/** Three states for the variety region:
 *    present     — visible on the bag, labeled
 *    not_present — labeler explicitly confirmed there is no variety code
 *                  (true negative — useful training signal, distinct from skip)
 */
export type VarietyState = 'present' | 'not_present';

/** Box in normalized image-natural coordinates. All values in [0, 1]. */
export interface NormalizedBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface TrainingRegion {
  box: NormalizedBox;
  text: string;
  provenance: Provenance;
  formatValid: boolean;
}

export interface TrainingLabel {
  id: string;
  photoId: string;
  inspectionId: string;
  createdAt: string;
  labeledBy: string;
  pass: 1 | 2;
  status: LabelStatus;
  skipReason?: SkipReason;
  batch?: TrainingRegion;
  varietyState: VarietyState;
  variety?: TrainingRegion; // present iff varietyState === 'present' && status === 'labeled'
}

// ============================================================
// Coordinate conversion
//
// Boxes stored in normalized 0..1 image-natural coordinates so training
// scripts never need to know the iPad display size. The image is rendered
// into a container with object-fit: contain semantics — the helpers below
// take the actual rendered size (post object-fit) plus natural size and
// translate between displayed-pixel and normalized space.
// ============================================================

export function displayBoxToNatural(
  displayBox: { x: number; y: number; w: number; h: number },
  displayedW: number,
  displayedH: number
): NormalizedBox {
  if (displayedW <= 0 || displayedH <= 0) {
    throw new Error('displayBoxToNatural: displayed dimensions must be positive');
  }
  return {
    x: clamp01(displayBox.x / displayedW),
    y: clamp01(displayBox.y / displayedH),
    w: clamp01(displayBox.w / displayedW),
    h: clamp01(displayBox.h / displayedH),
  };
}

export function naturalBoxToDisplay(
  normBox: NormalizedBox,
  displayedW: number,
  displayedH: number
): { x: number; y: number; w: number; h: number } {
  return {
    x: normBox.x * displayedW,
    y: normBox.y * displayedH,
    w: normBox.w * displayedW,
    h: normBox.h * displayedH,
  };
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * For an image (naturalW × naturalH) rendered into a container with
 * object-fit: contain, returns the actual on-screen size of the image
 * content (excludes letterboxing).
 */
export function fittedSize(
  naturalW: number,
  naturalH: number,
  containerW: number,
  containerH: number
): { w: number; h: number } {
  if (naturalW <= 0 || naturalH <= 0) return { w: 0, h: 0 };
  const scale = Math.min(containerW / naturalW, containerH / naturalH);
  return { w: naturalW * scale, h: naturalH * scale };
}

// ============================================================
// Provenance
// ============================================================

/**
 * Decide which provenance to record for a region's text.
 *
 *   initialPrefill — what Tesseract put in the field on photo load
 *                    (or '' if pre-fill was off / yielded nothing)
 *   currentText   — what's in the field right now
 *
 * Why this matters: training scripts will want to filter on provenance so
 * we don't train on "labels" that are really just unchecked OCR output.
 * Don't conflate these three cases.
 */
export function computeProvenance(
  initialPrefill: string,
  currentText: string
): Provenance {
  if (initialPrefill.length > 0 && currentText === initialPrefill) {
    return 'tesseract_unmodified';
  }
  if (initialPrefill.length > 0 && currentText !== initialPrefill) {
    return 'tesseract_corrected';
  }
  return 'typed_from_scratch';
}

// ============================================================
// Format validation
// ============================================================

/**
 * "Does this text look like a known batch or variety code?"
 * Used only for the inline check/warn icon — never blocks save. Real codes
 * may not match our regex; if so, that's a *signal* to widen the regex,
 * not an error to enforce.
 */
export function isFormatValid(text: string, kind: RegionKind): boolean {
  const cleaned = text.toUpperCase().replace(/[^A-Z0-9-]/g, '');
  if (cleaned.length === 0) return false;
  if (kind === 'batch') {
    return CORN_BATCH_PATTERN.test(cleaned) || SOY_BATCH_PATTERN.test(cleaned);
  }
  return (
    CHANNEL_BRAND_PATTERN.test(cleaned) ||
    DEKALB_BRAND_PATTERN.test(cleaned) ||
    ASGROW_BRAND_PATTERN.test(cleaned)
  );
}

// ============================================================
// Save-draft validation
// ============================================================

export interface DraftRegion {
  box: NormalizedBox | null;
  text: string;
}

export interface SaveDraft {
  batch: DraftRegion;
  varietyState: VarietyState;
  variety: DraftRegion;
}

export interface SaveValidationResult {
  ok: boolean;
  errors: string[];
}

/**
 * Validation rules:
 *  - Batch must have BOTH a box AND non-empty text (primary target).
 *  - If varietyState === 'present', variety must have BOTH box AND text.
 *  - If varietyState === 'not_present', variety draft is ignored at save
 *    time (the UI should clear it, but we don't bounce on lingering data).
 *  - No orphan box or text under varietyState='present'.
 */
export function validateForSave(draft: SaveDraft): SaveValidationResult {
  const errors: string[] = [];

  if (!draft.batch.box) errors.push('batch_box_missing');
  if (draft.batch.text.trim().length === 0) errors.push('batch_text_missing');

  if (draft.varietyState === 'present') {
    if (!draft.variety.box) errors.push('variety_box_missing');
    if (draft.variety.text.trim().length === 0) errors.push('variety_text_missing');
  }

  return { ok: errors.length === 0, errors };
}

// ============================================================
// Labelable-photo selection + queue sampling
// ============================================================

export interface PhotoWithInspection {
  photo: InspectionPhoto;
  inspectionId: string;
}

/**
 * Build a labeling queue from all photos across all inspections.
 * The queue mixes "hard" photos (mlTrainingFlag set) with a random sample
 * of "easy" photos (bag-flap category but unflagged), targeting roughly
 * QUEUE_HARD_FRACTION hard / (1 - QUEUE_HARD_FRACTION) easy.
 *
 * Sort: hard photos first (in capture order, newest first), then sampled
 * easy photos in random order. Hard-first because labelers are sharpest
 * early in a session and we want their attention on the failure modes.
 *
 * `rng` is injectable for deterministic tests.
 */
export function buildLabelQueue(
  allPhotos: PhotoWithInspection[],
  alreadyLabeledPhotoIds: Set<string>,
  rng: () => number = Math.random
): { queue: PhotoWithInspection[]; flaggedCount: number; sampledCount: number } {
  const eligible = allPhotos.filter(({ photo }) => !alreadyLabeledPhotoIds.has(photo.id));

  const hard: PhotoWithInspection[] = [];
  const easyPool: PhotoWithInspection[] = [];
  for (const item of eligible) {
    if (item.photo.mlTrainingFlag !== undefined) {
      hard.push(item);
    } else if (item.photo.category === 'Pallet_BagFlap') {
      easyPool.push(item);
    }
  }

  // Hard: capture-time descending
  hard.sort((a, b) =>
    (b.photo.capturedAt || '').localeCompare(a.photo.capturedAt || '')
  );

  // Easy: sample so that hard ÷ (hard + sampled) ≈ QUEUE_HARD_FRACTION,
  // i.e. sampled ≈ hard × (1 - f) / f. If hard is small we still cap the
  // sample at the easy pool size.
  const targetSampled =
    hard.length === 0
      ? easyPool.length // no hard cases at all → just take everything easy
      : Math.round(
          (hard.length * (1 - QUEUE_HARD_FRACTION)) / QUEUE_HARD_FRACTION
        );
  const sampleSize = Math.min(targetSampled, easyPool.length);
  const sampled = sampleWithoutReplacement(easyPool, sampleSize, rng);

  return {
    queue: [...hard, ...sampled],
    flaggedCount: hard.length,
    sampledCount: sampled.length,
  };
}

/**
 * Fisher-Yates partial shuffle to draw k items without replacement.
 * Pure given a deterministic rng.
 */
export function sampleWithoutReplacement<T>(arr: T[], k: number, rng: () => number): T[] {
  if (k >= arr.length) return [...arr];
  if (k <= 0) return [];
  const copy = [...arr];
  for (let i = 0; i < k; i++) {
    const j = i + Math.floor(rng() * (copy.length - i));
    const tmp = copy[i];
    copy[i] = copy[j];
    copy[j] = tmp;
  }
  return copy.slice(0, k);
}

// ============================================================
// QC: IoU and per-photo agreement
// ============================================================

/** Intersection-over-Union of two normalized boxes. 0 if disjoint, 1 if identical. */
export function boxIoU(a: NormalizedBox, b: NormalizedBox): number {
  const ax2 = a.x + a.w;
  const ay2 = a.y + a.h;
  const bx2 = b.x + b.w;
  const by2 = b.y + b.h;
  const ix = Math.max(a.x, b.x);
  const iy = Math.max(a.y, b.y);
  const ix2 = Math.min(ax2, bx2);
  const iy2 = Math.min(ay2, by2);
  if (ix2 <= ix || iy2 <= iy) return 0;
  const intersect = (ix2 - ix) * (iy2 - iy);
  const union = a.w * a.h + b.w * b.h - intersect;
  return union > 0 ? intersect / union : 0;
}

export interface AgreementResult {
  agree: boolean;
  reasons: string[];
  /** True iff batch text matches AND batch boxes meet IoU. */
  batchAgrees: boolean;
  /**
   * True iff the variety portion agrees. Definition:
   *   - both passes 'not_present' → always agrees (vacuously)
   *   - both passes 'present'     → text match AND IoU ≥ threshold
   *   - state mismatch            → does NOT agree
   * Use `varietyConsidered` to decide whether this should count toward
   * the variety-rate aggregate.
   */
  varietyAgrees: boolean;
  /**
   * True iff at least one pass had varietyState='present'. The variety
   * agreement rate denominator excludes both-not-present pairs because
   * "neither pass saw a variety" is true-negative noise; the rate cares
   * about the photos where a variety could have been labeled.
   */
  varietyConsidered: boolean;
}

/**
 * Compare two TrainingLabel records (same photo, different passes) and
 * return whether they agree. The result also surfaces per-region booleans
 * so callers (e.g. metadata.blindQC.{batch,variety}AgreementRate) can
 * compute independent rates without re-doing the comparison.
 *
 * Overall agreement requires ALL of:
 *  - same status (labeled vs skipped)
 *  - if both labeled:
 *      - same batch text (exact, case-insensitive)
 *      - batch box IoU ≥ QC_IOU_THRESHOLD
 *      - same varietyState
 *      - if both 'present', same variety text AND IoU ≥ threshold
 */
export function comparePassAgreement(
  p1: TrainingLabel,
  p2: TrainingLabel,
  iouThreshold: number = QC_IOU_THRESHOLD
): AgreementResult {
  const reasons: string[] = [];

  if (p1.status !== p2.status) reasons.push('status_mismatch');
  if (p1.status !== 'labeled' || p2.status !== 'labeled') {
    return {
      agree: reasons.length === 0,
      reasons,
      batchAgrees: reasons.length === 0,
      varietyAgrees: reasons.length === 0,
      varietyConsidered: false,
    };
  }

  const norm = (s: string | undefined) => (s || '').trim().toUpperCase();

  // ----- Batch -----
  let batchAgrees = true;
  if (norm(p1.batch?.text) !== norm(p2.batch?.text)) {
    reasons.push('batch_text_mismatch');
    batchAgrees = false;
  }
  if (p1.batch?.box && p2.batch?.box) {
    const iou = boxIoU(p1.batch.box, p2.batch.box);
    if (iou < iouThreshold) {
      reasons.push('batch_box_iou_low');
      batchAgrees = false;
    }
  } else if (p1.batch?.box || p2.batch?.box) {
    reasons.push('batch_box_missing_one_pass');
    batchAgrees = false;
  }

  // ----- Variety -----
  let varietyAgrees = true;
  const varietyConsidered =
    p1.varietyState === 'present' || p2.varietyState === 'present';

  if (p1.varietyState !== p2.varietyState) {
    reasons.push('variety_state_mismatch');
    varietyAgrees = false;
  } else if (p1.varietyState === 'present' && p2.varietyState === 'present') {
    if (norm(p1.variety?.text) !== norm(p2.variety?.text)) {
      reasons.push('variety_text_mismatch');
      varietyAgrees = false;
    }
    if (p1.variety?.box && p2.variety?.box) {
      const iou = boxIoU(p1.variety.box, p2.variety.box);
      if (iou < iouThreshold) {
        reasons.push('variety_box_iou_low');
        varietyAgrees = false;
      }
    }
  }

  return {
    agree: reasons.length === 0,
    reasons,
    batchAgrees,
    varietyAgrees,
    varietyConsidered,
  };
}

// ============================================================
// QC sampling: pick which pass-1 labels to re-label blind
// ============================================================

/** Determine which photos need blind QC and what the export gate state is. */
export interface QCState {
  passOneLabeled: number;
  qcTarget: number;
  qcSampled: TrainingLabel[]; // pass-1 records that should have a pass-2
  qcCompleted: number; // photos with both a pass-1 and a pass-2 record
  qcDisagreements: Array<{ pass1: TrainingLabel; pass2: TrainingLabel; reasons: string[] }>;
  exportBlockedReason: string | null;
}

/**
 * Mulberry32 — small seeded RNG, no deps. Same seed produces the same
 * sequence on every call across reloads.
 */
function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Time-stratified QC sampler.
 *
 * Splits pass-1 labeled records into QC_BUCKET_COUNT chronological
 * (createdAt-ascending) buckets of equal *count*, then deterministically
 * samples ceil(bucketSize × QC_SAMPLE_RATE) from each bucket — minimum 1
 * if the bucket is non-empty. The seeded RNG (QC_SAMPLING_SEED + bucket
 * index) is what makes the sample stable across reloads with the same
 * input.
 *
 * Why this beats id-sorted top-N: a labeler working across multiple
 * sessions wants their LATER labels checked too (that's where fatigue
 * drift shows up). id-sort under-sampled later records until volume
 * caught up, defeating fatigue detection.
 *
 * Stability-as-data-grows trade-off: count-based bucket boundaries shift
 * when records are added, which can re-shuffle adjacent buckets. At pilot
 * scale (≤50 records) this is noticeable; at production scale (hundreds
 * per bucket) it's a marginal effect. We accept this because the
 * fatigue-drift coverage matters more than per-record sample stability.
 * Re-running QC over a re-sampled record is harmless (same comparison).
 */
export function pickQCSample(passOneLabeled: TrainingLabel[]): TrainingLabel[] {
  if (passOneLabeled.length === 0) return [];
  const sorted = [...passOneLabeled].sort((a, b) =>
    a.createdAt.localeCompare(b.createdAt)
  );
  const perBucket = Math.ceil(sorted.length / QC_BUCKET_COUNT);
  const out: TrainingLabel[] = [];

  for (let b = 0; b < QC_BUCKET_COUNT; b++) {
    const bucket = sorted.slice(b * perBucket, (b + 1) * perBucket);
    if (bucket.length === 0) continue;

    // Sort the bucket by id so the RNG always sees the same input order
    // across calls — without this the bucket order would depend on the
    // upstream createdAt sort, which is stable but worth pinning.
    const ordered = bucket.slice().sort((a, b) => a.id.localeCompare(b.id));

    const rng = mulberry32(QC_SAMPLING_SEED + b);
    // Fisher-Yates partial shuffle in place
    for (let i = 0; i < ordered.length; i++) {
      const j = i + Math.floor(rng() * (ordered.length - i));
      const tmp = ordered[i];
      ordered[i] = ordered[j];
      ordered[j] = tmp;
    }
    const take = Math.max(1, Math.ceil(bucket.length * QC_SAMPLE_RATE));
    out.push(...ordered.slice(0, take));
  }

  return out;
}

/**
 * Decide whether the dataset can be exported and what QC work remains.
 * Pure — takes all labels in the DB.
 *
 * Rules:
 *  - If there are < QC_MINIMUM_LABELS pass-1 labels, export is allowed
 *    without blind QC (still in pilot).
 *  - Otherwise, sample via pickQCSample (5-bucket time-stratified) so
 *    fatigue drift across sessions is covered.
 *  - Each sampled pass-1 must have a matching pass-2 record on the same
 *    photoId.
 *  - Every (pass-1, pass-2) pair must agree.
 *  - Disagreements must be adjudicated; adjudication writes the chosen
 *    value back to the pass-1 record and removes the pass-2 record.
 */
export function computeQCState(allLabels: TrainingLabel[]): QCState {
  const passOne = allLabels.filter((l) => l.pass === 1 && l.status === 'labeled');
  const passTwoByPhoto = new Map<string, TrainingLabel>();
  for (const l of allLabels) {
    if (l.pass === 2) passTwoByPhoto.set(l.photoId, l);
  }

  const qcSampled = pickQCSample(passOne);
  const qcTarget = qcSampled.length;
  const qcCompleted = qcSampled.filter((p1) => passTwoByPhoto.has(p1.photoId)).length;

  const qcDisagreements: QCState['qcDisagreements'] = [];
  for (const p1 of qcSampled) {
    const p2 = passTwoByPhoto.get(p1.photoId);
    if (!p2) continue;
    const r = comparePassAgreement(p1, p2);
    if (!r.agree) qcDisagreements.push({ pass1: p1, pass2: p2, reasons: r.reasons });
  }

  let exportBlockedReason: string | null = null;
  if (passOne.length >= QC_MINIMUM_LABELS) {
    if (qcCompleted < qcSampled.length) {
      exportBlockedReason = `Blind QC pending: ${qcCompleted}/${qcSampled.length} re-labeled`;
    } else if (qcDisagreements.length > 0) {
      exportBlockedReason = `${qcDisagreements.length} QC disagreement(s) need adjudication`;
    }
  }

  return {
    passOneLabeled: passOne.length,
    qcTarget,
    qcSampled,
    qcCompleted,
    qcDisagreements,
    exportBlockedReason,
  };
}

// ============================================================
// Distribution check (product family balance)
// ============================================================

export type ProductFamily = 'corn' | 'soy' | 'unknown';

export interface DistributionCheck {
  /** Recognized-format buckets. The <10% / >70% warnings operate on these. */
  countsByFamily: Record<ProductFamily, number>;
  /**
   * Raw prefix breakdown (first character, or "RF" for soy). Informational
   * only — useful for spotting unusual prefixes in the dataset, never wired
   * to a warning. Keys are not enumerated; downstream code should not rely
   * on a closed set.
   */
  countsByPrefix: Record<string, number>;
  warnings: string[];
}

/**
 * Classify a batch text against the existing batchCodeMatching regexes.
 * Corn: matches CORN_BATCH_PATTERN. Soy: matches SOY_BATCH_PATTERN.
 * Anything else (no text, regex misses, brand-shaped, random noise) is
 * unknown — that's also a real signal worth tracking, not a bug to hide.
 */
export function inferProductFamily(batchText: string | undefined): ProductFamily {
  if (!batchText) return 'unknown';
  const cleaned = batchText.toUpperCase().replace(/[^A-Z0-9-]/g, '');
  if (CORN_BATCH_PATTERN.test(cleaned)) return 'corn';
  if (SOY_BATCH_PATTERN.test(cleaned)) return 'soy';
  return 'unknown';
}

/**
 * Informational-only prefix tag. "RF" for soy two-letter prefix,
 * otherwise first character. Empty / missing → "none".
 */
export function inferPrefix(batchText: string | undefined): string {
  if (!batchText) return 'none';
  const cleaned = batchText.toUpperCase().replace(/[^A-Z0-9-]/g, '');
  if (cleaned.startsWith('RF')) return 'RF';
  return cleaned.charAt(0) || 'none';
}

/**
 * Tally labels by inferred product family + raw prefix. Warn when any
 * recognized-format family is under-represented (<10% of the labeled set)
 * or dominant (>70%) — both ends are a model-quality risk.
 *
 * The prefix breakdown is informational; no warnings fire on prefix
 * imbalance (varieties of imbalance there are not always meaningful).
 */
export function computeDistributionCheck(labels: TrainingLabel[]): DistributionCheck {
  const labeled = labels.filter((l) => l.pass === 1 && l.status === 'labeled');
  const countsByFamily: Record<ProductFamily, number> = { corn: 0, soy: 0, unknown: 0 };
  const countsByPrefix: Record<string, number> = {};
  for (const l of labeled) {
    countsByFamily[inferProductFamily(l.batch?.text)]++;
    const prefix = inferPrefix(l.batch?.text);
    countsByPrefix[prefix] = (countsByPrefix[prefix] || 0) + 1;
  }
  const warnings: string[] = [];
  const total = labeled.length;
  if (total > 0) {
    for (const fam of ['corn', 'soy', 'unknown'] as ProductFamily[]) {
      const pct = countsByFamily[fam] / total;
      if (pct < 0.1) {
        warnings.push(`${fam} is only ${(pct * 100).toFixed(1)}% of dataset (target: ≥10%)`);
      } else if (pct > 0.7) {
        warnings.push(`${fam} dominates at ${(pct * 100).toFixed(1)}% (target: ≤70%)`);
      }
    }
  }
  return { countsByFamily, countsByPrefix, warnings };
}

// ============================================================
// Manifest export
// ============================================================

export interface ManifestEntry {
  photoId: string;
  inspectionId: string;
  imageFilename: string;
  capturedAt: string;
  category: string;
  naturalWidth?: number;
  naturalHeight?: number;
  labeledBy: string;
  labeledAt: string;
  status: LabelStatus;
  skipReason?: SkipReason;
  batch?: TrainingRegion;
  varietyState: VarietyState;
  variety?: TrainingRegion;
  flaggedForTraining: boolean;
}

export interface ManifestMetadata {
  totalLabeled: number;
  totalSkipped: number;
  flaggedCount: number;
  unflaggedCount: number;
  distribution: DistributionCheck;
  blindQC: {
    sampled: number;
    completed: number;
    /** Photo-level agreement rate (all regions must agree). null in pilot. */
    agreementRate: number | null;
    /**
     * Batch-only agreement (text + IoU) over all completed QC pairs.
     * null in pilot. Useful for diagnosing whether disagreements cluster
     * on the batch region (the primary target) vs the variety region.
     */
    batchAgreementRate: number | null;
    /**
     * Variety agreement over pairs where at least one pass said
     * varietyState='present'. State mismatches count as disagreements.
     * null when no QC ran OR when no QC'd photo had any variety present.
     */
    varietyAgreementRate: number | null;
  };
}

export interface Manifest {
  schemaVersion: typeof MANIFEST_SCHEMA_VERSION;
  exportedAt: string;
  exportedFrom: 'loadout';
  metadata: ManifestMetadata;
  entries: ManifestEntry[];
}

/**
 * Build a manifest from all labels + the photos they reference.
 * Only pass-1 labels appear in entries — pass-2 is QC bookkeeping that
 * doesn't need to flow downstream (its information lives in the agreement
 * rate + the fact that disagreements have been adjudicated into pass-1).
 */
export function buildManifest(
  allLabels: TrainingLabel[],
  photosById: Map<string, InspectionPhoto>
): Manifest {
  const passOne = allLabels.filter((l) => l.pass === 1);
  const qc = computeQCState(allLabels);

  const entries: ManifestEntry[] = passOne.map((l) => {
    const photo = photosById.get(l.photoId);
    return {
      photoId: l.photoId,
      inspectionId: l.inspectionId,
      imageFilename: `${l.photoId}.jpg`,
      capturedAt: photo?.capturedAt || '',
      category: photo?.category || 'unknown',
      naturalWidth: photo?.metadata.originalWidth,
      naturalHeight: photo?.metadata.originalHeight,
      labeledBy: l.labeledBy,
      labeledAt: l.createdAt,
      status: l.status,
      skipReason: l.skipReason,
      batch: l.batch,
      varietyState: l.varietyState,
      variety: l.variety,
      flaggedForTraining: photo?.mlTrainingFlag !== undefined,
    };
  });

  const totalLabeled = entries.filter((e) => e.status === 'labeled').length;
  const totalSkipped = entries.filter((e) => e.status === 'skipped').length;
  const flaggedCount = entries.filter((e) => e.flaggedForTraining).length;
  const unflaggedCount = entries.length - flaggedCount;

  // Per-region rates: walk the completed QC pairs and aggregate the
  // per-region booleans surfaced by comparePassAgreement.
  const passTwoByPhoto = new Map<string, TrainingLabel>();
  for (const l of allLabels) if (l.pass === 2) passTwoByPhoto.set(l.photoId, l);
  const completedPairs = qc.qcSampled
    .map((p1) => ({ p1, p2: passTwoByPhoto.get(p1.photoId) }))
    .filter((x): x is { p1: TrainingLabel; p2: TrainingLabel } => x.p2 !== undefined)
    .map(({ p1, p2 }) => ({ p1, p2, agreement: comparePassAgreement(p1, p2) }));

  const agreementRate =
    completedPairs.length > 0
      ? completedPairs.filter((p) => p.agreement.agree).length / completedPairs.length
      : null;
  const batchAgreementRate =
    completedPairs.length > 0
      ? completedPairs.filter((p) => p.agreement.batchAgrees).length / completedPairs.length
      : null;
  const varietyPool = completedPairs.filter((p) => p.agreement.varietyConsidered);
  const varietyAgreementRate =
    varietyPool.length > 0
      ? varietyPool.filter((p) => p.agreement.varietyAgrees).length / varietyPool.length
      : null;

  return {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    exportedFrom: 'loadout',
    metadata: {
      totalLabeled,
      totalSkipped,
      flaggedCount,
      unflaggedCount,
      distribution: computeDistributionCheck(allLabels),
      blindQC: {
        sampled: qc.qcSampled.length,
        completed: qc.qcCompleted,
        agreementRate,
        batchAgreementRate,
        varietyAgreementRate,
      },
    },
    entries,
  };
}
