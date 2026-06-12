import { useCallback, useEffect, useReducer } from 'react';
import type {
  Inspection,
  InspectionType,
  PalletInspection,
  PalletType,
  InspectionPhoto,
  PhotoMLResults,
  QualityFlag,
  MLTrainingFlag,
  Picklist,
  BOLData,
  Delivery,
  PicklistLineItemEntry,
  BatchSection,
  CrossReferenceResult,
  ReturnsBOLData,
} from '../types/inspection';
import { emptySuggestable } from '../types/inspection';
import { dbSaveInspection } from '../services/db';

export function emptyInspection(siteId: string, type: InspectionType = 'outbound'): Inspection {
  return {
    id: crypto.randomUUID(),
    type,
    siteId,
    status: 'Draft',
    startedAt: new Date().toISOString(),
    lastEditedAt: new Date().toISOString(),
    handoffLog: [],
    picklist: {
      photoIds: [],
      loadNumber: emptySuggestable(),
      shipDate: emptySuggestable(),
      lineItems: [],
    },
    bol: {
      photoIds: [],
      loadNumber: emptySuggestable(),
      shipDate: emptySuggestable(),
      deliveries: [],
    },
    returnsBol: {
      photoIds: [],
      bolNumber: emptySuggestable(),
      receivedDate: emptySuggestable(),
      expectedPallets54x40: emptySuggestable(),
      expectedPallets40x40: emptySuggestable(),
      expectedEmptySeedPaks: emptySuggestable(),
      expectedProductSeedPaks: emptySuggestable(),
      expectedBaggedProduct: emptySuggestable(),
    },
    pallets: [],
    staging: {
      stagingLocation: '',
      stagedCorrectly: 'N/A',
      paperBagsProperlyStacked: 'N/A',
      ltlPalletsSecured: 'N/A',
      mixedPalletsLabeled: 'N/A',
      multiStopStickersAttached: 'N/A',
      palletQuantityMatchesBOL: 'N/A',
      overviewPhotos: [],
      coverSheetPhotos: [],
    },
    flaggedItemsCount: 0,
  };
}

// Helper: create a new batch section with default expected count derived from picklist later
function newBatchSection(): BatchSection {
  return {
    id: crypto.randomUUID(),
    batchCode: emptySuggestable(),
    productName: emptySuggestable(),
    expectedBagCount: 0,
    actualBagCount: emptySuggestable(),
  };
}

export type Action =
  | { type: 'LOAD'; inspection: Inspection }
  | { type: 'SET_STARTED_BY'; name: string }
  | { type: 'SET_PICKER_NAME'; name: string }
  | { type: 'SET_STAGING_LOCATION'; name: string }
  | { type: 'SET_CURRENT_INSPECTOR'; name: string; previousName?: string }
  | { type: 'SET_COMPLETED_BY'; name: string }
  | { type: 'SET_PICKLIST'; patch: Partial<Picklist> }
  | { type: 'ADD_PICKLIST_PHOTO'; photo: InspectionPhoto }
  | { type: 'UPDATE_PICKLIST_LINE'; index: number; patch: Partial<PicklistLineItemEntry> }
  | { type: 'ADD_PICKLIST_LINE'; line: PicklistLineItemEntry }
  | { type: 'REMOVE_PICKLIST_LINE'; index: number }
  | { type: 'SET_BOL'; patch: Partial<BOLData> }
  | { type: 'ADD_BOL_PHOTO'; photo: InspectionPhoto }
  | { type: 'ADD_DELIVERY'; delivery: Delivery }
  | { type: 'UPDATE_DELIVERY'; id: string; patch: Partial<Delivery> }
  | { type: 'REMOVE_DELIVERY'; id: string }
  | { type: 'SET_RETURNS_BOL'; patch: Partial<ReturnsBOLData> }
  | { type: 'ADD_RETURNS_BOL_PHOTO'; photo: InspectionPhoto }
  | { type: 'VERIFY_RETURNS_BOL'; verifiedBy: string }
  | { type: 'SET_CROSS_REFERENCE'; result: CrossReferenceResult }
  | { type: 'VERIFY_PICKLIST'; verifiedBy: string }
  | { type: 'ADD_PALLET'; palletType: PalletType; deliveryId: string; batchCount: 1 | 2 | 3; scannedBy?: string }
  | { type: 'REMOVE_PALLET'; index: number }
  | { type: 'UPDATE_PALLET'; index: number; patch: Partial<PalletInspection> }
  | { type: 'UPDATE_BATCH_SECTION'; palletIndex: number; sectionId: string; patch: Partial<BatchSection> }
  | { type: 'ADD_PALLET_PHOTO'; palletIndex: number; photo: InspectionPhoto }
  | { type: 'REPLACE_PALLET_PHOTO'; palletIndex: number; slotKey: string; photo: InspectionPhoto }
  | { type: 'UPDATE_PHOTO_ML'; photoId: string; results: PhotoMLResults }
  | { type: 'SET_PHOTO_QUALITY_FLAG'; photoId: string; flag?: QualityFlag }
  | { type: 'SET_PHOTO_ML_FLAG'; photoId: string; flag?: MLTrainingFlag }
  | { type: 'SET_PALLET_QUALITY_FLAG'; index: number; flag?: QualityFlag }
  | { type: 'SET_INSPECTION_QUALITY_FLAG'; flag?: QualityFlag }
  | { type: 'SET_STAGING'; field: keyof Inspection['staging']; value: any }
  | { type: 'ADD_STAGING_PHOTO'; section: 'overview' | 'cover-sheet'; photo: InspectionPhoto }
  | { type: 'MARK_COMPLETE' };

function recomputeTallies(state: Inspection): Inspection {
  // Aggregate confirmed bag counts per batch code, summing across all
  // pallets and across all batch sections within each pallet. This handles
  // manual-add-then-scan correctly: regardless of where the batch entry
  // came from, anything with a matching batch code rolls up under the same
  // picklist line.
  const tally: Record<string, number> = {};
  for (const pallet of state.pallets) {
    for (const section of pallet.batchSections) {
      const code = section.batchCode.value;
      const count = section.actualBagCount.value;
      if (code && typeof count === 'number') {
        tally[code] = (tally[code] || 0) + count;
      }
    }
  }

  const lineItems = state.picklist.lineItems.map((li) => {
    const batch = li.batchCode.value;
    const actual = batch ? tally[batch] || 0 : 0;
    const expected = li.expectedQuantity.value || 0;
    return {
      ...li,
      actualQuantity: actual,
      fulfilled: actual >= expected && expected > 0,
    };
  });

  // Also update expected bag count on each pallet's batch sections from the
  // picklist line — needed so the pallet form can show read-only expected count.
  const pallets = state.pallets.map((p) => ({
    ...p,
    batchSections: p.batchSections.map((bs) => {
      const code = bs.batchCode.value;
      if (!code) return bs;
      const lineItem = lineItems.find((li) => li.batchCode.value === code);
      // Expected bag count for THIS pallet section is just the picklist line's
      // expected total. The page UI will show remaining = expected - actualSoFar
      return { ...bs, expectedBagCount: lineItem?.expectedQuantity.value || 0 };
    }),
  }));

  return { ...state, picklist: { ...state.picklist, lineItems }, pallets };
}

function recomputeFlags(state: Inspection): Inspection {
  let count = state.qualityFlag ? 1 : 0;
  for (const pallet of state.pallets) {
    if (pallet.qualityFlag) count++;
    for (const photo of pallet.photos) {
      if (photo.qualityFlag) count++;
    }
  }
  for (const photo of state.staging.overviewPhotos) {
    if (photo.qualityFlag) count++;
  }
  for (const photo of state.staging.coverSheetPhotos) {
    if (photo.qualityFlag) count++;
  }
  return { ...state, flaggedItemsCount: count };
}

function reducer(state: Inspection, action: Action): Inspection {
  let next: Inspection;

  switch (action.type) {
    case 'LOAD':
      return action.inspection;

    case 'SET_STARTED_BY':
      next = {
        ...state,
        startedBy: action.name,
        currentInspector: action.name,
        lastEditedBy: action.name,
      };
      break;

    case 'SET_PICKER_NAME':
      next = { ...state, pickerName: action.name };
      break;

    case 'SET_STAGING_LOCATION':
      next = { ...state, stagingLocation: action.name };
      break;

    case 'SET_CURRENT_INSPECTOR': {
      // Record this handoff so we can show "M. Jones did pallets 1-5, J. Smith did 6-10"
      const completedByPrev: number[] = [];
      const prevName = state.currentInspector;
      if (prevName) {
        for (const p of state.pallets) {
          if (p.scannedBy === prevName) {
            completedByPrev.push(p.palletNumber);
          }
        }
      }
      const newEntry = {
        at: new Date().toISOString(),
        fromInspector: prevName,
        toInspector: action.name,
        palletsCompletedByPrevious: completedByPrev,
      };
      next = {
        ...state,
        currentInspector: action.name,
        lastEditedBy: action.name,
        handoffLog: [...(state.handoffLog || []), newEntry],
      };
      break;
    }

    case 'SET_COMPLETED_BY':
      next = { ...state, completedBy: action.name, lastEditedBy: action.name };
      break;

    case 'SET_PICKLIST':
      next = { ...state, picklist: { ...state.picklist, ...action.patch } };
      break;

    case 'ADD_PICKLIST_PHOTO':
      next = {
        ...state,
        picklist: { ...state.picklist, photoIds: [...state.picklist.photoIds, action.photo.id] },
      };
      break;

    case 'UPDATE_PICKLIST_LINE':
      next = {
        ...state,
        picklist: {
          ...state.picklist,
          lineItems: state.picklist.lineItems.map((li, i) =>
            i === action.index ? { ...li, ...action.patch } : li
          ),
        },
      };
      break;

    case 'ADD_PICKLIST_LINE':
      next = {
        ...state,
        picklist: {
          ...state.picklist,
          lineItems: [...state.picklist.lineItems, action.line],
        },
      };
      break;

    case 'REMOVE_PICKLIST_LINE':
      next = {
        ...state,
        picklist: {
          ...state.picklist,
          lineItems: state.picklist.lineItems.filter((_, i) => i !== action.index),
        },
      };
      break;

    case 'SET_BOL':
      next = { ...state, bol: { ...state.bol, ...action.patch } };
      break;

    case 'ADD_BOL_PHOTO':
      next = {
        ...state,
        bol: { ...state.bol, photoIds: [...state.bol.photoIds, action.photo.id] },
      };
      break;

    case 'ADD_DELIVERY':
      next = {
        ...state,
        bol: { ...state.bol, deliveries: [...state.bol.deliveries, action.delivery] },
      };
      break;

    case 'UPDATE_DELIVERY':
      next = {
        ...state,
        bol: {
          ...state.bol,
          deliveries: state.bol.deliveries.map((d) =>
            d.id === action.id ? { ...d, ...action.patch } : d
          ),
        },
      };
      break;

    case 'REMOVE_DELIVERY':
      next = {
        ...state,
        bol: {
          ...state.bol,
          deliveries: state.bol.deliveries.filter((d) => d.id !== action.id),
        },
      };
      break;

    case 'SET_RETURNS_BOL':
      next = { ...state, returnsBol: { ...state.returnsBol!, ...action.patch } };
      break;

    case 'ADD_RETURNS_BOL_PHOTO':
      next = {
        ...state,
        returnsBol: { ...state.returnsBol!, photoIds: [...state.returnsBol!.photoIds, action.photo.id] },
      };
      break;

    case 'VERIFY_RETURNS_BOL':
      next = {
        ...state,
        status: 'InProgress',
        returnsBol: {
          ...state.returnsBol!,
          verifiedAt: new Date().toISOString(),
          verifiedBy: action.verifiedBy,
        },
      };
      break;

    case 'SET_CROSS_REFERENCE':
      next = { ...state, crossReference: action.result };
      break;

    case 'VERIFY_PICKLIST':
      next = {
        ...state,
        status: 'InProgress',
        picklist: {
          ...state.picklist,
          verifiedAt: new Date().toISOString(),
          verifiedBy: action.verifiedBy,
        },
      };
      break;

    case 'ADD_PALLET': {
      const newPallet: PalletInspection = {
        palletNumber: state.pallets.length + 1,
        palletType: action.palletType,
        deliveryId: action.deliveryId,
        passInspection: 'Pass',
        accuracyLabelAttached: 'N/A',
        batchCount: action.batchCount,
        batchSections: Array.from({ length: action.batchCount }, newBatchSection),
        photos: [],
        scannedBy: action.scannedBy || state.currentInspector || state.startedBy,
        scannedAt: new Date().toISOString(),
      };
      next = { ...state, pallets: [...state.pallets, newPallet] };
      break;
    }

    case 'REMOVE_PALLET':
      next = {
        ...state,
        pallets: state.pallets
          .filter((_, i) => i !== action.index)
          .map((p, i) => ({ ...p, palletNumber: i + 1 })),
      };
      break;

    case 'UPDATE_PALLET':
      next = {
        ...state,
        pallets: state.pallets.map((p, i) =>
          i === action.index ? { ...p, ...action.patch } : p
        ),
      };
      break;

    case 'UPDATE_BATCH_SECTION':
      next = {
        ...state,
        pallets: state.pallets.map((p, i) =>
          i === action.palletIndex
            ? {
                ...p,
                batchSections: p.batchSections.map((bs) =>
                  bs.id === action.sectionId ? { ...bs, ...action.patch } : bs
                ),
              }
            : p
        ),
      };
      break;

    case 'ADD_PALLET_PHOTO':
      next = {
        ...state,
        pallets: state.pallets.map((p, i) =>
          i === action.palletIndex
            ? { ...p, photos: [...p.photos, action.photo] }
            : p
        ),
      };
      break;

    case 'REPLACE_PALLET_PHOTO':
      // Replace any existing photo with the same slot key, then add the new one
      next = {
        ...state,
        pallets: state.pallets.map((p, i) =>
          i === action.palletIndex
            ? {
                ...p,
                photos: [
                  ...p.photos.filter((ph) => ph.slotKey !== action.slotKey),
                  action.photo,
                ],
              }
            : p
        ),
      };
      break;

    case 'UPDATE_PHOTO_ML': {
      const updatePhoto = (photos: InspectionPhoto[]) =>
        photos.map((p) => (p.id === action.photoId ? { ...p, mlResults: action.results } : p));
      next = {
        ...state,
        staging: {
          ...state.staging,
          overviewPhotos: updatePhoto(state.staging.overviewPhotos),
          coverSheetPhotos: updatePhoto(state.staging.coverSheetPhotos),
        },
        pallets: state.pallets.map((p) => ({ ...p, photos: updatePhoto(p.photos) })),
      };
      break;
    }

    case 'SET_PHOTO_QUALITY_FLAG': {
      const update = (photos: InspectionPhoto[]) =>
        photos.map((p) => (p.id === action.photoId ? { ...p, qualityFlag: action.flag } : p));
      next = {
        ...state,
        staging: {
          ...state.staging,
          overviewPhotos: update(state.staging.overviewPhotos),
          coverSheetPhotos: update(state.staging.coverSheetPhotos),
        },
        pallets: state.pallets.map((p) => ({ ...p, photos: update(p.photos) })),
      };
      break;
    }

    case 'SET_PHOTO_ML_FLAG': {
      const update = (photos: InspectionPhoto[]) =>
        photos.map((p) => (p.id === action.photoId ? { ...p, mlTrainingFlag: action.flag } : p));
      next = {
        ...state,
        staging: {
          ...state.staging,
          overviewPhotos: update(state.staging.overviewPhotos),
          coverSheetPhotos: update(state.staging.coverSheetPhotos),
        },
        pallets: state.pallets.map((p) => ({ ...p, photos: update(p.photos) })),
      };
      break;
    }

    case 'SET_PALLET_QUALITY_FLAG':
      next = {
        ...state,
        pallets: state.pallets.map((p, i) =>
          i === action.index ? { ...p, qualityFlag: action.flag } : p
        ),
      };
      break;

    case 'SET_INSPECTION_QUALITY_FLAG':
      next = { ...state, qualityFlag: action.flag };
      break;

    case 'SET_STAGING':
      next = { ...state, staging: { ...state.staging, [action.field]: action.value } };
      break;

    case 'ADD_STAGING_PHOTO':
      next = {
        ...state,
        staging:
          action.section === 'overview'
            ? { ...state.staging, overviewPhotos: [...state.staging.overviewPhotos, action.photo] }
            : { ...state.staging, coverSheetPhotos: [...state.staging.coverSheetPhotos, action.photo] },
      };
      break;

    case 'MARK_COMPLETE': {
      const hasFlags = state.flaggedItemsCount > 0;
      next = {
        ...state,
        status: hasFlags ? 'Flagged' : 'Complete',
        completedAt: new Date().toISOString(),
      };
      break;
    }

    default:
      return state;
  }

  next = {
    ...next,
    lastEditedAt: new Date().toISOString(),
  };
  next = recomputeTallies(next);
  next = recomputeFlags(next);
  return next;
}

export function useInspection(initial: Inspection) {
  const [inspection, dispatch] = useReducer(reducer, initial);

  useEffect(() => {
    dbSaveInspection(inspection).catch((err) =>
      console.error('Failed to save inspection', err)
    );
  }, [inspection]);

  return { inspection, dispatch };
}
