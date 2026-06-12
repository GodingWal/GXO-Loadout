# Loadout — GXO Outbound Inspection

SafetyCulture replacement for outbound order verification at GXO warehouse sites.
Single-inspector workflow with handoff support, scanner-driven, offline-capable,
$0/month operating cost on Azure Static Web Apps.

Wordmark: **LOADOUT.** with the GXO logo as the brand mark.

## What's new in this build

- **Fresh start** — wipes all data on first launch; manager configures site, inspectors, and staging locations from scratch
- **Picker + Inspector + Staging Location** captured at start of every inspection
- **BOL captured first**, then picklist (BOL determines stops and deliveries)
- **Image quality check** runs on every photo: flags blurry/dark/overexposed shots and asks to retake. If inspector keeps it, the photo auto-flags for ML training
- **Handoff support**: inspector can hand off mid-load to another inspector; system tags every pallet to whoever scanned it and keeps a handoff log
- **Stop sticker detection**: ML reads stop stickers from side photos and warns if the sticker doesn't match the pallet's assigned stop
- **Workspace grouped by Stop → Delivery → Pallet** (instead of a flat list)
- **Home tabs: In progress / Completed** so inspectors can review past work
- **Sites CRUD** in admin (add, edit, deactivate, delete)
- **Staging locations** managed per-site in admin
- **Reset all data** button in admin Security tab
- **Dashboard date-range picker** (UI works; data is still mock for v1)

## Workflows

| Workflow | Status | Description |
|---|---|---|
| **Outbound** | ✅ Built | Verify a load against the printed picklist before it ships |
| **Returns** | 🚧 Stub | Process returned product back into inventory |
| **Retag** | 🚧 Stub | Re-label or correct existing inventory |

Returns and Retag have placeholder screens with "coming soon" messaging.

## Outbound workflow steps

1. **Picker + Inspector + Staging Location** — picker (who pulled the load), inspector (you), staging location (where the load is staged). All three are required.
2. **Capture BOL** — ML extracts Load #, ship date, number of stops, delivery numbers.
3. **Capture picklist** — ML extracts line items and maps them to the deliveries from the BOL.
4. **Verify & cross-reference** — confirm fields, assign line items to deliveries, flag any Load # mismatches.

Then in the workspace:

- Scan next pallet → pick **Stop**, then **Delivery**, then **Pallet type**
- Mixed Bag Pallet asks how many batches (1–3) upfront — that decides bag flap photo slot count
- Per-pallet: photo slots (bag flap(s), 4 sides, placard for Mixed) + batch sections
- Expected bag count is read-only (comes from picklist)
- Running tally per batch updates live
- Stop sticker mismatch warning if ML reads a different stop number from the side photos

## Image quality check

Every captured photo runs through browser-side checks:

- **Blur** (Laplacian variance) — flags very out-of-focus images
- **Brightness** (mean pixel value) — flags too-dark and overexposed shots
- **Contrast** (std deviation) — flags featureless / foggy shots

If a check fails, the inspector sees a popup with the issue and can:
- **Retake** — re-open camera (recommended for severe issues)
- **Keep anyway** — accept it. The photo is auto-flagged for ML training so we can collect labeled data on what bad warehouse photos look like.

Browser-side checks are roughly 70% accurate on extreme cases. The plan is to swap in a trained model in Phase 2 using the auto-flagged training data.

## Handoff

At the top of the inspection workspace there's a "Scanning as [name]" bar with a "Hand off to another inspector" button. Tapping it brings up the inspector picker. From that point on, new pallets are tagged to the new inspector. Previous pallets stay attributed to whoever scanned them.

Each handoff is logged: who was previous, who took over, when, and which pallets the previous inspector had completed. Visible as an expandable history in the workspace.

## Worker vs admin

| Screen | Worker | Admin |
|---|---|---|
| Home (In progress + Completed tabs) | ✅ | ✅ |
| All three workflow buttons | ✅ | ✅ |
| Site shown in top bar (read-only) | ✅ | ✅ |
| **Admin console** | 🔒 password required | ✅ |
| Inspector list (add / deactivate) | 🔒 | ✅ |
| Sites CRUD | 🔒 | ✅ |
| Staging locations CRUD | 🔒 | ✅ |
| Operations dashboard | 🔒 | ✅ |
| Admin password change | 🔒 | ✅ |
| Reset all data | 🔒 | ✅ |

**Default admin password:** `loadout-admin` — change it via Admin → Security on first launch.

## First-launch setup checklist

After fresh install (or after a Reset All Data):

1. Open the app — goes to **Device setup**
2. **Create the first site** right there: type a site name, tap "Create site & continue"
3. Tap "Complete setup →" — this iPad is now assigned to that site
4. Home screen appears. Tap **Admin** in the topbar
5. Admin password: `loadout-admin`
6. **Inspectors** tab: add the inspectors for this site
7. **Staging locations** tab: add the staging locations (e.g. "Door 12", "Bay 3-A")
8. **Security** tab: change the default admin password
9. Ready for inspections — go back to the home screen and start one

If you ever need more sites, add them from Admin → Sites.

## Quick start

```bash
npm install
npm run dev
```

Open http://localhost:5173. First launch wipes any old data and shows device setup.

URL flags:
- `?demoml` — enable mock ML results (extracted Load #, batch codes, etc.) for picklist / BOL / pallet side / gate seal
- `?ocrdebug` — show OCR debug panel under every photo, with raw Tesseract text, candidates, edit distance, and a copy-JSON button. Topbar shows a red "OCR DEBUG" badge so you don't forget you're in it.

You can combine them: `?demoml&ocrdebug`.

## What's NOT in v1 yet

- Real Microsoft Graph / SharePoint storage (mock service in place)
- Picklist / BOL OCR (placeholder; Phase 3 via Azure Document Intelligence)
- Trained bag counting model (Phase 4)
- Trained image quality model (Phase 2.5 — uses auto-flagged data)
- Real dashboard data (mock for now; date picker UI is functional)
- PDF export of completed inspections
- Returns and Retag workflows (placeholders only)
- Auto-cropping batch code regions (inspector currently has to frame the photo well)

## ML / OCR — Phase 2

Tesseract.js runs in the browser for batch code and placard OCR. ~10MB language model is downloaded once and cached in IndexedDB; subsequent app launches are instant.

**What's wired up:**

- **Bag flap OCR**: Captures bag flap photo → preprocesses (grayscale, contrast stretch, adaptive threshold, 2× upscale) → Tesseract recognizes → matches against expected batches from the picklist using confusion-aware edit distance. Resilient to common OCR errors like 8↔B, 5↔S, 0↔O.
- **LPN sticker OCR**: Same pipeline as bag flap; works well on the clean printed stickers.
- **Mixed pallet placard OCR**: Lighter preprocessing (placards are already clean), extracts batch codes from the table.

**The "expected batches" rescue**: The placard or picklist tells us what batches *should* be on the pallet. We pass that list to OCR. When Tesseract outputs `P28SBW5M8` but we expected `P28S8W5M8`, the matcher recognizes 8↔B as a common confusion (cost 0.3) and confidently maps the OCR result to the correct batch. This is what lets us ship at 70%+ raw OCR accuracy and still get reliable results.

**Known limitations of v1 OCR:**

- No auto-cropping. Inspector must frame the batch code reasonably well in the photo.
- No text-detection step. Tesseract sees the whole image; preprocessing helps but accuracy on tightly-cropped labels is much better.
- Confidence calibration is rough. We report high/medium/low based on edit distance, not a learned calibration curve.

When OCR fails, the failed image is auto-flagged for ML training so we can build a custom model from real-world failures.

## Project layout

```
src/
  types/inspection.ts          Domain types
  services/
    db.ts                      IndexedDB persistence
    inspectors.ts              Per-site inspector list (no seed data)
    sites.ts                   Sites CRUD (no seed data)
    stagingLocations.ts        Per-site staging locations
    ml.ts                      Mock ML; real in Phase 2+
    imageQuality.ts            Browser-side photo quality checks
    adminAuth.ts               Soft password gate
    appReset.ts                Version-based wipe + manual reset
  lib/
    deviceConfig.ts            Per-iPad site assignment
  hooks/
    useCameraCapture.ts        Camera capture with downscaling
    useInspection.ts           Reducer with handoff + delivery + batch support
  components/
    QualityFlagButton.tsx      Quality flag UI (3 levels)
    MLTrainingFlagButton.tsx   Hard case marking
    SuggestableField.tsx       ML suggestion banner
    PhotoCapture.tsx           SlotPhotoCapture + MultiPhotoCapture
    ImageQualityModal.tsx      Bad-photo retake prompt
    InspectorPicker.tsx        Name dropdown for current site
    InspectionListCard.tsx     Home screen card with type pill
    RunningTallyHeader.tsx     Sticky tally with status text
  routes/
    SetupRoute.tsx             First-launch site assignment
    HomeRoute.tsx              Workflows + In progress / Completed tabs
    NewInspectionRoute.tsx     Picker + Inspector + Staging Location
    CaptureBOLRoute.tsx        Step 2 - photograph BOL first
    CapturePicklistRoute.tsx   Step 3 - photograph picklist
    VerifyRoute.tsx            Step 4 - cross-reference + verify
    InspectionWorkspaceRoute   Stop → Delivery → Pallet hierarchy + handoff
    ScanPalletRoute.tsx        Per-pallet workflow with stop sticker check
    ReviewAndCompleteRoute     Final reconciliation + sign-off
    AdminGateRoute.tsx         Password gate
    AdminRoute.tsx             Tabbed: Inspectors / Sites / Staging / Reports / Security
    DashboardRoute.tsx         Operations dashboard (inside admin)
  App.tsx                      Routing + topbar
  main.tsx                     React root + data version reset
  styles.css                   Global stylesheet
public/
  gxo-logo.jpg                 GXO logo
```

## Cost model

| Component | Monthly cost |
|---|---|
| Azure Static Web Apps Free tier | **$0** |
| SharePoint storage (already in GXO E3/E5) | **$0** |
| Microsoft Entra ID (already in GXO E3/E5) | **$0** |
| ML inference (runs in browser when added) | **$0** |
| Custom domain (optional) | ~$1/mo |
| **Total** | **$0–$12/year** |
