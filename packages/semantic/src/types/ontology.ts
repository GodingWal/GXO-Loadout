export interface SiteObject {
    id: string;
    objectType: 'Site';
    properties: {
        name: string;
        timezone: string;
        address: string | null;
    };
}

export interface StagingLaneObject {
    id: string;
    objectType: 'StagingLane';
    properties: {
        name: string;
        zoneCode: string;
        status: 'EMPTY' | 'STAGED' | 'RESERVED' | 'BLOCKED';
        coordinates: { x: number; y: number; width: number; length: number };
        currentLoadId: string | null;
        siteId: string | null;
    };
}

export interface LoadObject {
    id: string;
    objectType: 'Load';
    properties: {
        carrier: string;
        destination: string | null;
        expectedPalletCount: number;
        status: 'PENDING' | 'STAGED' | 'LOADING' | 'DISPATCHED';
        siteId: string | null;
    };
}

export interface PalletObject {
    id: string;
    objectType: 'Pallet';
    properties: {
        barcode: string;
        productType: string | null;
        packagingType: string | null;
        isFlagged: boolean;
        loadId: string | null;
        stagingLaneId: string | null;
    };
}

export interface InspectionObject {
    id: string;
    objectType: 'Inspection';
    properties: {
        inspectorName: string;
        timestamp: string;
        photos: string[];
        notes: string | null;
        result: string;
        loadId: string;
        palletId: string | null;
    };
}


export const LANE_STATUS = {
    EMPTY: 'EMPTY',
    STAGED: 'STAGED',
    BLOCKED: 'BLOCKED',
    RESERVED: 'RESERVED'
} as const;

export interface AssignLaneActionParams {
    laneId: string;
    loadId: string;
    status: string;
}

// ─── DockX Domain ────────────────────────────────────────────────

export interface AppointmentObject {
    id: number;
    objectType: 'Appointment';
    properties: {
        date: string;
        time: string;
        type: 'Inbound' | 'Outbound';
        carrier: string;
        bolShipmentNo: string;
        customer: string;
        productType: string;
        status: 'Scheduled' | 'Checked In' | 'Completed' | 'Late' | 'Missed';
        doorId: number | null;
        doorName: string | null;
        operatorId: number | null;
        operatorName: string | null;
        checkInTime: string | null;
        checkOutTime: string | null;
        dwellTime: string | null;
    };
}

export interface DoorObject {
    id: number;
    objectType: 'Door';
    properties: {
        name: string;
        direction: 'Inbound' | 'Outbound' | 'Both';
        status: 'Open' | 'Occupied' | 'Closed';
    };
}

export interface OperatorObject {
    id: number;
    objectType: 'Operator';
    properties: {
        name: string;
    };
}

export interface PitTaskObject {
    id: number;
    objectType: 'PitTask';
    properties: {
        appointmentId: number;
        bolShipmentNo: string;
        carrier: string;
        doorName: string | null;
        operatorName: string | null;
        status: 'Pending' | 'In Progress' | 'Completed';
        type: string;
        startedAt: string | null;
        completedAt: string | null;
    };
}

// ─── Operations-Hub Domain ───────────────────────────────────────

export type JobRole =
    | 'CSR/Clerk'
    | 'Inventory'
    | 'PIT'
    | 'Lab'
    | 'Lead'
    | 'Supervisor'
    | 'Operations Manager';

export interface EmployeeObject {
    id: number;
    objectType: 'Employee';
    properties: {
        fullName: string;
        firstName: string;
        lastName: string;
        email: string;
        shift: '1st' | '2nd';
        jobRole: JobRole;
        hireDate: string;
        active: boolean;
        photoUrl: string | null;
        shirtSize: string | null;
        birthday: string | null;
        cwr: boolean;
        phoneNumber: string | null;
        cwid: string | null;
        notes: string | null;
    };
}

export interface SkillObject {
    id: number;
    objectType: 'Skill';
    properties: {
        name: string;
        jobRoles: string[];
        process: string | null;
        action: string | null;
    };
}

export interface EmployeeSkillObject {
    id: number;
    objectType: 'EmployeeSkill';
    properties: {
        employeeId: number;
        skill: string;
        rating: 1 | 2 | 3 | 4;
        dateAssessed: string;
        assessedBy: string;
        notes: string | null;
    };
}

export interface CoachingObject {
    id: number;
    objectType: 'Coaching';
    properties: {
        employeeId: number;
        title: string;
        notes: string | null;
        status: 'Open' | 'Closed';
        dateOpened: string;
        dateClosed: string | null;
    };
}

export interface ContactObject {
    id: number;
    objectType: 'Contact';
    properties: {
        fullName: string;
        company: string;
        role: string;
        phone: string;
        email: string;
        category: string;
    };
}

export interface EquipmentObject {
    id: number;
    objectType: 'Equipment';
    properties: {
        name: string;
        type: 'Forklift' | 'Reach Truck' | 'Pallet Jack' | 'RF Scanner' | 'Printer' | 'Other';
        status: 'Available' | 'In Use' | 'Under Maintenance' | 'Out of Service';
        assignedToId: number | null;
        lastInspected: string | null;
        serialNumber: string;
        notes: string | null;
    };
}
