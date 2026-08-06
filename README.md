# GXO Operations Monorepo

This repository contains the centralized code for the GXO Warehouse Operations system at the **Bayer Albert Lea** facility. It is built on a **Palantir-inspired Ontology Architecture**, separating the visual UI from strict business rules and database mutations.

The repository is structured as a **Turborepo Monorepo**, allowing multiple applications (frontends and backends) to share unified TypeScript types, business rules, and API clients seamlessly.

---

## 🏗️ High-Level Architecture

The monorepo is divided into two primary zones:
1. **`/apps`**: Deployable applications — physical websites or serverless API environments that run in the Azure cloud.
2. **`/packages`**: Internal shared libraries — modular chunks of code (types, UI components, API clients) imported by apps but never deployed independently.

---

## 📂 Directory Deep Dive

### 1. `/apps/api` — The Serverless Gatekeeper
Azure Functions v4 backend. Acts as the strict gatekeeper between the frontend apps and the Prisma/SQLite database. No frontend talks to the database directly; all traffic routes through this API.

- **`prisma/schema.prisma`** — Single source of truth for the database schema (Employees, Skills, Equipment, Appointments, Staging Lanes, etc.)
- **`prisma/seed.ts`** — Seed script to populate initial data. Run with `npx prisma db seed` from `apps/api/`.
- **`src/index.ts`** — Azure entry point. Registers two HTTP routes: `GET /api/ontology/{objectType}` (reads) and `POST /api/ontology/actions` (writes).
- **`src/handlers/getOntology.ts`** — Handles all read requests, mapping Prisma rows into standardized SDK objects.
- **`src/handlers/executeAction.ts`** — Dynamic action router. Validates and dispatches POST actions to the correct action handler.
- **`src/actions/`** — The "Verbs" of the system. Each file contains isolated business logic and atomic DB transactions for a domain:
  - `opsHubActions.ts` — Employee, Skill, Rating, Coaching, Contact, Equipment mutations
  - `dockxActions.ts` — Appointment, Door, Operator, PIT Task mutations
  - `verifyPallet.ts`, `assignLoadToLane.ts` — Load verification mutations
- **`host.json`** — Azure Functions runtime configuration.
- **`local.settings.json`** _(gitignored)_ — Local environment variables. Create from the template below.

### 2. `/apps/Operations-Hub` — The Internal Dashboard
Vite/React application for operations managers and supervisors. Manages employees, skills assessments, coaching opportunities, contacts, equipment, PIT inspections, and inventory overview.

- **`src/hooks/useData.ts`** — Central data hook. Fetches all domain data via `ontologyClient` and provides CRUD callbacks.
- **`src/pages/`** — Page components: `HomePage`, `TeamRosterPage`, `EmployeeDetailPage`, `SkillsLibraryPage`, `SkillDetailPage`, `RecordAssessmentPage`, `ContactsPage`, `EquipmentsPage`, `InspectionsPage`, `InventoryPage`.
- **`src/components/`** — Shared UI: modals, sidebar, forms.
- **`vite.config.ts`** — Proxies `/api` to the local Azure Functions emulator on port 7071.

### 3. `/apps/DockX` — Dock Management
Vite/React app for dock clerks. Manages inbound/outbound appointments, door assignments, PIT task tracking, and the PitBoard operator view.

### 4. `/apps/gxo-loadout` — Load Verification Scanner
Vite/React app used on tablets and scanners by dock clerks to verify outbound freight (pallet scanning, staging lane assignment, photo capture).

### 5. `/apps/inventory-app` — Inventory Management App
Standalone Vite/React app for equipment inventory management. Connects to the same shared API. Run on port 5175 in development.

### 6. `/packages/semantic` — The Shared Ontology SDK
The "Brain" of the repository. Contains data definitions, API clients, shared components, and business rules.

- **`src/types/ontology.ts`** — TypeScript definitions for all domain objects (Employee, Skill, Equipment, Appointment, etc.)
- **`src/client.ts`** — Unified API wrapper. All apps use `ontologyClient.getEmployees()`, `ontologyClient.createSkill(...)` etc. instead of raw `fetch` calls.
- **`src/components/`** — Shared UI components (KanbanBoard, DashboardKPIBoxes, StagingLanesMap, etc.)

### 7. `/packages/shared` — Utility Belt
Generic, non-business-specific shared utilities and type exports.

---

## 🧭 The Ontology

`packages/semantic/src/ontology/` is the single description of **every piece of data in the system** — what we store, how it relates, and how it is allowed to change. The API, all four front-ends and the offline-first tablet records read from the same definitions.

| File | Contents |
|------|----------|
| `types.ts` | The metadata model: what an object type, link, action and value type are made of |
| `valueTypes.ts` | Closed enumerations (`LaneStatus`, `AppointmentStatus`, `JobRole`, `SkillRating`, `PalletType`, …) with display labels |
| `objectTypes.ts` | All 17 object types, their properties, storage, primary key and REST path |
| `linkTypes.ts` | Traversable relationships (`load-pallets`, `employee-coaching`, `appointment-pit-task`, …) |
| `actionTypes.ts` | Every verb that can write data, with typed, validated parameters |
| `validation.ts` | Runtime validation of action payloads and object records |
| `parity.ts` | Compile-time assertions that the definitions still match the TypeScript interfaces |
| `index.ts` | Lookup and traversal helpers plus the serializable metadata snapshot |

### How it is enforced

- **Reads** — `GET /api/ontology/{objectType}` resolves the URL segment through the ontology. An undeclared type returns `404` with the list of supported paths.
- **Writes** — `POST /api/ontology/actions` looks the action up in the ontology and validates the payload (required parameters, scalar shapes, enum membership) *before* anything reaches Prisma. Undeclared parameters are logged as warnings rather than rejected.
- **Handlers** — the backend action registry is typed as `Record<ActionTypeApiName, Handler>`, so a handler without a definition — or a definition without a handler — fails the build.
- **Types** — `parity.ts` fails `tsc` if an interface property or enum member is added on one side and not the other.
- **Tests** — `packages/semantic/__tests__/ontology.test.ts` checks registry integrity (unique paths, resolvable references, valid links) and the validation rules.

### Introspection

`GET /api/ontology/$metadata` returns the whole ontology as JSON — object types, links, actions and value types — so tooling and admin screens never need a hard-coded list.

```ts
import { ontologyClient, getObjectType, resolveLink, validateActionParameters } from '@gxo/semantic';

const metadata = await ontologyClient.getMetadata();
const loads = await ontologyClient.getObjects('Load');

getObjectType('StagingLane')?.properties.status.valueType;   // 'LaneStatus'
resolveLink('Load', 'Pallet');                               // { accessor: 'pallets', foreignKeyProperty: 'loadId', … }
```

### Adding to the ontology

1. Add or change the Prisma model in `apps/api/prisma/schema.prisma`.
2. Declare the object type (and any new value types / links) in `packages/semantic/src/ontology/`.
3. Update the matching interface in `packages/semantic/src/types/ontology.ts` — `parity.ts` will tell you if you miss a property.
4. For a new write, add the action definition **and** its handler in `apps/api/src/actions/` — the registry's type will not compile until both exist.
5. For a new read, add the row mapper in `apps/api/src/handlers/getOntology.ts` keyed by the object type's `apiPath`.

---

## ⚙️ Root Configuration Files

- **`package.json`** — Master dependency manager. `"workspaces": ["apps/*", "packages/*"]` tells npm to symlink internal folders so they can share code locally.
- **`turbo.json`** — Turborepo pipeline. Defines how `build`, `dev`, `test`, and `deploy` tasks run across all packages simultaneously with caching.
- **`.github/workflows/ci.yml`** — GitHub Actions CI: installs, builds the full monorepo on every push/PR to `main`.
- **`.github/workflows/build-web.yml`** — Builds Operations-Hub when its source changes.
- **`.github/workflows/deploy-backend.yml`** — Builds the API; deploy step is commented out until Azure secrets are configured.

---

## 🚀 Getting Started Locally

### Prerequisites
- Node.js 20+
- [Azure Functions Core Tools v4](https://learn.microsoft.com/en-us/azure/azure-functions/functions-run-local)

### 1. Install Dependencies
```bash
npm install
```

### 2. Set Up the Database (first time only)
```bash
cd apps/api
npx prisma migrate dev --name init
npx prisma db seed
cd ../..
```

### 3. Create Local API Settings
Create `apps/api/local.settings.json` (this file is gitignored):
```json
{
  "IsEncrypted": false,
  "Values": {
    "AzureWebJobsStorage": "",
    "FUNCTIONS_WORKER_RUNTIME": "node"
  },
  "Host": {
    "CORS": "*"
  }
}
```

### 4. Start the Development Environment
```bash
npm run dev
```

This uses Turborepo to simultaneously launch:
- **Operations-Hub** on http://localhost:3000
- **DockX** on http://localhost:5173
- **gxo-loadout** on http://localhost:5174
- **inventory-app** on http://localhost:5175
- **API (Azure Functions emulator)** on http://localhost:7071

---

## 🚢 Deployment

Deployment is handled via GitHub Actions. Before enabling auto-deploy, add these secrets to the GitHub repository settings:

| Secret | Description |
|--------|-------------|
| `AZURE_STATIC_WEB_APPS_API_TOKEN` | Deploy token for the Operations-Hub Azure Static Web App |
| `AZURE_FUNCTIONAPP_PUBLISH_PROFILE` | Publish profile for the `gxo-operations-api` Azure Function App |

Once secrets are set, uncomment the deploy steps in `.github/workflows/deploy-backend.yml` and `.github/workflows/ci.yml`.
