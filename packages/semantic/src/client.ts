import type {
  StagingLaneObject,
  AppointmentObject,
  DoorObject,
  OperatorObject,
  PitTaskObject,
  EmployeeObject,
  SkillObject,
  EmployeeSkillObject,
  CoachingObject,
  ContactObject,
  EquipmentObject,
} from './types/ontology';

let _apiBase = '/api';
let _apiKey: string | undefined;

/** Call once at app startup to set the API base URL for the ontology client */
export function setOntologyApiBase(url: string): void {
  _apiBase = url || '/api';
}

/**
 * Optional: set the shared secret sent as `x-api-key` on every request. Only needed
 * when the backend has `API_SHARED_SECRET` configured; leave unset for local dev.
 */
export function setOntologyApiKey(key: string | undefined): void {
  _apiKey = key || undefined;
}

function api(path: string): string {
  return `${_apiBase}${path}`;
}

function headers(base?: Record<string, string>): Record<string, string> {
  const h: Record<string, string> = { ...base };
  if (_apiKey) h['x-api-key'] = _apiKey;
  return h;
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(api(path), { headers: headers() });
  if (!res.ok) throw new Error(`GET ${path} failed: ${res.status}`);
  return res.json();
}

async function post<T = void>(actionType: string, params: object): Promise<T> {
  const res = await fetch(api('/ontology/actions'), {
    method: 'POST',
    headers: headers({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ actionType, params }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Action ${actionType} failed: ${res.status}`);
  }
  const json = await res.json();
  return json.data as T;
}

export const ontologyClient = {
  // ─── Staging Lanes (gxo-loadout) ───────────────────────────────
  getStagingLanes: async (): Promise<StagingLaneObject[]> => {
    const data = await get<{ objects: StagingLaneObject[] }>('/ontology/staging-lanes');
    return data.objects;
  },

  executeAction: async (actionType: string, params: object): Promise<void> => {
    await post(actionType, params);
  },

  // ─── DockX: Appointments ──────────────────────────────────────
  getAppointments: async (status?: string): Promise<AppointmentObject[]> => {
    const qs = status ? `?status=${encodeURIComponent(status)}` : '';
    const data = await get<{ objects: AppointmentObject[] }>(`/ontology/appointments${qs}`);
    return data.objects;
  },

  getAppointmentStats: async (): Promise<{ total: number; checked_in: number; completed: number; late: number; missed: number; ib_count: number; ob_count: number }> => {
    return get('/ontology/appointment-stats');
  },

  createAppointment: async (params: {
    date: string; time: string; type: string; carrier: string;
    bolShipmentNo: string; customer: string; productType: string;
  }): Promise<AppointmentObject> => {
    return post<AppointmentObject>('CreateAppointment', params);
  },

  checkInAppointment: async (params: {
    appointmentId: number; doorId: number; operatorId: number;
  }): Promise<void> => {
    await post('CheckInAppointment', params);
  },

  checkOutAppointment: async (params: { appointmentId: number }): Promise<void> => {
    await post('CheckOutAppointment', params);
  },

  updateAppointment: async (params: { id: number; status?: string; doorName?: string; pickerName?: string; verifierName?: string }): Promise<void> => {
    await post('UpdateAppointment', params);
  },

  // ─── DockX: Metadata ──────────────────────────────────────────
  getDoors: async (): Promise<DoorObject[]> => {
    const data = await get<{ objects: DoorObject[] }>('/ontology/doors');
    return data.objects;
  },

  getOperators: async (): Promise<OperatorObject[]> => {
    const data = await get<{ objects: OperatorObject[] }>('/ontology/operators');
    return data.objects;
  },

  // ─── DockX: PIT Tasks ─────────────────────────────────────────
  getPitTasks: async (): Promise<PitTaskObject[]> => {
    const data = await get<{ objects: PitTaskObject[] }>('/ontology/pit-tasks');
    return data.objects;
  },

  createPitTask: async (params: { appointmentId: number; type: string }): Promise<void> => {
    await post('CreatePitTask', params);
  },

  startPitTask: async (params: { appointmentId: number; operatorName: string; type?: string }): Promise<void> => {
    await post('StartPitTask', params);
  },

  completePitTask: async (params: { appointmentId: number }): Promise<void> => {
    await post('CompletePitTask', params);
  },

  // ─── Operations-Hub: Employees ─────────────────────────────────
  getEmployees: async (): Promise<EmployeeObject[]> => {
    const data = await get<{ objects: EmployeeObject[] }>('/ontology/employees');
    return data.objects;
  },

  createEmployee: async (params: Partial<EmployeeObject['properties']>): Promise<EmployeeObject> => {
    return post<EmployeeObject>('CreateEmployee', params);
  },

  updateEmployee: async (params: Partial<EmployeeObject['properties']> & { id: number }): Promise<EmployeeObject> => {
    return post<EmployeeObject>('UpdateEmployee', params);
  },

  // ─── Operations-Hub: Skills ────────────────────────────────────
  getSkills: async (): Promise<SkillObject[]> => {
    const data = await get<{ objects: SkillObject[] }>('/ontology/skills');
    return data.objects;
  },

  createSkill: async (params: { name: string; jobRoles: string[]; process?: string; action?: string }): Promise<SkillObject> => {
    return post<SkillObject>('CreateSkill', params);
  },

  deleteSkill: async (params: { id: number }): Promise<void> => {
    await post('DeleteSkill', params);
  },

  // ─── Operations-Hub: Ratings ───────────────────────────────────
  getRatings: async (): Promise<EmployeeSkillObject[]> => {
    const data = await get<{ objects: EmployeeSkillObject[] }>('/ontology/ratings');
    return data.objects;
  },

  createRating: async (params: { employeeId: number; skill: string; rating: 1 | 2 | 3 | 4; notes?: string }): Promise<EmployeeSkillObject> => {
    return post<EmployeeSkillObject>('CreateRating', params);
  },

  updateRating: async (params: { id: number, rating: 1 | 2 | 3 | 4 }): Promise<void> => {
    await post('UpdateRating', params);
  },

  // ─── Operations-Hub: Coaching ──────────────────────────────────
  getCoaching: async (): Promise<CoachingObject[]> => {
    const data = await get<{ objects: CoachingObject[] }>('/ontology/coaching');
    return data.objects;
  },

  createCoaching: async (params: { title: string; employeeId: number; notes: string }): Promise<CoachingObject> => {
    return post<CoachingObject>('CreateCoaching', params);
  },

  updateCoachingStatus: async (params: { id: number, status: 'Open' | 'Closed' }): Promise<void> => {
    await post('UpdateCoachingStatus', params);
  },

  deleteCoaching: async (params: { id: number }): Promise<void> => {
    await post('DeleteCoaching', params);
  },

  // ─── Operations-Hub: Contacts ──────────────────────────────────
  getContacts: async (): Promise<ContactObject[]> => {
    const data = await get<{ objects: ContactObject[] }>('/ontology/contacts');
    return data.objects;
  },

  createContact: async (params: Omit<ContactObject['properties'], never>): Promise<ContactObject> => {
    return post<ContactObject>('CreateContact', params);
  },

  updateContact: async (params: ContactObject['properties'] & { id: number }): Promise<ContactObject> => {
    return post<ContactObject>('UpdateContact', params);
  },

  deleteContact: async (params: { id: number }): Promise<void> => {
    await post('DeleteContact', params);
  },

  // ─── Operations-Hub: Equipment ─────────────────────────────────
  getEquipments: async (): Promise<EquipmentObject[]> => {
    const data = await get<{ objects: EquipmentObject[] }>('/ontology/equipments');
    return data.objects;
  },

  createEquipment: async (params: Partial<EquipmentObject['properties']>): Promise<EquipmentObject> => {
    return post<EquipmentObject>('CreateEquipment', params);
  },

  updateEquipment: async (params: Partial<EquipmentObject['properties']> & { id: number }): Promise<EquipmentObject> => {
    return post<EquipmentObject>('UpdateEquipment', params);
  },

  deleteEquipment: async (params: { id: number }): Promise<void> => {
    await post('DeleteEquipment', params);
  },
};
