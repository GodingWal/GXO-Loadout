import {
  dbGetPendingSync,
  dbUpdateSyncEntry,
  dbGetInspection,
  dbGetPhotoBlob,
  dbMarkPhotoUploaded
} from './db';

let isSyncing = false;

// Ping helper to verify the server is actually reachable
async function isServerReachable(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);
    const res = await fetch('/api/health', { method: 'GET', signal: controller.signal });
    clearTimeout(timeoutId);
    return res.status === 200;
  } catch {
    return false;
  }
}

export async function processSyncQueue(): Promise<void> {
  if (isSyncing) return;
  if (!navigator.onLine) return;
  
  // Verify server is actually reachable
  const reachable = await isServerReachable();
  if (!reachable) {
    console.log('[loadout-sync] Server is unreachable. Postponing sync.');
    return;
  }

  isSyncing = true;
  console.log('[loadout-sync] Starting background sync process...');

  try {
    const pendingEntries = await dbGetPendingSync();
    
    // Process one entry at a time to be safe
    for (const entry of pendingEntries) {
      if (entry.status === 'done') continue;
      
      // Update entry status to in-progress
      entry.status = 'in-progress';
      await dbUpdateSyncEntry(entry);
      
      try {
        if (entry.type === 'inspection-save' || entry.type === 'inspection-complete') {
          const inspection = await dbGetInspection(entry.inspectionId);
          if (!inspection) {
            // Inspection no longer exists locally, remove from sync queue
            entry.status = 'done';
            await dbUpdateSyncEntry(entry);
            continue;
          }
          
          const response = await fetch('/api/inspections', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(inspection),
          });
          
          if (response.ok) {
            entry.status = 'done';
            await dbUpdateSyncEntry(entry);
          } else {
            throw new Error(`Server returned ${response.status}`);
          }
        }
        else if (entry.type === 'photo-upload') {
          if (!entry.photoId) {
            entry.status = 'done';
            await dbUpdateSyncEntry(entry);
            continue;
          }
          const blob = await dbGetPhotoBlob(entry.photoId);
          if (!blob) {
            // Photo blob is missing, discard
            entry.status = 'done';
            await dbUpdateSyncEntry(entry);
            continue;
          }
          
          const formData = new FormData();
          formData.append('file', blob, 'photo.jpg');
          formData.append('photoId', entry.photoId);
          formData.append('inspectionId', entry.inspectionId);
          
          const response = await fetch('/api/photo-upload', {
            method: 'POST',
            body: formData,
          });
          
          if (response.ok) {
            await dbMarkPhotoUploaded(entry.photoId);
            entry.status = 'done';
            await dbUpdateSyncEntry(entry);
          } else {
            throw new Error(`Server returned ${response.status}`);
          }
        }
        else if (entry.type === 'training-label-save') {
          if (!entry.payload) {
            entry.status = 'done';
            await dbUpdateSyncEntry(entry);
            continue;
          }
          const response = await fetch('/api/training-labels', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(entry.payload),
          });
          if (response.ok) {
            entry.status = 'done';
            await dbUpdateSyncEntry(entry);
          } else {
            throw new Error(`Server returned ${response.status}`);
          }
        }
        else if (entry.type === 'training-label-delete') {
          const response = await fetch(`/api/training-labels/${entry.photoId}`, {
            method: 'DELETE',
          });
          if (response.ok) {
            entry.status = 'done';
            await dbUpdateSyncEntry(entry);
          } else {
            throw new Error(`Server returned ${response.status}`);
          }
        }
      } catch (err) {
        console.error(`[loadout-sync] Failed to process sync entry ${entry.id}:`, err);
        entry.status = 'failed';
        entry.attempts += 1;
        entry.lastAttemptAt = new Date().toISOString();
        entry.lastError = err instanceof Error ? err.message : String(err);
        await dbUpdateSyncEntry(entry);
      }
    }
    
    // Clean up completed entries from syncQueue
    const db = await (await import('./db')).getDB();
    const tx = db.transaction('syncQueue', 'readwrite');
    let cursor = await tx.store.openCursor();
    while (cursor) {
      if (cursor.value.status === 'done') {
        await cursor.delete();
      }
      cursor = await cursor.continue();
    }
    await tx.done;
    
  } catch (err) {
    console.error('[loadout-sync] Error running sync queue:', err);
  } finally {
    isSyncing = false;
  }
}

export function startBackgroundSync(): void {
  // Run sync queue check on startup
  processSyncQueue();
  
  // Set up interval (every 10 seconds)
  setInterval(processSyncQueue, 10000);
  
  // Listen for online events
  window.addEventListener('online', () => {
    console.log('[loadout-sync] Browser went online. Triggering sync...');
    processSyncQueue();
  });
}
