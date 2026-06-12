// IndexedDB persistence layer.
//
// localStorage isn't viable for this app because photos are large binary blobs
// (~500KB-2MB each), and a single inspection can have 80+ photos. IndexedDB
// handles gigabytes and supports binary data natively.
//
// Stores:
//   inspections      - inspection records (JSON), keyed by id
//   photoBlobs       - photo binary data, keyed by photoId, with inspectionId index
//   syncQueue        - pending operations to push to SharePoint when online
//   trainingLabels   - ground-truth bounding box + text labels for OCR training (v2+)

import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { Inspection, InspectionPhoto } from '../types/inspection';
import type { TrainingLabel, PhotoWithInspection } from './trainingLabels';
import { buildLabelQueue } from './trainingLabels';

interface InspectionDB extends DBSchema {
  inspections: {
    key: string;
    value: Inspection;
    indexes: { 'by-site': string; 'by-status': string; 'by-updatedAt': string };
  };
  photoBlobs: {
    key: string;
    value: {
      photoId: string;
      inspectionId: string;
      blob: Blob;
      capturedAt: string;
      uploaded: boolean;
    };
    indexes: { 'by-inspection': string; 'by-uploaded': string };
  };
  syncQueue: {
    key: number;
    value: SyncQueueEntry;
    indexes: { 'by-status': string };
  };
  trainingLabels: {
    key: string;
    value: TrainingLabel;
    indexes: { 'by-photo': string; 'by-status': string };
  };
}

export interface SyncQueueEntry {
  id?: number;
  type: 'inspection-save' | 'inspection-complete' | 'photo-upload' | 'training-label-save' | 'training-label-delete';
  inspectionId: string;
  photoId?: string;
  payload?: any;
  attempts: number;
  lastAttemptAt?: string;
  lastError?: string;
  status: 'pending' | 'in-progress' | 'failed' | 'done';
  createdAt: string;
}

const DB_NAME = 'loadout';
// v1: inspections, photoBlobs, syncQueue
// v2: + trainingLabels (additive — does not touch existing stores)
const DB_VERSION = 2;

let dbPromise: Promise<IDBPDatabase<InspectionDB>> | null = null;

export function getDB(): Promise<IDBPDatabase<InspectionDB>> {
  if (!dbPromise) {
    dbPromise = openDB<InspectionDB>(DB_NAME, DB_VERSION, {
      // The upgrade callback runs once per DB-version step. Each `if
      // (!db.objectStoreNames.contains(...))` guard means a brand-new install
      // creates every store, while an existing install only creates the new
      // ones — no destructive recreation, no data loss.
      upgrade(db) {
        if (!db.objectStoreNames.contains('inspections')) {
          const store = db.createObjectStore('inspections', { keyPath: 'id' });
          store.createIndex('by-site', 'siteId');
          store.createIndex('by-status', 'status');
          store.createIndex('by-updatedAt', 'lastEditedAt');
        }
        if (!db.objectStoreNames.contains('photoBlobs')) {
          const store = db.createObjectStore('photoBlobs', { keyPath: 'photoId' });
          store.createIndex('by-inspection', 'inspectionId');
          store.createIndex('by-uploaded', 'uploaded');
        }
        if (!db.objectStoreNames.contains('syncQueue')) {
          const store = db.createObjectStore('syncQueue', { keyPath: 'id', autoIncrement: true });
          store.createIndex('by-status', 'status');
        }
        if (!db.objectStoreNames.contains('trainingLabels')) {
          const store = db.createObjectStore('trainingLabels', { keyPath: 'id' });
          // photoId is the natural lookup key — "is this photo labeled yet?"
          // not unique by index definition, but the labeling tool enforces
          // single-label-per-photo at the application level
          store.createIndex('by-photo', 'photoId');
          store.createIndex('by-status', 'status');
        }
      },
    });
  }
  return dbPromise;
}

// ---- Inspections ----

export async function dbSaveInspection(inspection: Inspection): Promise<void> {
  const db = await getDB();
  await db.put('inspections', inspection);
  await dbEnqueueSync({
    type: inspection.status === 'Complete' || inspection.status === 'Flagged' ? 'inspection-complete' : 'inspection-save',
    inspectionId: inspection.id
  });
}

export async function dbGetInspection(id: string): Promise<Inspection | undefined> {
  const db = await getDB();
  return db.get('inspections', id);
}

export async function dbListInspectionsForSite(siteId: string): Promise<Inspection[]> {
  const db = await getDB();
  const results = await db.getAllFromIndex('inspections', 'by-site', siteId);
  return results.sort((a, b) => (b.lastEditedAt || '').localeCompare(a.lastEditedAt || ''));
}

export async function dbListInProgressForSite(siteId: string): Promise<Inspection[]> {
  const all = await dbListInspectionsForSite(siteId);
  return all.filter((i) => i.status === 'Draft' || i.status === 'InProgress');
}

export async function dbListCompletedForSite(siteId: string): Promise<Inspection[]> {
  const all = await dbListInspectionsForSite(siteId);
  return all.filter((i) => i.status === 'Complete' || i.status === 'Flagged');
}

export async function dbDeleteInspection(id: string): Promise<void> {
  const db = await getDB();
  await db.delete('inspections', id);
}

// ---- Photo blobs ----

export async function dbSavePhotoBlob(
  photoId: string,
  inspectionId: string,
  blob: Blob
): Promise<void> {
  const db = await getDB();
  await db.put('photoBlobs', {
    photoId,
    inspectionId,
    blob,
    capturedAt: new Date().toISOString(),
    uploaded: false,
  });
  await dbEnqueueSync({
    type: 'photo-upload',
    inspectionId,
    photoId
  });
}

export async function dbGetPhotoBlob(photoId: string): Promise<Blob | undefined> {
  const db = await getDB();
  const record = await db.get('photoBlobs', photoId);
  return record?.blob;
}

export async function dbMarkPhotoUploaded(photoId: string): Promise<void> {
  const db = await getDB();
  const record = await db.get('photoBlobs', photoId);
  if (record) {
    record.uploaded = true;
    await db.put('photoBlobs', record);
  }
}

// ---- Sync queue ----

export async function dbEnqueueSync(entry: Omit<SyncQueueEntry, 'id' | 'createdAt' | 'attempts' | 'status'>): Promise<number> {
  const db = await getDB();
  
  // Deduplicate pending updates for the same inspection or training label to prevent queue bloat
  if (entry.type === 'inspection-save' || entry.type === 'inspection-complete') {
    const tx = db.transaction('syncQueue', 'readwrite');
    const index = tx.store.index('by-status');
    let cursor = await index.openCursor('pending');
    while (cursor) {
      const record = cursor.value;
      if (
        record.inspectionId === entry.inspectionId &&
        (record.type === 'inspection-save' || record.type === 'inspection-complete')
      ) {
        await cursor.delete();
      }
      cursor = await cursor.continue();
    }
    await tx.done;
  } else if (entry.type === 'training-label-save') {
    const tx = db.transaction('syncQueue', 'readwrite');
    const index = tx.store.index('by-status');
    let cursor = await index.openCursor('pending');
    while (cursor) {
      const record = cursor.value;
      if (
        record.photoId === entry.photoId &&
        record.type === 'training-label-save'
      ) {
        await cursor.delete();
      }
      cursor = await cursor.continue();
    }
    await tx.done;
  }
  
  return db.add('syncQueue', {
    ...entry,
    attempts: 0,
    status: 'pending',
    createdAt: new Date().toISOString(),
  }) as Promise<number>;
}

export async function dbGetPendingSync(): Promise<SyncQueueEntry[]> {
  const db = await getDB();
  return db.getAllFromIndex('syncQueue', 'by-status', 'pending');
}

export async function dbUpdateSyncEntry(entry: SyncQueueEntry): Promise<void> {
  const db = await getDB();
  await db.put('syncQueue', entry);
}

// ---- Stats ----

export async function dbGetPendingSyncCount(): Promise<number> {
  const db = await getDB();
  return db.countFromIndex('syncQueue', 'by-status', 'pending');
}

export async function dbGetUnuploadedPhotoCount(): Promise<number> {
  const db = await getDB();
  // IDBKeyRange uses 'false' as a string for boolean indexes via the idb library
  // Workaround: get all and filter (small set anyway)
  const all = await db.getAll('photoBlobs');
  return all.filter((p) => !p.uploaded).length;
}

// ---- Training labels (for the admin labeling tool) ----

export async function dbSaveTrainingLabel(label: TrainingLabel): Promise<void> {
  const db = await getDB();
  await db.put('trainingLabels', label);
  await dbEnqueueSync({
    type: 'training-label-save',
    inspectionId: label.inspectionId,
    photoId: label.photoId,
    payload: label
  });
}

/**
 * Return ALL training labels for a photo (pass-1 + pass-2 if present).
 * The labeling tool needs both passes to render the blind-QC state and to
 * adjudicate disagreements.
 */
export async function dbGetTrainingLabels(photoId: string): Promise<TrainingLabel[]> {
  const db = await getDB();
  return db.getAllFromIndex('trainingLabels', 'by-photo', photoId);
}

export async function dbListTrainingLabels(): Promise<TrainingLabel[]> {
  const db = await getDB();
  return db.getAll('trainingLabels');
}

export async function dbCountTrainingLabels(): Promise<{ labeled: number; skipped: number }> {
  const all = await dbListTrainingLabels();
  let labeled = 0;
  let skipped = 0;
  // Only count pass-1 — pass-2 is QC bookkeeping, not "progress" toward
  // the dataset.
  for (const l of all) {
    if (l.pass !== 1) continue;
    if (l.status === 'labeled') labeled++;
    else if (l.status === 'skipped') skipped++;
  }
  return { labeled, skipped };
}

export async function dbDeleteTrainingLabel(id: string): Promise<void> {
  const db = await getDB();
  await db.delete('trainingLabels', id);
  await dbEnqueueSync({
    type: 'training-label-delete',
    inspectionId: '',
    photoId: id
  });
}

/**
 * Build the first-pass label queue: hard cases (mlTrainingFlag set) plus
 * a random sample of unflagged bag-flap photos in the configured mix
 * (default ~40/60). Walks all inspections and flattens inline photos.
 *
 * Sampling logic lives in trainingLabels.ts so it's unit-testable.
 */
export async function dbListLabelQueue(): Promise<{
  queue: PhotoWithInspection[];
  flaggedCount: number;
  sampledCount: number;
}> {
  const flat = await flattenAllPhotos();
  const labeled = await dbListTrainingLabels();
  // Only exclude photos that already have a pass-1 record. pass-2 records
  // mean the photo is mid-QC, not done.
  const labeledIds = new Set(
    labeled.filter((l) => l.pass === 1).map((l) => l.photoId)
  );
  return buildLabelQueue(flat, labeledIds);
}

/**
 * Fetch the InspectionPhoto records referenced by a set of labels
 * (manifest export needs dimensions/category).
 */
export async function dbGetPhotosForLabels(
  labels: TrainingLabel[]
): Promise<Map<string, InspectionPhoto>> {
  const want = new Set(labels.map((l) => l.photoId));
  const map = new Map<string, InspectionPhoto>();
  const flat = await flattenAllPhotos();
  for (const { photo } of flat) {
    if (want.has(photo.id)) map.set(photo.id, photo);
  }
  return map;
}

/** Fetch a single labelable photo by id (for the QC re-label view). */
export async function dbGetLabelablePhoto(
  photoId: string
): Promise<PhotoWithInspection | undefined> {
  const flat = await flattenAllPhotos();
  return flat.find(({ photo }) => photo.id === photoId);
}

// ---- internal ----

async function flattenAllPhotos(): Promise<PhotoWithInspection[]> {
  const db = await getDB();
  const inspections = await db.getAll('inspections');
  const flat: PhotoWithInspection[] = [];
  for (const inspection of inspections) {
    const collect = (photos: InspectionPhoto[]) => {
      for (const p of photos) flat.push({ photo: p, inspectionId: inspection.id });
    };
    for (const pallet of inspection.pallets) collect(pallet.photos);
    collect(inspection.staging.overviewPhotos);
    collect(inspection.staging.coverSheetPhotos);
  }
  return flat;
}
