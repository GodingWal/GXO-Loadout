import { HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { db as prisma } from '../database';
import { checkAuth } from './auth';

// A read resolver turns an incoming request into the JSON body to return. Most
// resolvers emit `{ objects: [...] }`; a few (e.g. stats) return a plain object.
type Resolver = (req: HttpRequest) => Promise<unknown>;

/** Tolerantly parse a JSON string column into a string[] (never throws). */
function safeParseArray(json: string | null | undefined): string[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// ─── Row → SDK object mappers ─────────────────────────────────────
const mapStagingLane = (l: any) => ({
  id: l.id,
  objectType: 'StagingLane',
  properties: {
    name: l.name, zoneCode: l.zoneCode, status: l.status,
    coordinates: { x: l.x, y: l.y, width: l.width, length: l.length },
    currentLoadId: l.currentLoadId,
  },
});

const mapAppointment = (a: any) => ({
  id: a.id,
  objectType: 'Appointment',
  properties: {
    date: a.date, time: a.time, type: a.type, carrier: a.carrier,
    bolShipmentNo: a.bolShipmentNo, customer: a.customer, productType: a.productType,
    status: a.status, doorId: a.doorId, doorName: a.doorName, operatorId: a.operatorId,
    operatorName: a.operatorName, checkInTime: a.checkInTime, checkOutTime: a.checkOutTime,
    dwellTime: a.dwellTime, pickerName: a.pickerName, verifierName: a.verifierName,
  },
});

const mapDoor = (d: any) => ({
  id: d.id, objectType: 'Door',
  properties: { name: d.name, direction: d.direction, status: d.status },
});

const mapOperator = (o: any) => ({
  id: o.id, objectType: 'Operator', properties: { name: o.name },
});

const mapPitTask = (t: any) => ({
  id: t.id, objectType: 'PitTask',
  properties: {
    appointmentId: t.appointmentId, operatorName: t.operatorName, status: t.status,
    type: t.type, startedAt: t.startedAt, completedAt: t.completedAt,
  },
});

const mapEmployee = (e: any) => ({
  id: e.id, objectType: 'Employee',
  properties: {
    fullName: e.fullName, firstName: e.firstName, lastName: e.lastName, email: e.email,
    shift: e.shift, jobRole: e.jobRole, hireDate: e.hireDate, active: e.active,
    photoUrl: e.photoUrl, shirtSize: e.shirtSize, birthday: e.birthday, cwr: e.cwr,
    phoneNumber: e.phoneNumber, cwid: e.cwid, notes: e.notes,
  },
});

const mapSkill = (s: any) => ({
  id: s.id, objectType: 'Skill',
  properties: { name: s.name, jobRoles: safeParseArray(s.jobRoles), process: s.process, action: s.action },
});

const mapRating = (r: any) => ({
  id: r.id, objectType: 'EmployeeSkill',
  properties: {
    employeeId: r.employeeId, skill: r.skill, rating: r.rating,
    dateAssessed: r.dateAssessed, assessedBy: r.assessedBy, notes: r.notes,
  },
});

const mapCoaching = (c: any) => ({
  id: c.id, objectType: 'Coaching',
  properties: {
    employeeId: c.employeeId, title: c.title, notes: c.notes, status: c.status,
    dateOpened: c.dateOpened, dateClosed: c.dateClosed,
  },
});

const mapContact = (c: any) => ({
  id: c.id, objectType: 'Contact',
  properties: {
    fullName: c.fullName, company: c.company, role: c.role, phone: c.phone,
    email: c.email, category: c.category,
  },
});

const mapEquipment = (e: any) => ({
  id: e.id, objectType: 'Equipment',
  properties: {
    name: e.name, type: e.type, status: e.status, assignedToId: e.assignedToId,
    lastInspected: e.lastInspected, serialNumber: e.serialNumber, notes: e.notes,
  },
});

/** Aggregate appointment counts for the DockX dashboard KPI boxes. */
async function computeAppointmentStats() {
  const appts = await prisma.appointment.findMany();
  const count = (pred: (a: any) => boolean) => appts.filter(pred).length;
  return {
    total: appts.length,
    checked_in: count((a) => a.status === 'Checked In'),
    completed: count((a) => a.status === 'Completed'),
    late: count((a) => a.status === 'Late'),
    missed: count((a) => a.status === 'Missed'),
    ib_count: count((a) => a.type === 'Inbound'),
    ob_count: count((a) => a.type === 'Outbound'),
  };
}

// ─── Read registry ────────────────────────────────────────────────
// Declarative map of objectType → resolver, mirroring the write-side actionRegistry.
const readRegistry: Record<string, Resolver> = {
  'staging-lanes': async () => ({ objects: (await prisma.stagingLane.findMany()).map(mapStagingLane) }),
  'appointments': async (req) => {
    const status = req.query.get('status');
    const rows = await prisma.appointment.findMany(status ? { where: { status } } : undefined);
    return { objects: rows.map(mapAppointment) };
  },
  'appointment-stats': async () => computeAppointmentStats(),
  'doors': async () => ({ objects: (await prisma.door.findMany()).map(mapDoor) }),
  'operators': async () => ({ objects: (await prisma.operator.findMany()).map(mapOperator) }),
  'pit-tasks': async () => ({ objects: (await prisma.pitTask.findMany()).map(mapPitTask) }),
  'employees': async () => ({ objects: (await prisma.employee.findMany()).map(mapEmployee) }),
  'skills': async () => ({ objects: (await prisma.skill.findMany()).map(mapSkill) }),
  'ratings': async () => ({ objects: (await prisma.employeeSkillRating.findMany()).map(mapRating) }),
  'coaching': async () => ({ objects: (await prisma.coaching.findMany()).map(mapCoaching) }),
  'contacts': async () => ({ objects: (await prisma.contact.findMany()).map(mapContact) }),
  'equipments': async () => ({ objects: (await prisma.equipment.findMany()).map(mapEquipment) }),
};

export async function getOntologyHandler(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  const denied = checkAuth(req);
  if (denied) return denied;

  const objectType = req.params.objectType;
  const resolver = readRegistry[objectType];
  if (!resolver) {
    return { status: 404, jsonBody: { error: 'Object type not supported' } };
  }

  try {
    return { status: 200, jsonBody: await resolver(req) };
  } catch (error: any) {
    context.error(error);
    return { status: 500, jsonBody: { error: 'Internal server error' } };
  }
}
