// Every way our data can change.
//
// All writes funnel through `POST /api/ontology/actions` with an `actionType`
// from this registry, so this file doubles as the API's write surface. The
// backend action registry in `apps/api/src/actions/index.ts` is typed against
// `ActionTypeApiName`, which means adding an entry here without a handler (or a
// handler without an entry here) fails the build.

import type { ActionTypeDefinition } from './types';

export const ACTION_TYPES = {
  // ─── Loadout ───────────────────────────────────────────────────────
  VerifyPallet: {
    apiName: 'VerifyPallet',
    displayName: 'Verify Pallet',
    description:
      'Check that every photo required for a pallet type has been captured before accepting the pallet.',
    domain: 'loadout',
    appliesTo: ['Pallet'],
    effects: [],
    parameters: {
      palletType: {
        apiName: 'palletType',
        displayName: 'Pallet Type',
        baseType: 'string',
        required: true,
        valueType: 'PalletType',
      },
      batchCount: {
        apiName: 'batchCount',
        displayName: 'Batch Count',
        baseType: 'integer',
        required: false,
        description: 'Number of batch sections on a mixed pallet (1-3).',
      },
      uploadedPhotos: {
        apiName: 'uploadedPhotos',
        displayName: 'Uploaded Photos',
        baseType: 'json',
        required: true,
        description: 'Map of photo slot key → photo URL or id.',
      },
    },
  },

  AssignLoadToLane: {
    apiName: 'AssignLoadToLane',
    displayName: 'Assign Load to Lane',
    description:
      'Stage a load in an available lane. Rejected when the lane is not EMPTY or RESERVED.',
    domain: 'loadout',
    appliesTo: ['StagingLane', 'Load'],
    effects: [{ objectType: 'StagingLane', kind: 'MODIFY' }],
    parameters: {
      laneId: {
        apiName: 'laneId',
        displayName: 'Lane',
        baseType: 'string',
        required: true,
        referencesObjectType: 'StagingLane',
      },
      loadId: {
        apiName: 'loadId',
        displayName: 'Load',
        baseType: 'string',
        required: true,
        referencesObjectType: 'Load',
      },
      status: {
        apiName: 'status',
        displayName: 'Status',
        baseType: 'string',
        required: false,
        valueType: 'LaneStatus',
        description: 'Requested lane status; the action stages as STAGED.',
      },
    },
  },

  // ─── DockX ─────────────────────────────────────────────────────────
  CreateAppointment: {
    apiName: 'CreateAppointment',
    displayName: 'Create Appointment',
    description: 'Schedule a new inbound or outbound dock appointment.',
    domain: 'dockx',
    appliesTo: ['Appointment'],
    effects: [{ objectType: 'Appointment', kind: 'CREATE' }],
    parameters: {
      date: {
        apiName: 'date',
        displayName: 'Date',
        baseType: 'date',
        required: true,
      },
      time: {
        apiName: 'time',
        displayName: 'Time',
        baseType: 'string',
        required: true,
      },
      type: {
        apiName: 'type',
        displayName: 'Type',
        baseType: 'string',
        required: true,
        valueType: 'AppointmentType',
      },
      carrier: {
        apiName: 'carrier',
        displayName: 'Carrier',
        baseType: 'string',
        required: true,
      },
      bolShipmentNo: {
        apiName: 'bolShipmentNo',
        displayName: 'BOL / Shipment #',
        baseType: 'string',
        required: true,
      },
      customer: {
        apiName: 'customer',
        displayName: 'Customer',
        baseType: 'string',
        required: true,
      },
      productType: {
        apiName: 'productType',
        displayName: 'Product Type',
        baseType: 'string',
        required: false,
      },
    },
  },

  UpdateAppointment: {
    apiName: 'UpdateAppointment',
    displayName: 'Update Appointment',
    description: 'Patch appointment fields such as status or assigned door.',
    domain: 'dockx',
    appliesTo: ['Appointment'],
    effects: [{ objectType: 'Appointment', kind: 'MODIFY' }],
    parameters: {
      id: {
        apiName: 'id',
        displayName: 'Appointment',
        baseType: 'integer',
        required: true,
        referencesObjectType: 'Appointment',
      },
      status: {
        apiName: 'status',
        displayName: 'Status',
        baseType: 'string',
        required: false,
        valueType: 'AppointmentStatus',
      },
      doorName: {
        apiName: 'doorName',
        displayName: 'Door Name',
        baseType: 'string',
        required: false,
      },
    },
  },

  CheckInAppointment: {
    apiName: 'CheckInAppointment',
    displayName: 'Check In Appointment',
    description:
      'Check a carrier in: occupy the door, record the operator and stamp the check-in time.',
    domain: 'dockx',
    appliesTo: ['Appointment', 'Door', 'Operator'],
    effects: [
      { objectType: 'Appointment', kind: 'MODIFY' },
      { objectType: 'Door', kind: 'MODIFY' },
    ],
    parameters: {
      appointmentId: {
        apiName: 'appointmentId',
        displayName: 'Appointment',
        baseType: 'integer',
        required: true,
        referencesObjectType: 'Appointment',
      },
      doorId: {
        apiName: 'doorId',
        displayName: 'Door',
        baseType: 'integer',
        required: false,
        referencesObjectType: 'Door',
      },
      operatorId: {
        apiName: 'operatorId',
        displayName: 'Operator',
        baseType: 'integer',
        required: false,
        referencesObjectType: 'Operator',
      },
    },
  },

  CheckOutAppointment: {
    apiName: 'CheckOutAppointment',
    displayName: 'Check Out Appointment',
    description:
      'Complete an appointment, stamp the check-out time and release the door.',
    domain: 'dockx',
    appliesTo: ['Appointment', 'Door'],
    effects: [
      { objectType: 'Appointment', kind: 'MODIFY' },
      { objectType: 'Door', kind: 'MODIFY' },
    ],
    parameters: {
      appointmentId: {
        apiName: 'appointmentId',
        displayName: 'Appointment',
        baseType: 'integer',
        required: true,
        referencesObjectType: 'Appointment',
      },
    },
  },

  CreatePitTask: {
    apiName: 'CreatePitTask',
    displayName: 'Create PIT Task',
    description: 'Queue PIT work for an appointment.',
    domain: 'dockx',
    appliesTo: ['PitTask', 'Appointment'],
    effects: [{ objectType: 'PitTask', kind: 'CREATE' }],
    parameters: {
      appointmentId: {
        apiName: 'appointmentId',
        displayName: 'Appointment',
        baseType: 'integer',
        required: true,
        referencesObjectType: 'Appointment',
      },
      type: {
        apiName: 'type',
        displayName: 'Type',
        baseType: 'string',
        required: false,
        valueType: 'PitTaskType',
      },
    },
  },

  StartPitTask: {
    apiName: 'StartPitTask',
    displayName: 'Start PIT Task',
    description:
      'Claim PIT work for an operator, creating the task if it was never queued.',
    domain: 'dockx',
    appliesTo: ['PitTask', 'Appointment'],
    effects: [
      { objectType: 'PitTask', kind: 'CREATE' },
      { objectType: 'PitTask', kind: 'MODIFY' },
    ],
    parameters: {
      appointmentId: {
        apiName: 'appointmentId',
        displayName: 'Appointment',
        baseType: 'integer',
        required: true,
        referencesObjectType: 'Appointment',
      },
      operatorName: {
        apiName: 'operatorName',
        displayName: 'Operator',
        baseType: 'string',
        required: true,
      },
      type: {
        apiName: 'type',
        displayName: 'Type',
        baseType: 'string',
        required: false,
        valueType: 'PitTaskType',
      },
    },
  },

  CompletePitTask: {
    apiName: 'CompletePitTask',
    displayName: 'Complete PIT Task',
    description: 'Mark PIT work finished and stamp the completion time.',
    domain: 'dockx',
    appliesTo: ['PitTask'],
    effects: [{ objectType: 'PitTask', kind: 'MODIFY' }],
    parameters: {
      appointmentId: {
        apiName: 'appointmentId',
        displayName: 'Appointment',
        baseType: 'integer',
        required: true,
        referencesObjectType: 'Appointment',
      },
    },
  },

  // ─── Operations Hub ────────────────────────────────────────────────
  CreateEmployee: {
    apiName: 'CreateEmployee',
    displayName: 'Create Employee',
    description: 'Add a team member to the roster.',
    domain: 'opshub',
    appliesTo: ['Employee'],
    effects: [{ objectType: 'Employee', kind: 'CREATE' }],
    parameters: {
      fullName: {
        apiName: 'fullName',
        displayName: 'Full Name',
        baseType: 'string',
        required: true,
      },
      firstName: {
        apiName: 'firstName',
        displayName: 'First Name',
        baseType: 'string',
        required: true,
      },
      lastName: {
        apiName: 'lastName',
        displayName: 'Last Name',
        baseType: 'string',
        required: true,
      },
      email: {
        apiName: 'email',
        displayName: 'Email',
        baseType: 'string',
        required: true,
      },
      hireDate: {
        apiName: 'hireDate',
        displayName: 'Hire Date',
        baseType: 'date',
        required: true,
      },
      shift: {
        apiName: 'shift',
        displayName: 'Shift',
        baseType: 'string',
        required: false,
        valueType: 'Shift',
      },
      jobRole: {
        apiName: 'jobRole',
        displayName: 'Job Role',
        baseType: 'string',
        required: false,
        valueType: 'JobRole',
      },
      active: {
        apiName: 'active',
        displayName: 'Active',
        baseType: 'boolean',
        required: false,
      },
      shirtSize: {
        apiName: 'shirtSize',
        displayName: 'Shirt Size',
        baseType: 'string',
        required: false,
      },
      birthday: {
        apiName: 'birthday',
        displayName: 'Birthday',
        baseType: 'date',
        required: false,
      },
      cwr: {
        apiName: 'cwr',
        displayName: 'CWR',
        baseType: 'boolean',
        required: false,
      },
      phoneNumber: {
        apiName: 'phoneNumber',
        displayName: 'Phone',
        baseType: 'string',
        required: false,
      },
      cwid: {
        apiName: 'cwid',
        displayName: 'CWID',
        baseType: 'string',
        required: false,
      },
      notes: {
        apiName: 'notes',
        displayName: 'Notes',
        baseType: 'string',
        required: false,
      },
    },
  },

  UpdateEmployee: {
    apiName: 'UpdateEmployee',
    displayName: 'Update Employee',
    description: 'Patch any editable field on an employee record.',
    domain: 'opshub',
    appliesTo: ['Employee'],
    effects: [{ objectType: 'Employee', kind: 'MODIFY' }],
    parameters: {
      id: {
        apiName: 'id',
        displayName: 'Employee',
        baseType: 'integer',
        required: true,
        referencesObjectType: 'Employee',
      },
      fullName: {
        apiName: 'fullName',
        displayName: 'Full Name',
        baseType: 'string',
        required: false,
      },
      firstName: {
        apiName: 'firstName',
        displayName: 'First Name',
        baseType: 'string',
        required: false,
      },
      lastName: {
        apiName: 'lastName',
        displayName: 'Last Name',
        baseType: 'string',
        required: false,
      },
      email: {
        apiName: 'email',
        displayName: 'Email',
        baseType: 'string',
        required: false,
      },
      shift: {
        apiName: 'shift',
        displayName: 'Shift',
        baseType: 'string',
        required: false,
        valueType: 'Shift',
      },
      jobRole: {
        apiName: 'jobRole',
        displayName: 'Job Role',
        baseType: 'string',
        required: false,
        valueType: 'JobRole',
      },
      hireDate: {
        apiName: 'hireDate',
        displayName: 'Hire Date',
        baseType: 'date',
        required: false,
      },
      active: {
        apiName: 'active',
        displayName: 'Active',
        baseType: 'boolean',
        required: false,
      },
      photoUrl: {
        apiName: 'photoUrl',
        displayName: 'Photo',
        baseType: 'string',
        required: false,
      },
      shirtSize: {
        apiName: 'shirtSize',
        displayName: 'Shirt Size',
        baseType: 'string',
        required: false,
      },
      birthday: {
        apiName: 'birthday',
        displayName: 'Birthday',
        baseType: 'date',
        required: false,
      },
      cwr: {
        apiName: 'cwr',
        displayName: 'CWR',
        baseType: 'boolean',
        required: false,
      },
      phoneNumber: {
        apiName: 'phoneNumber',
        displayName: 'Phone',
        baseType: 'string',
        required: false,
      },
      cwid: {
        apiName: 'cwid',
        displayName: 'CWID',
        baseType: 'string',
        required: false,
      },
      notes: {
        apiName: 'notes',
        displayName: 'Notes',
        baseType: 'string',
        required: false,
      },
    },
  },

  CreateSkill: {
    apiName: 'CreateSkill',
    displayName: 'Create Skill',
    description: 'Add a skill to the library.',
    domain: 'opshub',
    appliesTo: ['Skill'],
    effects: [{ objectType: 'Skill', kind: 'CREATE' }],
    parameters: {
      name: {
        apiName: 'name',
        displayName: 'Name',
        baseType: 'string',
        required: true,
      },
      jobRoles: {
        apiName: 'jobRoles',
        displayName: 'Job Roles',
        baseType: 'string[]',
        required: true,
      },
      process: {
        apiName: 'process',
        displayName: 'Process',
        baseType: 'string',
        required: false,
      },
      action: {
        apiName: 'action',
        displayName: 'Action',
        baseType: 'string',
        required: false,
      },
    },
  },

  DeleteSkill: {
    apiName: 'DeleteSkill',
    displayName: 'Delete Skill',
    description: 'Remove a skill from the library.',
    domain: 'opshub',
    appliesTo: ['Skill'],
    effects: [{ objectType: 'Skill', kind: 'DELETE' }],
    parameters: {
      id: {
        apiName: 'id',
        displayName: 'Skill',
        baseType: 'integer',
        required: true,
        referencesObjectType: 'Skill',
      },
    },
  },

  CreateRating: {
    apiName: 'CreateRating',
    displayName: 'Record Assessment',
    description: "Record an employee's proficiency in a skill.",
    domain: 'opshub',
    appliesTo: ['EmployeeSkill', 'Employee', 'Skill'],
    effects: [{ objectType: 'EmployeeSkill', kind: 'CREATE' }],
    parameters: {
      employeeId: {
        apiName: 'employeeId',
        displayName: 'Employee',
        baseType: 'integer',
        required: true,
        referencesObjectType: 'Employee',
      },
      skill: {
        apiName: 'skill',
        displayName: 'Skill',
        baseType: 'string',
        required: true,
      },
      rating: {
        apiName: 'rating',
        displayName: 'Rating',
        baseType: 'integer',
        required: true,
        valueType: 'SkillRating',
      },
      notes: {
        apiName: 'notes',
        displayName: 'Notes',
        baseType: 'string',
        required: false,
      },
    },
  },

  UpdateRating: {
    apiName: 'UpdateRating',
    displayName: 'Update Assessment',
    description: 'Change the score on an existing assessment.',
    domain: 'opshub',
    appliesTo: ['EmployeeSkill'],
    effects: [{ objectType: 'EmployeeSkill', kind: 'MODIFY' }],
    parameters: {
      id: {
        apiName: 'id',
        displayName: 'Assessment',
        baseType: 'integer',
        required: true,
        referencesObjectType: 'EmployeeSkill',
      },
      rating: {
        apiName: 'rating',
        displayName: 'Rating',
        baseType: 'integer',
        required: true,
        valueType: 'SkillRating',
      },
    },
  },

  CreateCoaching: {
    apiName: 'CreateCoaching',
    displayName: 'Open Coaching Opportunity',
    description: 'Open a coaching conversation for an employee.',
    domain: 'opshub',
    appliesTo: ['Coaching', 'Employee'],
    effects: [{ objectType: 'Coaching', kind: 'CREATE' }],
    parameters: {
      employeeId: {
        apiName: 'employeeId',
        displayName: 'Employee',
        baseType: 'integer',
        required: true,
        referencesObjectType: 'Employee',
      },
      title: {
        apiName: 'title',
        displayName: 'Title',
        baseType: 'string',
        required: true,
      },
      notes: {
        apiName: 'notes',
        displayName: 'Notes',
        baseType: 'string',
        required: false,
      },
    },
  },

  UpdateCoachingStatus: {
    apiName: 'UpdateCoachingStatus',
    displayName: 'Update Coaching Status',
    description:
      'Open or close a coaching opportunity; closing stamps the close date.',
    domain: 'opshub',
    appliesTo: ['Coaching'],
    effects: [{ objectType: 'Coaching', kind: 'MODIFY' }],
    parameters: {
      id: {
        apiName: 'id',
        displayName: 'Coaching Opportunity',
        baseType: 'integer',
        required: true,
        referencesObjectType: 'Coaching',
      },
      status: {
        apiName: 'status',
        displayName: 'Status',
        baseType: 'string',
        required: true,
        valueType: 'CoachingStatus',
      },
    },
  },

  DeleteCoaching: {
    apiName: 'DeleteCoaching',
    displayName: 'Delete Coaching Opportunity',
    description: 'Remove a coaching opportunity.',
    domain: 'opshub',
    appliesTo: ['Coaching'],
    effects: [{ objectType: 'Coaching', kind: 'DELETE' }],
    parameters: {
      id: {
        apiName: 'id',
        displayName: 'Coaching Opportunity',
        baseType: 'integer',
        required: true,
        referencesObjectType: 'Coaching',
      },
    },
  },

  CreateContact: {
    apiName: 'CreateContact',
    displayName: 'Create Contact',
    description: 'Add a contact to the directory.',
    domain: 'opshub',
    appliesTo: ['Contact'],
    effects: [{ objectType: 'Contact', kind: 'CREATE' }],
    parameters: {
      fullName: {
        apiName: 'fullName',
        displayName: 'Full Name',
        baseType: 'string',
        required: true,
      },
      company: {
        apiName: 'company',
        displayName: 'Company',
        baseType: 'string',
        required: true,
      },
      role: {
        apiName: 'role',
        displayName: 'Role',
        baseType: 'string',
        required: true,
      },
      phone: {
        apiName: 'phone',
        displayName: 'Phone',
        baseType: 'string',
        required: true,
      },
      email: {
        apiName: 'email',
        displayName: 'Email',
        baseType: 'string',
        required: false,
      },
      category: {
        apiName: 'category',
        displayName: 'Category',
        baseType: 'string',
        required: false,
      },
    },
  },

  UpdateContact: {
    apiName: 'UpdateContact',
    displayName: 'Update Contact',
    description: 'Patch a contact record.',
    domain: 'opshub',
    appliesTo: ['Contact'],
    effects: [{ objectType: 'Contact', kind: 'MODIFY' }],
    parameters: {
      id: {
        apiName: 'id',
        displayName: 'Contact',
        baseType: 'integer',
        required: true,
        referencesObjectType: 'Contact',
      },
      fullName: {
        apiName: 'fullName',
        displayName: 'Full Name',
        baseType: 'string',
        required: false,
      },
      company: {
        apiName: 'company',
        displayName: 'Company',
        baseType: 'string',
        required: false,
      },
      role: {
        apiName: 'role',
        displayName: 'Role',
        baseType: 'string',
        required: false,
      },
      phone: {
        apiName: 'phone',
        displayName: 'Phone',
        baseType: 'string',
        required: false,
      },
      email: {
        apiName: 'email',
        displayName: 'Email',
        baseType: 'string',
        required: false,
      },
      category: {
        apiName: 'category',
        displayName: 'Category',
        baseType: 'string',
        required: false,
      },
    },
  },

  DeleteContact: {
    apiName: 'DeleteContact',
    displayName: 'Delete Contact',
    description: 'Remove a contact from the directory.',
    domain: 'opshub',
    appliesTo: ['Contact'],
    effects: [{ objectType: 'Contact', kind: 'DELETE' }],
    parameters: {
      id: {
        apiName: 'id',
        displayName: 'Contact',
        baseType: 'integer',
        required: true,
        referencesObjectType: 'Contact',
      },
    },
  },

  CreateEquipment: {
    apiName: 'CreateEquipment',
    displayName: 'Create Equipment',
    description: 'Register a piece of equipment.',
    domain: 'opshub',
    appliesTo: ['Equipment'],
    effects: [{ objectType: 'Equipment', kind: 'CREATE' }],
    parameters: {
      name: {
        apiName: 'name',
        displayName: 'Name',
        baseType: 'string',
        required: true,
      },
      serialNumber: {
        apiName: 'serialNumber',
        displayName: 'Serial Number',
        baseType: 'string',
        required: true,
      },
      type: {
        apiName: 'type',
        displayName: 'Type',
        baseType: 'string',
        required: false,
        valueType: 'EquipmentType',
      },
      status: {
        apiName: 'status',
        displayName: 'Status',
        baseType: 'string',
        required: false,
        valueType: 'EquipmentStatus',
      },
      assignedToId: {
        apiName: 'assignedToId',
        displayName: 'Assigned To',
        baseType: 'integer',
        required: false,
        referencesObjectType: 'Employee',
      },
      lastInspected: {
        apiName: 'lastInspected',
        displayName: 'Last Inspected',
        baseType: 'date',
        required: false,
      },
      notes: {
        apiName: 'notes',
        displayName: 'Notes',
        baseType: 'string',
        required: false,
      },
    },
  },

  UpdateEquipment: {
    apiName: 'UpdateEquipment',
    displayName: 'Update Equipment',
    description: 'Patch an equipment record, including assignment and status.',
    domain: 'opshub',
    appliesTo: ['Equipment', 'Employee'],
    effects: [{ objectType: 'Equipment', kind: 'MODIFY' }],
    parameters: {
      id: {
        apiName: 'id',
        displayName: 'Equipment',
        baseType: 'integer',
        required: true,
        referencesObjectType: 'Equipment',
      },
      name: {
        apiName: 'name',
        displayName: 'Name',
        baseType: 'string',
        required: false,
      },
      type: {
        apiName: 'type',
        displayName: 'Type',
        baseType: 'string',
        required: false,
        valueType: 'EquipmentType',
      },
      status: {
        apiName: 'status',
        displayName: 'Status',
        baseType: 'string',
        required: false,
        valueType: 'EquipmentStatus',
      },
      assignedToId: {
        apiName: 'assignedToId',
        displayName: 'Assigned To',
        baseType: 'integer',
        required: false,
        referencesObjectType: 'Employee',
      },
      lastInspected: {
        apiName: 'lastInspected',
        displayName: 'Last Inspected',
        baseType: 'date',
        required: false,
      },
      serialNumber: {
        apiName: 'serialNumber',
        displayName: 'Serial Number',
        baseType: 'string',
        required: false,
      },
      notes: {
        apiName: 'notes',
        displayName: 'Notes',
        baseType: 'string',
        required: false,
      },
    },
  },

  DeleteEquipment: {
    apiName: 'DeleteEquipment',
    displayName: 'Delete Equipment',
    description: 'Remove an equipment record.',
    domain: 'opshub',
    appliesTo: ['Equipment'],
    effects: [{ objectType: 'Equipment', kind: 'DELETE' }],
    parameters: {
      id: {
        apiName: 'id',
        displayName: 'Equipment',
        baseType: 'integer',
        required: true,
        referencesObjectType: 'Equipment',
      },
    },
  },
} as const satisfies Record<string, ActionTypeDefinition>;

export type ActionTypeApiName = keyof typeof ACTION_TYPES;
