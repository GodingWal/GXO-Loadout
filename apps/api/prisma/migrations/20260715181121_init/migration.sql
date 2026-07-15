-- CreateTable
CREATE TABLE "Site" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "address" TEXT
);

-- CreateTable
CREATE TABLE "StagingLane" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'EMPTY',
    "x" INTEGER NOT NULL,
    "y" INTEGER NOT NULL,
    "width" INTEGER NOT NULL,
    "length" INTEGER NOT NULL,
    "zoneCode" TEXT NOT NULL,
    "siteId" TEXT,
    "currentLoadId" TEXT,
    CONSTRAINT "StagingLane_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "StagingLane_currentLoadId_fkey" FOREIGN KEY ("currentLoadId") REFERENCES "Load" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Load" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "carrier" TEXT NOT NULL,
    "destination" TEXT,
    "expectedPalletCount" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "siteId" TEXT,
    CONSTRAINT "Load_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Pallet" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "barcode" TEXT NOT NULL,
    "productType" TEXT,
    "packagingType" TEXT,
    "isFlagged" BOOLEAN NOT NULL DEFAULT false,
    "loadId" TEXT,
    "stagingLaneId" TEXT,
    CONSTRAINT "Pallet_loadId_fkey" FOREIGN KEY ("loadId") REFERENCES "Load" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Pallet_stagingLaneId_fkey" FOREIGN KEY ("stagingLaneId") REFERENCES "StagingLane" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Inspection" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "inspectorName" TEXT NOT NULL,
    "timestamp" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "photosJson" TEXT,
    "notes" TEXT,
    "result" TEXT NOT NULL,
    "loadId" TEXT NOT NULL,
    "palletId" TEXT,
    CONSTRAINT "Inspection_loadId_fkey" FOREIGN KEY ("loadId") REFERENCES "Load" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Inspection_palletId_fkey" FOREIGN KEY ("palletId") REFERENCES "Pallet" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Appointment" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "date" TEXT NOT NULL,
    "time" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'Inbound',
    "carrier" TEXT NOT NULL,
    "bolShipmentNo" TEXT NOT NULL,
    "customer" TEXT NOT NULL,
    "productType" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'Scheduled',
    "doorId" INTEGER,
    "doorName" TEXT,
    "operatorId" INTEGER,
    "operatorName" TEXT,
    "checkInTime" TEXT,
    "checkOutTime" TEXT,
    "dwellTime" TEXT
);

-- CreateTable
CREATE TABLE "Door" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "direction" TEXT NOT NULL DEFAULT 'Both',
    "status" TEXT NOT NULL DEFAULT 'Open'
);

-- CreateTable
CREATE TABLE "Operator" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "PitTask" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "appointmentId" INTEGER NOT NULL,
    "operatorName" TEXT,
    "type" TEXT NOT NULL DEFAULT 'Inbound/outbound',
    "status" TEXT NOT NULL DEFAULT 'Pending',
    "startedAt" TEXT,
    "completedAt" TEXT,
    CONSTRAINT "PitTask_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Employee" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "fullName" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "shift" TEXT NOT NULL DEFAULT '1st',
    "jobRole" TEXT NOT NULL DEFAULT 'CSR/Clerk',
    "hireDate" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "photoUrl" TEXT,
    "shirtSize" TEXT,
    "birthday" TEXT,
    "cwr" BOOLEAN NOT NULL DEFAULT false,
    "phoneNumber" TEXT,
    "cwid" TEXT,
    "notes" TEXT
);

-- CreateTable
CREATE TABLE "Skill" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "jobRoles" TEXT NOT NULL,
    "process" TEXT,
    "action" TEXT
);

-- CreateTable
CREATE TABLE "EmployeeSkillRating" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "employeeId" INTEGER NOT NULL,
    "skill" TEXT NOT NULL,
    "rating" INTEGER NOT NULL DEFAULT 1,
    "dateAssessed" TEXT NOT NULL,
    "assessedBy" TEXT NOT NULL DEFAULT 'System',
    "notes" TEXT
);

-- CreateTable
CREATE TABLE "Coaching" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "employeeId" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "notes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Open',
    "dateOpened" TEXT NOT NULL,
    "dateClosed" TEXT
);

-- CreateTable
CREATE TABLE "Contact" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "fullName" TEXT NOT NULL,
    "company" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT NOT NULL DEFAULT '',
    "category" TEXT NOT NULL DEFAULT ''
);

-- CreateTable
CREATE TABLE "Equipment" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'Other',
    "status" TEXT NOT NULL DEFAULT 'Available',
    "assignedToId" INTEGER,
    "lastInspected" TEXT,
    "serialNumber" TEXT NOT NULL,
    "notes" TEXT
);

-- CreateIndex
CREATE UNIQUE INDEX "StagingLane_currentLoadId_key" ON "StagingLane"("currentLoadId");

-- CreateIndex
CREATE UNIQUE INDEX "Pallet_barcode_key" ON "Pallet"("barcode");

-- CreateIndex
CREATE UNIQUE INDEX "PitTask_appointmentId_key" ON "PitTask"("appointmentId");
