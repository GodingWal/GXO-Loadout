// Shared enumerations referenced by object properties and action parameters.
//
// These mirror the string-literal unions in `types/ontology.ts` and
// `types/inspection.ts`. The parity assertions in `parity.ts` fail the build if
// the two ever drift apart.

import type { ValueTypeDefinition } from './types';

export const VALUE_TYPES = {
  // ─── Loadout ───────────────────────────────────────────────────────
  LaneStatus: {
    apiName: 'LaneStatus',
    displayName: 'Lane Status',
    description: 'Occupancy state of a staging lane.',
    values: ['EMPTY', 'STAGED', 'RESERVED', 'BLOCKED'],
    labels: {
      EMPTY: 'Empty',
      STAGED: 'Staged',
      RESERVED: 'Reserved',
      BLOCKED: 'Blocked',
    },
  },
  LoadStatus: {
    apiName: 'LoadStatus',
    displayName: 'Load Status',
    description: 'Lifecycle of an outbound load from build to departure.',
    values: ['PENDING', 'STAGED', 'LOADING', 'DISPATCHED'],
    labels: {
      PENDING: 'Pending',
      STAGED: 'Staged',
      LOADING: 'Loading',
      DISPATCHED: 'Dispatched',
    },
  },
  InspectionResult: {
    apiName: 'InspectionResult',
    displayName: 'Inspection Result',
    description: 'Outcome recorded against a load or pallet inspection.',
    values: [
      'PASSED',
      'FAILED_WRONG_LOCATION',
      'FAILED_DAMAGED',
      'FAILED_COUNT_MISMATCH',
      'FAILED_LABELING',
    ],
    labels: {
      PASSED: 'Passed',
      FAILED_WRONG_LOCATION: 'Failed — wrong location',
      FAILED_DAMAGED: 'Failed — damaged',
      FAILED_COUNT_MISMATCH: 'Failed — count mismatch',
      FAILED_LABELING: 'Failed — labeling',
    },
  },
  PackagingType: {
    apiName: 'PackagingType',
    displayName: 'Packaging Type',
    description: 'Physical pallet footprint or packaging format.',
    values: ['40x40', '48x40', '54x40', 'seedpak', 'minibulk', 'other'],
  },
  PalletType: {
    apiName: 'PalletType',
    displayName: 'Pallet Type',
    description: 'Pallet build used to derive required inspection photos.',
    values: [
      'Full Bag Pallet',
      'Partial Bag Pallet',
      'Mixed Bag Pallet',
      'Seedpak',
      'Minibulk',
      'Paper Bag',
    ],
  },

  // ─── Loadout field inspection (offline-first records) ──────────────
  InspectionType: {
    apiName: 'InspectionType',
    displayName: 'Inspection Type',
    description: 'Workflow an inspection follows.',
    values: ['outbound', 'inbound', 'returns', 'retag'],
    labels: {
      outbound: 'Outbound',
      inbound: 'Inbound',
      returns: 'Returns',
      retag: 'Retag',
    },
  },
  InspectionStatus: {
    apiName: 'InspectionStatus',
    displayName: 'Inspection Status',
    description: 'Lifecycle of a field inspection record.',
    values: ['PENDING', 'IN_PROGRESS', 'COMPLETED', 'FLAGGED', 'CANCELLED'],
    labels: {
      PENDING: 'Pending',
      IN_PROGRESS: 'In progress',
      COMPLETED: 'Completed',
      FLAGGED: 'Flagged',
      CANCELLED: 'Cancelled',
    },
  },
  ReturnsBrand: {
    apiName: 'ReturnsBrand',
    displayName: 'Returns Brand',
    description: 'Brand a returns load belongs to.',
    values: ['Dekalb', 'Channel'],
  },
  YesNoNA: {
    apiName: 'YesNoNA',
    displayName: 'Yes / No / N/A',
    description: 'Three-state answer used across staging checklists.',
    values: ['Yes', 'No', 'N/A'],
  },
  PassFail: {
    apiName: 'PassFail',
    displayName: 'Pass / Fail',
    description: 'Binary inspection outcome for a single pallet.',
    values: ['Pass', 'Fail'],
  },
  QualityFlagReason: {
    apiName: 'QualityFlagReason',
    displayName: 'Quality Flag Reason',
    description: 'Why an inspector flagged a pallet, photo or load.',
    values: [
      'damaged_product',
      'wrong_or_missing_label',
      'wrong_batch_or_product_info',
      'quantity_discrepancy',
      'other',
    ],
    labels: {
      damaged_product: 'Damaged product / packaging',
      wrong_or_missing_label: 'Wrong or missing label',
      wrong_batch_or_product_info: 'Wrong batch / product info',
      quantity_discrepancy: 'Quantity discrepancy',
      other: 'Other',
    },
  },
  PhotoCategory: {
    apiName: 'PhotoCategory',
    displayName: 'Photo Category',
    description: 'What a captured inspection photo depicts.',
    values: [
      'Picklist',
      'BOL',
      'CoverSheet',
      'Pallet_Side',
      'Pallet_BagFlap',
      'Pallet_Placard',
      'Pallet_LPN',
      'Pallet_GateSeal',
      'Staging_Overview',
      'Returns_BOL',
      'Returns_Damage_Assessment',
      'Staging_Final_Lane',
    ],
  },
  UnitOfMeasure: {
    apiName: 'UnitOfMeasure',
    displayName: 'Unit of Measure',
    description: 'Unit a picklist line item is counted in.',
    values: ['BAG', 'SP', 'PCE'],
    labels: { BAG: 'Bag', SP: 'Seedpak', PCE: 'Piece' },
  },

  // ─── DockX ─────────────────────────────────────────────────────────
  AppointmentType: {
    apiName: 'AppointmentType',
    displayName: 'Appointment Type',
    description: 'Direction of freight for a dock appointment.',
    values: ['Inbound', 'Outbound'],
  },
  AppointmentStatus: {
    apiName: 'AppointmentStatus',
    displayName: 'Appointment Status',
    description: 'Progress of an appointment through the dock.',
    values: ['Scheduled', 'Checked In', 'Completed', 'Late', 'Missed'],
  },
  DoorDirection: {
    apiName: 'DoorDirection',
    displayName: 'Door Direction',
    description: 'Traffic a dock door accepts.',
    values: ['Inbound', 'Outbound', 'Both'],
  },
  DoorStatus: {
    apiName: 'DoorStatus',
    displayName: 'Door Status',
    description: 'Availability of a dock door.',
    values: ['Open', 'Occupied', 'Closed'],
  },
  PitTaskType: {
    apiName: 'PitTaskType',
    displayName: 'PIT Task Type',
    description: 'Kind of work a PIT operator performs for an appointment.',
    values: [
      'Inbound/outbound',
      'Outbound',
      'Inbound',
      'Pick',
      'Putaway',
      'Verify',
      'Return',
      'Retag',
    ],
  },
  PitTaskStatus: {
    apiName: 'PitTaskStatus',
    displayName: 'PIT Task Status',
    description: 'Progress of a PIT task.',
    values: ['Pending', 'In Progress', 'Completed'],
  },

  // ─── Operations Hub ────────────────────────────────────────────────
  Shift: {
    apiName: 'Shift',
    displayName: 'Shift',
    description: 'Shift an employee is scheduled on.',
    values: ['1st', '2nd'],
  },
  JobRole: {
    apiName: 'JobRole',
    displayName: 'Job Role',
    description: 'Role an employee performs on the floor.',
    values: [
      'CSR/Clerk',
      'Inventory',
      'PIT',
      'Lab',
      'Lead',
      'Supervisor',
      'Operations Manager',
    ],
  },
  SkillRating: {
    apiName: 'SkillRating',
    displayName: 'Skill Rating',
    description: 'Four-point proficiency scale used in skill assessments.',
    values: [1, 2, 3, 4],
    labels: {
      1: 'In-Training',
      2: 'Trained',
      3: 'Experienced',
      4: 'Expert',
    },
  },
  CoachingStatus: {
    apiName: 'CoachingStatus',
    displayName: 'Coaching Status',
    description: 'Whether a coaching opportunity is still being worked.',
    values: ['Open', 'Closed'],
  },
  EquipmentType: {
    apiName: 'EquipmentType',
    displayName: 'Equipment Type',
    description: 'Category of tracked equipment.',
    values: [
      'Forklift',
      'Reach Truck',
      'Pallet Jack',
      'RF Scanner',
      'Printer',
      'Other',
    ],
  },
  EquipmentStatus: {
    apiName: 'EquipmentStatus',
    displayName: 'Equipment Status',
    description: 'Availability of a piece of equipment.',
    values: ['Available', 'In Use', 'Under Maintenance', 'Out of Service'],
  },
} as const satisfies Record<string, ValueTypeDefinition>;

export type ValueTypeApiName = keyof typeof VALUE_TYPES;

/** Look up a value type definition by name. */
export function getValueType(apiName: string): ValueTypeDefinition | undefined {
  return (VALUE_TYPES as Record<string, ValueTypeDefinition>)[apiName];
}

/** Allowed values for a value type, or undefined when the name is unknown. */
export function getAllowedValues(
  apiName: string
): readonly (string | number)[] | undefined {
  return getValueType(apiName)?.values;
}

/** Display label for a value, falling back to the raw value. */
export function getValueLabel(apiName: string, value: string | number): string {
  const definition = getValueType(apiName);
  return String(definition?.labels?.[value] ?? value);
}

/** True when `value` is a member of the named value type. */
export function isAllowedValue(apiName: string, value: unknown): boolean {
  const values = getAllowedValues(apiName);
  if (!values) return false;
  return values.some((allowed) => allowed === value);
}
