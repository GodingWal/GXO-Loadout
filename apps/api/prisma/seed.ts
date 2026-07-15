import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding database with exact Albert Lea Staging Lanes layout...');

  // Create Site
  const site = await prisma.site.upsert({
    where: { id: 'site-albert-lea' },
    update: {},
    create: {
      id: 'site-albert-lea',
      name: 'Albert Lea Facility',
      timezone: 'America/Chicago',
    }
  });

  const lanesToCreate = [];

  // ================= EAST WAREHOUSE =================
  // Main Center: STG01 - STG30 (Vertical)
  for (let i = 1; i <= 30; i++) {
    const name = `STG${i.toString().padStart(2, '0')}`;
    lanesToCreate.push({
      id: `lane-${name}`, name, zoneCode: 'EAST', status: 'EMPTY', siteId: site.id,
      x: i, y: 10, width: 1, length: 10
    });
  }

  // Top Right: STG31B-33B (Horizontal)
  for (let i = 1; i <= 3; i++) {
    const name = `STG${30 + i}B`;
    lanesToCreate.push({
      id: `lane-${name}`, name, zoneCode: 'EAST', status: 'EMPTY', siteId: site.id,
      x: 35, y: i * 2, width: 6, length: 1
    });
  }

  // Top Right: STG31A-33A (Horizontal)
  for (let i = 1; i <= 3; i++) {
    const name = `STG${30 + i}A`;
    lanesToCreate.push({
      id: `lane-${name}`, name, zoneCode: 'EAST', status: 'EMPTY', siteId: site.id,
      x: 45, y: i * 2, width: 6, length: 1
    });
  }

  // ================= WEST WAREHOUSE =================
  // STW01 - STW17
  for (let i = 1; i <= 17; i++) {
    const name = `STW${i.toString().padStart(2, '0')}`;
    const isWall = [6, 11].includes(i);
    lanesToCreate.push({
      id: `lane-${name}`, name, zoneCode: 'WEST', status: isWall ? 'BLOCKED' : 'EMPTY', siteId: site.id,
      x: i, y: 30, width: 1, length: 10
    });
  }

  // STW18 - STW42
  for (let i = 18; i <= 42; i++) {
    const name = `STW${i.toString().padStart(2, '0')}`;
    const isWall = [20, 25, 31, 36].includes(i);
    lanesToCreate.push({
      id: `lane-${name}`, name, zoneCode: 'WEST', status: isWall ? 'BLOCKED' : 'EMPTY', siteId: site.id,
      x: i + 2, y: 30, width: 1, length: 10 // +2 for physical wall gap
    });
  }

  // UPSERT ALL
  for (const lane of lanesToCreate) {
    await prisma.stagingLane.upsert({
      where: { id: lane.id },
      update: {
        x: lane.x, y: lane.y, width: lane.width, length: lane.length, 
        zoneCode: lane.zoneCode, status: lane.status
      },
      create: lane
    });
  }

  console.log(`Successfully seeded ${lanesToCreate.length} precise staging lanes!`);

  // ─── DockX: Doors ──────────────────────────────────────────
  await prisma.door.createMany({
    data: [
      { id: 1, name: 'Door 1', direction: 'Inbound', status: 'Open' },
      { id: 2, name: 'Door 2', direction: 'Inbound', status: 'Open' },
      { id: 3, name: 'Door 3', direction: 'Outbound', status: 'Open' },
      { id: 4, name: 'Door 4', direction: 'Outbound', status: 'Open' },
      { id: 5, name: 'Door 5', direction: 'Both', status: 'Closed' },
    ],
  });
  console.log('Seeded doors.');

  // ─── DockX: Operators ──────────────────────────────────────
  await prisma.operator.createMany({
    data: [
      { id: 1, name: 'Mike Thompson' },
      { id: 2, name: 'Sarah Garcia' },
      { id: 3, name: 'James Lee' },
    ],
  });
  console.log('Seeded operators.');

  // ─── Operations-Hub: Employees ─────────────────────────────
  await prisma.employee.createMany({
    data: [
      { id: 1, fullName: 'Alice Johnson', firstName: 'Alice', lastName: 'Johnson', email: 'ajohnson@gxo.com', shift: '1st', jobRole: 'CSR/Clerk', hireDate: '2023-01-15', active: true, phoneNumber: '(507) 555-0101', shirtSize: 'M' },
      { id: 2, fullName: 'Bob Williams', firstName: 'Bob', lastName: 'Williams', email: 'bwilliams@gxo.com', shift: '2nd', jobRole: 'Inventory', hireDate: '2022-08-20', active: true, phoneNumber: '(507) 555-0102', cwid: 'CW-1002' },
      { id: 3, fullName: 'Carol Martinez', firstName: 'Carol', lastName: 'Martinez', email: 'cmartinez@gxo.com', shift: '1st', jobRole: 'Lead', hireDate: '2021-03-10', active: true, shirtSize: 'L', cwid: 'CW-1003' },
      { id: 4, fullName: 'David Brown', firstName: 'David', lastName: 'Brown', email: 'dbrown@gxo.com', shift: '2nd', jobRole: 'PIT', hireDate: '2023-06-01', active: true, cwr: true },
      { id: 5, fullName: 'Emma Davis', firstName: 'Emma', lastName: 'Davis', email: 'edavis@gxo.com', shift: '1st', jobRole: 'Lab', hireDate: '2022-11-14', active: true, phoneNumber: '(507) 555-0105', cwid: 'CW-1005' },
      { id: 6, fullName: 'Frank Miller', firstName: 'Frank', lastName: 'Miller', email: 'fmiller@gxo.com', shift: '2nd', jobRole: 'Supervisor', hireDate: '2020-05-22', active: true, shirtSize: 'XL', cwid: 'CW-1006' },
      { id: 7, fullName: 'Grace Wilson', firstName: 'Grace', lastName: 'Wilson', email: 'gwilson@gxo.com', shift: '1st', jobRole: 'CSR/Clerk', hireDate: '2024-01-08', active: true, cwid: 'CW-1007' },
      { id: 8, fullName: 'Henry Taylor', firstName: 'Henry', lastName: 'Taylor', email: 'htaylor@gxo.com', shift: '2nd', jobRole: 'Inventory', hireDate: '2023-09-15', active: false, phoneNumber: '(507) 555-0108', cwid: 'CW-1008' },
    ],
  });
  console.log('Seeded employees.');

  // ─── Operations-Hub: Skills ────────────────────────────────
  await prisma.skill.createMany({
    data: [
      { id: 1, name: 'Inbound - Verification', jobRoles: JSON.stringify(['CSR/Clerk', 'Lead']), process: 'Inbound', action: 'Verify incoming shipments against manifests and system records' },
      { id: 2, name: 'Inbound - Putaway', jobRoles: JSON.stringify(['Inventory', 'PIT', 'Lead']), process: 'Inbound', action: 'Move received goods to assigned storage locations' },
      { id: 3, name: 'Outbound - Picking', jobRoles: JSON.stringify(['CSR/Clerk', 'Inventory', 'PIT', 'Lead']), process: 'Outbound', action: 'Accurately pick items from warehouse locations for orders' },
      { id: 4, name: 'Outbound - Packing', jobRoles: JSON.stringify(['CSR/Clerk', 'Inventory', 'Lead']), process: 'Outbound', action: 'Pack orders according to customer and product requirements' },
      { id: 5, name: 'Quality - Inspection', jobRoles: JSON.stringify(['Lab', 'Lead', 'Supervisor']), process: 'Quality', action: 'Inspect products for damage, expiration, and conformance' },
      { id: 6, name: 'Inventory - Cycle Count', jobRoles: JSON.stringify(['Inventory', 'Lead', 'Supervisor']), process: 'Inventory', action: 'Perform periodic cycle counts to maintain inventory accuracy' },
      { id: 7, name: 'Equipment - Forklift', jobRoles: JSON.stringify(['PIT', 'Inventory']), process: 'Equipment', action: 'Safely operate forklift equipment for material movement' },
      { id: 8, name: 'Returns Processing', jobRoles: JSON.stringify(['CSR/Clerk', 'Lab', 'Lead']), process: 'Returns', action: 'Process returned goods including inspection and disposition' },
      { id: 9, name: 'Hazardous Materials', jobRoles: JSON.stringify(['Lab', 'Supervisor']), process: 'Compliance', action: 'Handle and store hazardous materials per regulatory requirements' },
      { id: 10, name: 'WMS - System Navigation', jobRoles: JSON.stringify(['CSR/Clerk', 'Inventory', 'PIT', 'Lab', 'Lead', 'Supervisor', 'Operations Manager']), process: 'Systems', action: 'Navigate and operate the Warehouse Management System' },
    ],
  });
  console.log('Seeded skills.');

  // ─── Operations-Hub: Ratings ───────────────────────────────
  await prisma.employeeSkillRating.createMany({
    data: [
      { id: 1, employeeId: 1, skill: 'Inbound - Verification', rating: 4, dateAssessed: '2024-02-15', assessedBy: 'System' },
      { id: 2, employeeId: 1, skill: 'Outbound - Picking', rating: 3, dateAssessed: '2024-01-10', assessedBy: 'System' },
      { id: 3, employeeId: 1, skill: 'Outbound - Packing', rating: 3, dateAssessed: '2024-01-10', assessedBy: 'System' },
      { id: 4, employeeId: 1, skill: 'Returns Processing', rating: 2, dateAssessed: '2024-03-01', assessedBy: 'System' },
      { id: 5, employeeId: 2, skill: 'Inbound - Putaway', rating: 4, dateAssessed: '2023-10-05', assessedBy: 'System' },
      { id: 6, employeeId: 2, skill: 'Inventory - Cycle Count', rating: 3, dateAssessed: '2023-11-20', assessedBy: 'System' },
      { id: 7, employeeId: 2, skill: 'Equipment - Forklift', rating: 3, dateAssessed: '2023-09-15', assessedBy: 'System' },
      { id: 8, employeeId: 3, skill: 'Inbound - Verification', rating: 4, dateAssessed: '2023-05-10', assessedBy: 'System' },
      { id: 9, employeeId: 3, skill: 'Outbound - Picking', rating: 4, dateAssessed: '2023-05-10', assessedBy: 'System' },
      { id: 10, employeeId: 3, skill: 'Quality - Inspection', rating: 3, dateAssessed: '2023-08-12', assessedBy: 'System' },
      { id: 11, employeeId: 3, skill: 'Inventory - Cycle Count', rating: 4, dateAssessed: '2023-06-01', assessedBy: 'System' },
      { id: 12, employeeId: 4, skill: 'Inbound - Putaway', rating: 2, dateAssessed: '2024-04-01', assessedBy: 'System' },
      { id: 13, employeeId: 4, skill: 'Equipment - Forklift', rating: 3, dateAssessed: '2024-04-01', assessedBy: 'System' },
      { id: 14, employeeId: 5, skill: 'Quality - Inspection', rating: 4, dateAssessed: '2023-12-10', assessedBy: 'System' },
      { id: 15, employeeId: 5, skill: 'Hazardous Materials', rating: 3, dateAssessed: '2024-01-15', assessedBy: 'System' },
      { id: 16, employeeId: 6, skill: 'Quality - Inspection', rating: 4, dateAssessed: '2022-06-15', assessedBy: 'System' },
      { id: 17, employeeId: 6, skill: 'Inventory - Cycle Count', rating: 4, dateAssessed: '2022-07-01', assessedBy: 'System' },
      { id: 18, employeeId: 6, skill: 'Hazardous Materials', rating: 4, dateAssessed: '2022-09-10', assessedBy: 'System' },
      { id: 19, employeeId: 6, skill: 'WMS - System Navigation', rating: 4, dateAssessed: '2022-05-22', assessedBy: 'System' },
      { id: 20, employeeId: 7, skill: 'Inbound - Verification', rating: 1, dateAssessed: '2024-03-20', assessedBy: 'System' },
      { id: 21, employeeId: 7, skill: 'Outbound - Packing', rating: 1, dateAssessed: '2024-03-20', assessedBy: 'System' },
    ],
  });
  console.log('Seeded ratings.');

  // ─── Operations-Hub: Coaching ──────────────────────────────
  await prisma.coaching.createMany({
    data: [
      { id: 1, employeeId: 7, title: 'Attendance improvement', notes: 'Multiple late arrivals in March. Discussed importance of punctuality.', status: 'Open', dateOpened: '2024-03-15' },
      { id: 2, employeeId: 4, title: 'Putaway accuracy', notes: 'Several misplacements noted. Extra training scheduled.', status: 'Open', dateOpened: '2024-04-05' },
      { id: 3, employeeId: 1, title: 'Safety protocol reminder', notes: 'Forgot safety vest on warehouse floor twice.', status: 'Closed', dateOpened: '2024-01-20', dateClosed: '2024-02-01' },
    ],
  });
  console.log('Seeded coaching.');

  // ─── Operations-Hub: Contacts ──────────────────────────────
  await prisma.contact.createMany({
    data: [
      { id: 1, fullName: 'Sarah Chen', company: 'Bayer', role: 'Site Operations Manager', phone: '(507) 555-0201', email: 'sarah.chen@bayer.com', category: 'Bayer' },
      { id: 2, fullName: "Mike's Forklift Services", company: "Mike's Equipment", role: 'Service Technician', phone: '(507) 555-0202', email: 'service@mikesforklift.com', category: 'Vendor' },
      { id: 3, fullName: 'Albert Lea Fire Dept', company: 'City of Albert Lea', role: 'Emergency Response', phone: '911', email: '', category: 'Emergency' },
      { id: 4, fullName: 'James Rodriguez', company: 'Packaging Solutions Inc', role: 'Sales Rep', phone: '(507) 555-0204', email: 'j.rodriguez@packsol.com', category: 'Vendor' },
    ],
  });
  console.log('Seeded contacts.');

  // ─── Operations-Hub: Equipment ─────────────────────────────
  await prisma.equipment.createMany({
    data: [
      { id: 1, name: 'Forklift #3', type: 'Forklift', status: 'Available', serialNumber: 'FL-2024-03', lastInspected: '2026-06-01' },
      { id: 2, name: 'Reach Truck #12', type: 'Reach Truck', status: 'In Use', assignedToId: 4, serialNumber: 'RT-2023-12', lastInspected: '2026-06-10' },
      { id: 3, name: 'Pallet Jack #7', type: 'Pallet Jack', status: 'Under Maintenance', serialNumber: 'PJ-2022-07', lastInspected: '2026-05-15' },
      { id: 4, name: 'RF Scanner #4', type: 'RF Scanner', status: 'Available', serialNumber: 'RF-2025-04', lastInspected: '2026-06-12' },
      { id: 5, name: 'RF Scanner #9', type: 'RF Scanner', status: 'Out of Service', serialNumber: 'RF-2025-09', lastInspected: '2026-04-10' },
    ],
  });
  console.log('Seeded equipment.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
