import { HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import {
  getObjectTypeByApiPath,
  getOntologyMetadata,
  listReadableApiPaths,
} from '@gxo/semantic';
import { db as prisma } from '../database';

/**
 * Maps a Prisma row into the standardized SDK object for its object type.
 * One entry per readable object type in the ontology; `objectTypeMappers` is
 * keyed by the object type's `apiPath`, which is what the route carries.
 */
const objectTypeMappers: Record<string, (req: HttpRequest) => Promise<any[]>> = {
  'sites': async () => {
    const sites = await prisma.site.findMany();
    return sites.map((s: any) => ({
      id: s.id,
      objectType: 'Site',
      properties: { name: s.name, timezone: s.timezone, address: s.address },
    }));
  },

  'staging-lanes': async () => {
    const lanes = await prisma.stagingLane.findMany();
    return lanes.map((lane: any) => ({
      id: lane.id,
      objectType: 'StagingLane',
      properties: {
        name: lane.name,
        zoneCode: lane.zoneCode,
        status: lane.status,
        coordinates: { x: lane.x, y: lane.y, width: lane.width, length: lane.length },
        currentLoadId: lane.currentLoadId,
        siteId: lane.siteId,
      },
    }));
  },

  'loads': async () => {
    const loads = await prisma.load.findMany();
    return loads.map((l: any) => ({
      id: l.id,
      objectType: 'Load',
      properties: {
        carrier: l.carrier,
        destination: l.destination,
        expectedPalletCount: l.expectedPalletCount,
        status: l.status,
        siteId: l.siteId,
      },
    }));
  },

  'pallets': async () => {
    const pallets = await prisma.pallet.findMany();
    return pallets.map((p: any) => ({
      id: p.id,
      objectType: 'Pallet',
      properties: {
        barcode: p.barcode,
        productType: p.productType,
        packagingType: p.packagingType,
        isFlagged: p.isFlagged,
        loadId: p.loadId,
        stagingLaneId: p.stagingLaneId,
      },
    }));
  },

  'inspections': async () => {
    const inspections = await prisma.inspection.findMany();
    return inspections.map((i: any) => ({
      id: i.id,
      objectType: 'Inspection',
      properties: {
        inspectorName: i.inspectorName,
        timestamp: i.timestamp,
        photos: i.photosJson ? JSON.parse(i.photosJson) : [],
        notes: i.notes,
        result: i.result,
        loadId: i.loadId,
        palletId: i.palletId,
      },
    }));
  },

  'appointments': async (req: HttpRequest) => {
    const statusFilter = req.query.get('status');
    const appointments = await prisma.appointment.findMany(
      statusFilter ? { where: { status: statusFilter } } : undefined
    );
    return appointments.map((a: any) => ({
      id: a.id,
      objectType: 'Appointment',
      properties: {
        date: a.date, time: a.time, type: a.type, carrier: a.carrier,
        bolShipmentNo: a.bolShipmentNo, customer: a.customer, productType: a.productType,
        status: a.status, doorId: a.doorId, doorName: a.doorName, operatorId: a.operatorId,
        operatorName: a.operatorName, checkInTime: a.checkInTime, checkOutTime: a.checkOutTime,
        dwellTime: a.dwellTime,
      },
    }));
  },

  'doors': async () => {
    const doors = await prisma.door.findMany();
    return doors.map((d: any) => ({
      id: d.id,
      objectType: 'Door',
      properties: { name: d.name, direction: d.direction, status: d.status },
    }));
  },

  'operators': async () => {
    const operators = await prisma.operator.findMany();
    return operators.map((o: any) => ({
      id: o.id,
      objectType: 'Operator',
      properties: { name: o.name },
    }));
  },

  'pit-tasks': async () => {
    // bolShipmentNo, carrier and doorName are denormalized onto the PIT task so
    // the board can render a row without a second round-trip.
    const tasks = await prisma.pitTask.findMany({ include: { appointment: true } });
    return tasks.map((t: any) => ({
      id: t.id,
      objectType: 'PitTask',
      properties: {
        appointmentId: t.appointmentId,
        bolShipmentNo: t.appointment?.bolShipmentNo ?? '',
        carrier: t.appointment?.carrier ?? '',
        doorName: t.appointment?.doorName ?? null,
        operatorName: t.operatorName,
        status: t.status,
        type: t.type,
        startedAt: t.startedAt,
        completedAt: t.completedAt,
      },
    }));
  },

  'employees': async () => {
    const employees = await prisma.employee.findMany();
    return employees.map((e: any) => ({
      id: e.id,
      objectType: 'Employee',
      properties: {
        fullName: e.fullName, firstName: e.firstName, lastName: e.lastName, email: e.email,
        shift: e.shift, jobRole: e.jobRole, hireDate: e.hireDate, active: e.active,
        photoUrl: e.photoUrl, shirtSize: e.shirtSize, birthday: e.birthday, cwr: e.cwr,
        phoneNumber: e.phoneNumber, cwid: e.cwid, notes: e.notes,
      },
    }));
  },

  'skills': async () => {
    const skills = await prisma.skill.findMany();
    return skills.map((s: any) => ({
      id: s.id,
      objectType: 'Skill',
      properties: {
        name: s.name,
        jobRoles: JSON.parse(s.jobRoles),
        process: s.process,
        action: s.action,
      },
    }));
  },

  'ratings': async () => {
    const ratings = await prisma.employeeSkillRating.findMany();
    return ratings.map((r: any) => ({
      id: r.id,
      objectType: 'EmployeeSkill',
      properties: {
        employeeId: r.employeeId, skill: r.skill, rating: r.rating,
        dateAssessed: r.dateAssessed, assessedBy: r.assessedBy, notes: r.notes,
      },
    }));
  },

  'coaching': async () => {
    const coaching = await prisma.coaching.findMany();
    return coaching.map((c: any) => ({
      id: c.id,
      objectType: 'Coaching',
      properties: {
        employeeId: c.employeeId, title: c.title, notes: c.notes,
        status: c.status, dateOpened: c.dateOpened, dateClosed: c.dateClosed,
      },
    }));
  },

  'contacts': async () => {
    const contacts = await prisma.contact.findMany();
    return contacts.map((c: any) => ({
      id: c.id,
      objectType: 'Contact',
      properties: {
        fullName: c.fullName, company: c.company, role: c.role,
        phone: c.phone, email: c.email, category: c.category,
      },
    }));
  },

  'equipments': async () => {
    const equipments = await prisma.equipment.findMany();
    return equipments.map((e: any) => ({
      id: e.id,
      objectType: 'Equipment',
      properties: {
        name: e.name, type: e.type, status: e.status, assignedToId: e.assignedToId,
        lastInspected: e.lastInspected, serialNumber: e.serialNumber, notes: e.notes,
      },
    }));
  },
};

export async function getOntologyHandler(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  const objectType = req.params.objectType;

  try {
    // `GET /api/ontology/$metadata` describes the ontology itself: every object
    // type, link, action and value type the system understands.
    if (objectType === '$metadata') {
      return { status: 200, jsonBody: getOntologyMetadata() };
    }

    const definition = getObjectTypeByApiPath(objectType);
    if (!definition) {
      return {
        status: 404,
        jsonBody: {
          error: `Object type '${objectType}' is not part of the ontology`,
          supported: listReadableApiPaths(),
        },
      };
    }

    const mapper = objectTypeMappers[definition.apiPath as string];
    if (!mapper) {
      return {
        status: 501,
        jsonBody: {
          error: `Object type '${definition.apiName}' is declared in the ontology but has no read implementation`,
        },
      };
    }

    const objects = await mapper(req);
    return { status: 200, jsonBody: { objectType: definition.apiName, objects } };
  } catch (error: any) {
    context.error(error);
    return { status: 500, jsonBody: { error: 'Internal server error' } };
  }
}
