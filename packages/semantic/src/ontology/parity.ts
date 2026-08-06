// Compile-time parity between the ontology definitions and the hand-written
// TypeScript interfaces they describe.
//
// Nothing here runs. Each assertion fails `tsc` if a property is added to an
// interface without being declared in the ontology (or vice versa), and if a
// value type stops matching its string-literal union. That keeps the runtime
// registry and the compile-time types from silently drifting.

import type {
  AppointmentObject,
  CoachingObject,
  ContactObject,
  DoorObject,
  EmployeeObject,
  EmployeeSkillObject,
  EquipmentObject,
  InspectionObject,
  JobRole,
  LoadObject,
  OperatorObject,
  PalletObject,
  PitTaskObject,
  SiteObject,
  SkillObject,
  StagingLaneObject,
} from '../types/ontology';
import type {
  Inspection as LoadoutInspectionRecord,
  InspectionStatus,
  InspectionType,
  Inspector as InspectorRecord,
  PalletType,
  PassFail,
  PhotoCategory,
  QualityFlagReason,
  YesNoNA,
} from '../types/inspection';
import { OBJECT_TYPES } from './objectTypes';
import { VALUE_TYPES } from './valueTypes';

/** `true` when both unions have exactly the same members, else an error tuple. */
type SameMembers<A extends PropertyKey, B extends PropertyKey> = [
  Exclude<A, B>
] extends [never]
  ? [Exclude<B, A>] extends [never]
    ? true
    : ['missing from the ontology definition:', Exclude<B, A>]
  : ['declared in the ontology but not on the interface:', Exclude<A, B>];

type PropertyKeysOf<T extends { properties: object }> = keyof T['properties'];
type DefinedKeysOf<K extends keyof typeof OBJECT_TYPES> =
  keyof (typeof OBJECT_TYPES)[K]['properties'];

// ─── Object type property parity ─────────────────────────────────────

const site: SameMembers<DefinedKeysOf<'Site'>, PropertyKeysOf<SiteObject>> = true;
const stagingLane: SameMembers<
  DefinedKeysOf<'StagingLane'>,
  PropertyKeysOf<StagingLaneObject>
> = true;
const load: SameMembers<DefinedKeysOf<'Load'>, PropertyKeysOf<LoadObject>> = true;
const pallet: SameMembers<DefinedKeysOf<'Pallet'>, PropertyKeysOf<PalletObject>> = true;
const inspection: SameMembers<
  DefinedKeysOf<'Inspection'>,
  PropertyKeysOf<InspectionObject>
> = true;
const appointment: SameMembers<
  DefinedKeysOf<'Appointment'>,
  PropertyKeysOf<AppointmentObject>
> = true;
const door: SameMembers<DefinedKeysOf<'Door'>, PropertyKeysOf<DoorObject>> = true;
const operator: SameMembers<DefinedKeysOf<'Operator'>, PropertyKeysOf<OperatorObject>> = true;
const pitTask: SameMembers<DefinedKeysOf<'PitTask'>, PropertyKeysOf<PitTaskObject>> = true;
const employee: SameMembers<DefinedKeysOf<'Employee'>, PropertyKeysOf<EmployeeObject>> = true;
const skill: SameMembers<DefinedKeysOf<'Skill'>, PropertyKeysOf<SkillObject>> = true;
const employeeSkill: SameMembers<
  DefinedKeysOf<'EmployeeSkill'>,
  PropertyKeysOf<EmployeeSkillObject>
> = true;
const coaching: SameMembers<DefinedKeysOf<'Coaching'>, PropertyKeysOf<CoachingObject>> = true;
const contact: SameMembers<DefinedKeysOf<'Contact'>, PropertyKeysOf<ContactObject>> = true;
const equipment: SameMembers<DefinedKeysOf<'Equipment'>, PropertyKeysOf<EquipmentObject>> =
  true;

// Offline-first records: the primary key lives on the record itself rather than
// under a `properties` bag, so it is excluded before comparing.
const loadoutInspection: SameMembers<
  DefinedKeysOf<'LoadoutInspection'>,
  Exclude<keyof LoadoutInspectionRecord, 'id'>
> = true;
const inspector: SameMembers<
  DefinedKeysOf<'Inspector'>,
  Exclude<keyof InspectorRecord, 'id'>
> = true;

// ─── Value type parity ───────────────────────────────────────────────

const laneStatus: SameMembers<
  (typeof VALUE_TYPES)['LaneStatus']['values'][number],
  StagingLaneObject['properties']['status']
> = true;
const loadStatus: SameMembers<
  (typeof VALUE_TYPES)['LoadStatus']['values'][number],
  LoadObject['properties']['status']
> = true;
const appointmentType: SameMembers<
  (typeof VALUE_TYPES)['AppointmentType']['values'][number],
  AppointmentObject['properties']['type']
> = true;
const appointmentStatus: SameMembers<
  (typeof VALUE_TYPES)['AppointmentStatus']['values'][number],
  AppointmentObject['properties']['status']
> = true;
const doorDirection: SameMembers<
  (typeof VALUE_TYPES)['DoorDirection']['values'][number],
  DoorObject['properties']['direction']
> = true;
const doorStatus: SameMembers<
  (typeof VALUE_TYPES)['DoorStatus']['values'][number],
  DoorObject['properties']['status']
> = true;
const pitTaskStatus: SameMembers<
  (typeof VALUE_TYPES)['PitTaskStatus']['values'][number],
  PitTaskObject['properties']['status']
> = true;
const shift: SameMembers<
  (typeof VALUE_TYPES)['Shift']['values'][number],
  EmployeeObject['properties']['shift']
> = true;
const jobRole: SameMembers<(typeof VALUE_TYPES)['JobRole']['values'][number], JobRole> = true;
const skillRating: SameMembers<
  (typeof VALUE_TYPES)['SkillRating']['values'][number],
  EmployeeSkillObject['properties']['rating']
> = true;
const coachingStatus: SameMembers<
  (typeof VALUE_TYPES)['CoachingStatus']['values'][number],
  CoachingObject['properties']['status']
> = true;
const equipmentType: SameMembers<
  (typeof VALUE_TYPES)['EquipmentType']['values'][number],
  EquipmentObject['properties']['type']
> = true;
const equipmentStatus: SameMembers<
  (typeof VALUE_TYPES)['EquipmentStatus']['values'][number],
  EquipmentObject['properties']['status']
> = true;
const palletType: SameMembers<
  (typeof VALUE_TYPES)['PalletType']['values'][number],
  PalletType
> = true;
const inspectionType: SameMembers<
  (typeof VALUE_TYPES)['InspectionType']['values'][number],
  InspectionType
> = true;
const inspectionStatus: SameMembers<
  (typeof VALUE_TYPES)['InspectionStatus']['values'][number],
  InspectionStatus
> = true;
const yesNoNA: SameMembers<(typeof VALUE_TYPES)['YesNoNA']['values'][number], YesNoNA> = true;
const passFail: SameMembers<(typeof VALUE_TYPES)['PassFail']['values'][number], PassFail> =
  true;
const qualityFlagReason: SameMembers<
  (typeof VALUE_TYPES)['QualityFlagReason']['values'][number],
  QualityFlagReason
> = true;
const photoCategory: SameMembers<
  (typeof VALUE_TYPES)['PhotoCategory']['values'][number],
  PhotoCategory
> = true;

/** Keeps the assertions from being elided as unused declarations. */
export const ONTOLOGY_PARITY_CHECKS = [
  site,
  stagingLane,
  load,
  pallet,
  inspection,
  appointment,
  door,
  operator,
  pitTask,
  employee,
  skill,
  employeeSkill,
  coaching,
  contact,
  equipment,
  loadoutInspection,
  inspector,
  laneStatus,
  loadStatus,
  appointmentType,
  appointmentStatus,
  doorDirection,
  doorStatus,
  pitTaskStatus,
  shift,
  jobRole,
  skillRating,
  coachingStatus,
  equipmentType,
  equipmentStatus,
  palletType,
  inspectionType,
  inspectionStatus,
  yesNoNA,
  passFail,
  qualityFlagReason,
  photoCategory,
] as const;
