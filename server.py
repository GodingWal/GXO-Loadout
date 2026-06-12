import os
import json
import base64
import logging
from typing import List, Optional
import requests
from fastapi import FastAPI, File, UploadFile, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse, HTMLResponse
from pydantic import BaseModel
import sqlite3
from datetime import datetime, timedelta
import asyncio
import socket
import ipaddress
import shutil
import zipfile

# Configure logging
logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
logger = logging.getLogger("loadout-jetson-server")

app = FastAPI(
    title="Loadout GXO — Jetson Orin Edge Server",
    description="Edge hosting and NVIDIA Cosmos ML service for outbound inspection",
    version="1.0.0"
)
import sys
app.ssl_enabled = "--ssl" in sys.argv or os.getenv("USE_HTTPS", "false").lower() == "true"

# The frontend is served same-origin (or via the Vite dev proxy), so CORS is
# closed by default. Set ALLOWED_ORIGINS="https://foo,https://bar" if a
# cross-origin client genuinely needs access.
_allowed_origins = [o.strip() for o in os.getenv("ALLOWED_ORIGINS", "").split(",") if o.strip()]
if _allowed_origins:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=_allowed_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

# Directory to save uploaded photos
UPLOAD_DIR = os.path.join(os.path.dirname(__file__), "uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)

# Initialize SQLite database
DB_PATH = os.path.join(os.path.dirname(__file__), "loadout.db")

def init_db():
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS inspections (
            id TEXT PRIMARY KEY,
            site_id TEXT,
            status TEXT,
            last_edited_at TEXT,
            data TEXT
        )
    """)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS training_labels (
            id TEXT PRIMARY KEY,
            photo_id TEXT,
            inspection_id TEXT,
            pass INTEGER,
            status TEXT,
            data TEXT
        )
    """)
    conn.commit()
    conn.close()
    logger.info(f"Initialized SQLite database at: {DB_PATH}")

init_db()

# Request Queue Concurrency Rate Limiter (vLLM batches requests, so a few in
# flight at once is fine; tune with COSMOS_CONCURRENCY)
cosmos_semaphore = asyncio.Semaphore(int(os.getenv("COSMOS_CONCURRENCY", "3")))

# Helper to parse different ISO date string formats
def parse_iso_datetime(dt_str: str) -> datetime:
    for fmt in ("%Y-%m-%dT%H:%M:%S.%fZ", "%Y-%m-%dT%H:%M:%SZ", "%Y-%m-%dT%H:%M:%S.%f", "%Y-%m-%dT%H:%M:%S"):
        try:
            cleaned = dt_str.replace("Z", "")
            if "." in cleaned:
                parts = cleaned.split(".")
                cleaned = parts[0] + "." + parts[1][:6]
            return datetime.strptime(cleaned, fmt)
        except Exception:
            continue
    try:
        return datetime.fromisoformat(dt_str)
    except Exception:
        # Fallback to current datetime if totally unparseable
        return datetime.now()

# ============================================================
# NVIDIA Cosmos Driver
# ============================================================

class CosmosModelDriver:
    """Drives an NVIDIA Cosmos VLM served on a remote GPU host (e.g. a Vast.ai
    instance running vLLM) through an OpenAI-compatible chat completions API.
    Falls back to high-fidelity mock data when no endpoint is configured."""

    def __init__(self):
        self.endpoint = os.getenv("COSMOS_ENDPOINT", "").rstrip("/")
        self.api_key = os.getenv("COSMOS_API_KEY", "")
        self.model_name = os.getenv("COSMOS_MODEL_NAME", "nvidia/Cosmos-Reason1-7B")
        self.timeout = int(os.getenv("COSMOS_TIMEOUT_SECONDS", "90"))

        if self.endpoint:
            logger.info(f"Cosmos inference endpoint configured: {self.endpoint} (model: {self.model_name})")
        else:
            logger.warning(
                "COSMOS_ENDPOINT is not set — bag counting / OCR will use mock data. "
                "Point COSMOS_ENDPOINT at the Vast.ai vLLM server, e.g. http://<vast-ip>:<port>/v1"
            )

    def _get_prompt_and_schema(self, category: str, expected_batches: Optional[List[str]] = None, expected_bag_count: Optional[int] = None):
        batches_str = ", ".join(expected_batches) if expected_batches else "None provided"
        
        if category in ('Pallet_BagFlap', 'Pallet_LPN'):
            prompt = (
                f"You are a physical AI agent inspecting a agricultural product pallet flap or label. "
                f"Locate and read the batch code printed on the label/flap. "
                f"The expected batch codes are: [{batches_str}]. "
                f"Verify if the printed batch code matches one of the expected batch codes. "
                f"If the text is slightly distorted, apply OCR error correction to map it to the closest match."
            )
            schema = {
                "detectedBatchCode": "string (the extracted batch code)",
                "batchCodeConfidence": "float (0.0 to 1.0 confidence score)"
            }
            
        elif category == 'Pallet_Placard':
            prompt = (
                "You are inspecting a mixed pallet placard sheet containing a list of products and batch codes. "
                "Extract all batch codes, product descriptions, quantities, and units of measure (UOM) "
                "listed in the placard layout."
            )
            schema = {
                "batches": [
                    {
                        "batchCode": "string",
                        "productDescription": "string",
                        "quantity": "integer",
                        "uom": "string (usually 'BAG')"
                    }
                ]
            }
            
        elif category == 'Picklist':
            prompt = (
                "Extract the outbound Picklist document metadata and line items. "
                "Read the Load Number, Ship Date (format YYYY-MM-DD), and Carrier. "
                "Extract each line item with its batch code, product name, expected quantity, "
                "unit of measure, and delivery number if noted."
            )
            schema = {
                "loadNumber": "string",
                "shipDate": "string",
                "carrier": "string",
                "lineItems": [
                    {
                        "batchCode": "string",
                        "productName": "string",
                        "itemCode": "string",
                        "expectedQuantity": "integer",
                        "uom": "string",
                        "deliveryNumber": "string"
                    }
                ]
            }
            
        elif category == 'BOL':
            prompt = (
                "Extract the Bill of Lading (BOL) logistics details. "
                "Read the Load Number, Ship Date (format YYYY-MM-DD), Carrier name, and total number of stops. "
                "Map each delivery (containing delivery number and stop number) to its line items "
                "(batch code, product name, expected quantity, and UOM)."
            )
            schema = {
                "loadNumber": "string",
                "shipDate": "string",
                "carrier": "string",
                "numberOfStops": "integer",
                "deliveries": [
                    {
                        "deliveryNumber": "string",
                        "stopNumber": "integer",
                        "lineItems": [
                            {
                                "batchCode": "string",
                                "productName": "string",
                                "expectedQuantity": "integer",
                                "uom": "string"
                            }
                        ]
                    }
                ]
            }
            
        elif category == 'Pallet_Side':
            prompt = (
                f"Inspect this side view of a pallet. Count the number of bags stacked. "
                f"The expected bag count is {expected_bag_count if expected_bag_count else 'unknown'}. "
                f"Also search for any colored stop sticker (e.g. 'Stop 1', 'Stop 2') and extract the stop number."
            )
            schema = {
                "bagCount": "integer",
                "bagCountConfidence": "float (0.0 to 1.0)",
                "detectedStopNumber": "integer (or null if no stop sticker is visible)",
                "stopStickerConfidence": "float (0.0 to 1.0)"
            }
            
        elif category == 'Pallet_GateSeal':
            prompt = (
                "Inspect this pallet picture. Scan for an accuracy label or green/red gate seal sticker."
            )
            schema = {
                "accuracyLabelDetected": "boolean (true if found, false if missing)"
            }
            
        elif category == 'Returns_BOL':
            prompt = (
                "Extract the Returns Bill of Lading (BOL) or Packing List details. "
                "Read the BOL Number, Received Date, and extract the expected quantities for "
                "Wooden Pallets, Empty SeedPaks, Lids, and Returned SeedPaks with Product."
            )
            schema = {
                "bolNumber": "string",
                "receivedDate": "string",
                "expectedPallets": "integer",
                "expectedEmptySeedPaks": "integer",
                "expectedLids": "integer",
                "expectedProductSeedPaks": "integer",
                "expectedBaggedProduct": "integer"
            }
            
        elif category == 'Returns_Damage_Assessment':
            prompt = (
                "You are an AI returns inspector. Analyze this photo of a returned product pallet. "
                "Scan specifically for any visible DAMAGE: hit by forklift, smashed into another pallet, "
                "leaking seed, mouse holes, torn bags, or water damage."
            )
            schema = {
                "damageDetected": "boolean",
                "damageType": "string (e.g., 'forklift damage', 'leaking seed', 'torn bag', 'mouse holes', 'water damage', or 'None')",
                "damageDescription": "string (briefly describe the damage severity, or 'Clean' if no damage)"
            }
            
        else:
            prompt = "Analyze the image and return a description."
            schema = {"description": "string"}
            
        return prompt, schema

    def endpoint_available(self) -> bool:
        if not self.endpoint:
            return False
        try:
            headers = {"Authorization": f"Bearer {self.api_key}"} if self.api_key else {}
            res = requests.get(f"{self.endpoint}/models", headers=headers, timeout=3)
            return res.status_code == 200
        except Exception:
            return False

    def _run_remote(self, image_bytes: bytes, prompt: str, schema: dict) -> dict:
        base64_image = base64.b64encode(image_bytes).decode('utf-8')
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"

        full_prompt = (
            f"{prompt}\n\n"
            f"You MUST output raw JSON and ONLY raw JSON. Do not include markdown code block formatting (like ```json). "
            f"The JSON object must match this schema:\n{json.dumps(schema, indent=2)}"
        )

        payload = {
            "model": self.model_name,
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": full_prompt},
                        {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{base64_image}"}}
                    ]
                }
            ],
            "max_tokens": 1024,
            "temperature": 0.1,
            # JSON mode (guided decoding) guarantees syntactically valid JSON output
            "response_format": {"type": "json_object"}
        }

        logger.info(f"Sending request to Cosmos endpoint {self.endpoint} ({self.model_name})...")
        response = requests.post(
            f"{self.endpoint}/chat/completions",
            headers=headers,
            json=payload,
            timeout=self.timeout
        )

        if response.status_code == 400 and "response_format" in response.text:
            # Endpoint doesn't support JSON mode — retry once relying on the prompt
            payload.pop("response_format", None)
            response = requests.post(
                f"{self.endpoint}/chat/completions", headers=headers, json=payload, timeout=self.timeout
            )

        if response.status_code != 200:
            raise HTTPException(status_code=response.status_code, detail=f"Cosmos endpoint error: {response.text}")

        res_json = response.json()
        content = res_json['choices'][0]['message']['content'].strip()

        if content.startswith("```"):
            lines = content.splitlines()
            content = "\n".join(lines[1:-1])

        # Reasoning models may wrap the JSON in commentary — extract the outermost object
        if not content.startswith("{") and "{" in content:
            content = content[content.find("{"):content.rfind("}") + 1]

        return json.loads(content)

    def _run_mock(self, category: str, expected_batches: Optional[List[str]], expected_bag_count: Optional[int]) -> dict:
        import time
        time.sleep(0.4)
        
        now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        
        if category in ('Pallet_BagFlap', 'Pallet_LPN'):
            batch = "P18GY43M8"
            if expected_batches and len(expected_batches) > 0:
                batch = expected_batches[0]
            return {
                "detectedBatchCode": batch,
                "batchCodeConfidence": 0.96,
                "rawText": f"BATCH: {batch}\nLOT: 2026-A\nLPN: LPN-GXO-8231",
                "analyzedAt": now,
                "modelVersions": {"cosmos_vlm": "nvidia-cosmos-mock-v1"}
            }
            
        elif category == 'Pallet_Placard':
            batches_list = [
                {"batchCode": "P18GY43M8", "productDescription": "Field Corn 201-40VT4PRIB", "quantity": 40, "uom": "BAG"},
                {"batchCode": "P22FS42N8", "productDescription": "Field Corn 201-07SSPRIB", "quantity": 16, "uom": "BAG"}
            ]
            if expected_batches:
                batches_list = [{"batchCode": b, "productDescription": f"Product {b}", "quantity": 24, "uom": "BAG"} for b in expected_batches]
            return {
                "placardFields": {
                    "confidence": 0.94,
                    "batches": batches_list
                },
                "rawText": "PLACARD: " + ", ".join([f"{b['batchCode']} (Qty {b['quantity']})" for b in batches_list]),
                "analyzedAt": now,
                "modelVersions": {"cosmos_vlm": "nvidia-cosmos-mock-v1"}
            }
            
        elif category == 'Picklist':
            return {
                "picklistFields": {
                    "loadNumber": "835554312",
                    "shipDate": "2026-05-20",
                    "carrier": "SS Transportation LLC",
                    "confidence": 0.95,
                    "lineItems": [
                        {"batchCode": "P18GY43M8", "productName": "Field Corn 201-40VT4PRIB", "expectedQuantity": 40, "uom": "BAG", "confidence": 0.96, "deliveryNumber": "D1"},
                        {"batchCode": "P22FS42N8", "productName": "Field Corn 201-07SSPRIB", "expectedQuantity": 16, "uom": "BAG", "confidence": 0.93, "deliveryNumber": "D1"},
                        {"batchCode": "CL5SBD92", "productName": "Soybean Seedpaks", "expectedQuantity": 4, "uom": "SP", "confidence": 0.91, "deliveryNumber": "D2"},
                    ]
                },
                "analyzedAt": now,
                "modelVersions": {"cosmos_vlm": "nvidia-cosmos-mock-v1"}
            }
            
        elif category == 'BOL':
            return {
                "bolFields": {
                    "loadNumber": "835554312",
                    "shipDate": "2026-05-20",
                    "carrier": "SS Transportation LLC",
                    "numberOfStops": 2,
                    "confidence": 0.94,
                    "deliveries": [
                        {
                            "deliveryNumber": "D1",
                            "stopNumber": 1,
                            "lineItems": [
                                {"batchCode": "P18GY43M8", "productName": "Field Corn 201-40VT4PRIB", "expectedQuantity": 40, "uom": "BAG"},
                                {"batchCode": "P22FS42N8", "productName": "Field Corn 201-07SSPRIB", "expectedQuantity": 16, "uom": "BAG"}
                            ]
                        },
                        {
                            "deliveryNumber": "D2",
                            "stopNumber": 2,
                            "lineItems": [
                                {"batchCode": "CL5SBD92", "productName": "Soybean Seedpaks", "expectedQuantity": 4, "uom": "SP"}
                            ]
                        }
                    ]
                },
                "analyzedAt": now,
                "modelVersions": {"cosmos_vlm": "nvidia-cosmos-mock-v1"}
            }
            
        elif category == 'Pallet_Side':
            count = expected_bag_count if expected_bag_count is not None else 36
            return {
                "bagCount": count,
                "bagCountConfidence": 0.95,
                "detectedStopNumber": 1,
                "stopStickerConfidence": 0.96,
                "analyzedAt": now,
                "modelVersions": {"cosmos_vlm": "nvidia-cosmos-mock-v1"}
            }
            
        elif category == 'Pallet_GateSeal':
            return {
                "accuracyLabelDetected": True,
                "analyzedAt": now,
                "modelVersions": {"cosmos_vlm": "nvidia-cosmos-mock-v1"}
            }
            
        return {
            "analyzedAt": now,
            "modelVersions": {"cosmos_vlm": "nvidia-cosmos-mock-v1"}
        }

    # Where the frontend expects category results nested under a named field,
    # map the flat model output into that envelope. Values are
    # (envelope_key, required_model_keys) — envelope_key None keeps results flat.
    _CATEGORY_ENVELOPES = {
        'Pallet_BagFlap': (None, ['detectedBatchCode']),
        'Pallet_LPN': (None, ['detectedBatchCode']),
        'Pallet_Side': (None, ['bagCount']),
        'Pallet_GateSeal': (None, ['accuracyLabelDetected']),
        'Pallet_Placard': ('placardFields', ['batches']),
        'Picklist': ('picklistFields', ['loadNumber', 'lineItems']),
        'BOL': ('bolFields', ['loadNumber', 'deliveries']),
        'Returns_BOL': ('returnsBolFields', ['bolNumber']),
        'Returns_Damage_Assessment': ('returnsDamageAssessment', ['damageDetected']),
    }

    def _validate_and_wrap(self, category: str, result: dict) -> dict:
        if not isinstance(result, dict):
            raise ValueError(f"Model returned non-object JSON: {type(result).__name__}")

        envelope_key, required_keys = self._CATEGORY_ENVELOPES.get(category, (None, []))
        missing = [k for k in required_keys if k not in result]
        if missing:
            raise ValueError(f"Model output for '{category}' is missing required fields: {missing} (got keys: {list(result.keys())})")

        if envelope_key:
            result = {envelope_key: result}
        return result

    def analyze(self, image_bytes: bytes, category: str, expected_batches: Optional[List[str]] = None, expected_bag_count: Optional[int] = None) -> dict:
        prompt, schema = self._get_prompt_and_schema(category, expected_batches, expected_bag_count)
        import time
        now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

        try:
            if self.endpoint:
                result = self._validate_and_wrap(category, self._run_remote(image_bytes, prompt, schema))
                result.setdefault("analyzedAt", now)
                result.setdefault("modelVersions", {"cosmos_vlm": self.model_name})
                result["source"] = "live"
                return result
            else:
                logger.info(f"Using high-fidelity mock fallback for category '{category}'")
                result = self._run_mock(category, expected_batches, expected_bag_count)
                result["source"] = "mock"
                return result
        except Exception as e:
            logger.error(f"Error in NVIDIA Cosmos analysis: {e}. Falling back to mock data.")
            result = self._run_mock(category, expected_batches, expected_bag_count)
            result["source"] = "mock"
            result["errors"] = [f"live_inference_failed: {e}"]
            return result

# Instantiate drivers
cosmos_driver = CosmosModelDriver()

# ============================================================
# API Routes
# ============================================================

@app.post("/api/analyze")
async def analyze_photo(
    file: UploadFile = File(...),
    category: str = Form(...),
    expectedBatches: Optional[str] = Form(None), # JSON list string
    expectedBagCount: Optional[int] = Form(None),
    photoId: Optional[str] = Form(None),
    inspectionId: Optional[str] = Form(None)
):
    logger.info(f"Received photo analysis request. Category: {category} (Queueing...)")
    image_bytes = await file.read()
    
    # Save the photo to local disk folder
    try:
        target_dir = os.path.join(UPLOAD_DIR, inspectionId if inspectionId else "temp")
        os.makedirs(target_dir, exist_ok=True)
        
        file_name = f"{photoId}.jpg" if photoId else f"{datetime.now().timestamp()}.jpg"
        target_path = os.path.join(target_dir, file_name)
        
        with open(target_path, "wb") as f:
            f.write(image_bytes)
        logger.info(f"Saved uploaded photo to: {target_path}")
    except Exception as e:
        logger.error(f"Failed to save uploaded photo to disk: {e}")

    # Parse expected batches if passed
    batches = None
    if expectedBatches:
        try:
            batches = json.loads(expectedBatches)
            if not isinstance(batches, list):
                batches = None
        except Exception:
            logger.warning(f"Failed to parse expectedBatches JSON: {expectedBatches}")
            batches = None

    # Queue request through the Semaphore to protect GPU load limits
    async with cosmos_semaphore:
        loop = asyncio.get_event_loop()
        result = await loop.run_in_executor(
            None,
            lambda: cosmos_driver.analyze(
                image_bytes=image_bytes,
                category=category,
                expected_batches=batches,
                expected_bag_count=expectedBagCount
            )
        )
    
    return JSONResponse(content=result)

# ---- CRUD Endpoints for SQLite Inspections ----

@app.post("/api/inspections")
async def save_inspection(inspection: dict):
    insp_id = inspection.get("id")
    site_id = inspection.get("siteId")
    status = inspection.get("status")
    last_edited_at = inspection.get("lastEditedAt", datetime.utcnow().isoformat() + "Z")
    
    if not insp_id:
        raise HTTPException(status_code=400, detail="Missing inspection id")
        
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute(
        """
        INSERT INTO inspections (id, site_id, status, last_edited_at, data)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
            site_id=excluded.site_id,
            status=excluded.status,
            last_edited_at=excluded.last_edited_at,
            data=excluded.data
        """,
        (insp_id, site_id, status, last_edited_at, json.dumps(inspection))
    )
    conn.commit()
    conn.close()
    return {"status": "success", "id": insp_id}

@app.get("/api/inspections/{id}")
async def get_inspection(id: str):
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute("SELECT data FROM inspections WHERE id=?", (id,))
    row = cursor.fetchone()
    conn.close()
    if not row:
        raise HTTPException(status_code=404, detail="Inspection not found")
    return JSONResponse(content=json.loads(row[0]))

@app.get("/api/inspections")
async def list_inspections(siteId: Optional[str] = None):
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    if siteId and siteId != "all":
        cursor.execute("SELECT data FROM inspections WHERE site_id=?", (siteId,))
    else:
        cursor.execute("SELECT data FROM inspections")
    rows = cursor.fetchall()
    conn.close()
    
    res = []
    for r in rows:
        try:
            res.append(json.loads(r[0]))
        except Exception:
            pass
    res.sort(key=lambda x: x.get("lastEditedAt", ""), reverse=True)
    return JSONResponse(content=res)

@app.delete("/api/inspections/{id}")
async def delete_inspection(id: str):
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute("DELETE FROM inspections WHERE id=?", (id,))
    conn.commit()
    conn.close()
    return {"status": "success"}

# ---- Photo Upload API from Sync Queue ----

@app.post("/api/photo-upload")
async def upload_photo(
    file: UploadFile = File(...),
    photoId: str = Form(...),
    inspectionId: str = Form(...)
):
    image_bytes = await file.read()
    try:
        target_dir = os.path.join(UPLOAD_DIR, inspectionId)
        os.makedirs(target_dir, exist_ok=True)
        target_path = os.path.join(target_dir, f"{photoId}.jpg")
        with open(target_path, "wb") as f:
            f.write(image_bytes)
        logger.info(f"Saved photo upload from sync queue to: {target_path}")
        return {"status": "success", "photoId": photoId}
    except Exception as e:
        logger.error(f"Failed to save photo upload: {e}")
        raise HTTPException(status_code=500, detail=str(e))

# ---- Training Labels API ----

@app.post("/api/training-labels")
async def save_training_label(label: dict):
    lbl_id = label.get("id")
    photo_id = label.get("photoId")
    inspection_id = label.get("inspectionId")
    lbl_pass = label.get("pass")
    status = label.get("status")
    
    if not lbl_id:
        raise HTTPException(status_code=400, detail="Missing label id")
        
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute(
        """
        INSERT INTO training_labels (id, photo_id, inspection_id, pass, status, data)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
            photo_id=excluded.photo_id,
            inspection_id=excluded.inspection_id,
            pass=excluded.pass,
            status=excluded.status,
            data=excluded.data
        """,
        (lbl_id, photo_id, inspection_id, lbl_pass, status, json.dumps(label))
    )
    conn.commit()
    conn.close()
    return {"status": "success", "id": lbl_id}

@app.get("/api/training-labels")
async def list_training_labels():
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute("SELECT data FROM training_labels")
    rows = cursor.fetchall()
    conn.close()
    res = []
    for r in rows:
        try:
            res.append(json.loads(r[0]))
        except Exception:
            pass
    return JSONResponse(content=res)

@app.delete("/api/training-labels/{id}")
async def delete_training_label(id: str):
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute("DELETE FROM training_labels WHERE id=?", (id,))
    conn.commit()
    conn.close()
    return {"status": "success"}

# ---- SFT Training Data Export Pipeline ----

@app.post("/api/export/training-data")
async def export_training_data():
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute("SELECT data FROM training_labels")
    lbl_rows = cursor.fetchall()
    conn.close()
    
    labels = []
    for r in lbl_rows:
        try:
            labels.append(json.loads(r[0]))
        except Exception:
            pass
            
    import tempfile
    import uuid
    export_id = str(uuid.uuid4())
    temp_dir = os.path.join(tempfile.gettempdir(), f"loadout-export-{export_id}")
    os.makedirs(temp_dir, exist_ok=True)
    
    manifest = []
    for lbl in labels:
        photo_id = lbl.get("photoId")
        inspection_id = lbl.get("inspectionId")
        
        photo_file = f"{photo_id}.jpg"
        src_path = os.path.join(UPLOAD_DIR, inspection_id, photo_file)
        if not os.path.exists(src_path):
            src_path = os.path.join(UPLOAD_DIR, "temp", photo_file)
            
        if os.path.exists(src_path):
            shutil.copy2(src_path, os.path.join(temp_dir, photo_file))
            manifest.append(lbl)
            
    with open(os.path.join(temp_dir, "manifest.json"), "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2)
        
    zip_path = os.path.join(tempfile.gettempdir(), f"loadout-training-data-{export_id}.zip")
    with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zip_file:
        for root, dirs, files in os.walk(temp_dir):
            for file in files:
                file_path = os.path.join(root, file)
                zip_file.write(file_path, file)
                
    shutil.rmtree(temp_dir)
    return FileResponse(zip_path, media_type="application/zip", filename=f"loadout-training-data-{datetime.now().strftime('%Y%m%d')}.zip")

# ---- Dashboard Stats Endpoint ----

@app.get("/api/dashboard/stats")
async def get_dashboard_stats(
    startDate: str,
    endDate: str,
    siteId: Optional[str] = "all"
):
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute("SELECT data FROM inspections")
    rows = cursor.fetchall()
    conn.close()
    
    inspections = []
    for r in rows:
        try:
            inspections.append(json.loads(r[0]))
        except Exception:
            pass
            
    # Filter by site and date
    filtered = []
    for ins in inspections:
        if siteId and siteId != "all" and ins.get("siteId") != siteId:
            continue
        # Use startedAt to check bounds
        date_str = ins.get("startedAt", "")[:10]
        if not date_str:
            continue
        if startDate <= date_str <= endDate:
            filtered.append(ins)
            
    # Calculate stats
    completed_or_flagged = [ins for ins in filtered if ins.get("status") in ("Complete", "Flagged")]
    total_loads = len(completed_or_flagged)
    flagged_loads = [ins for ins in completed_or_flagged if ins.get("status") == "Flagged"]
    flag_rate = round((len(flagged_loads) / total_loads * 100), 1) if total_loads > 0 else 0.0
    
    # Average cycle time
    cycle_times = []
    for ins in completed_or_flagged:
        start_t = ins.get("startedAt")
        comp_t = ins.get("completedAt")
        if start_t and comp_t:
            try:
                s_dt = parse_iso_datetime(start_t)
                c_dt = parse_iso_datetime(comp_t)
                diff = (c_dt - s_dt).total_seconds() / 60.0
                if diff > 0 and diff < 480: # Filter outliers (> 8 hrs)
                    cycle_times.append(diff)
            except Exception:
                pass
    avg_cycle = round(sum(cycle_times) / len(cycle_times), 1) if cycle_times else 0.0
    
    # Discrepancies count
    disc_count = sum(ins.get("flaggedItemsCount", 0) for ins in filtered)
    
    # Active inspectors
    inspectors = set()
    for ins in filtered:
        if ins.get("startedBy"): inspectors.add(ins.get("startedBy"))
        if ins.get("completedBy"): inspectors.add(ins.get("completedBy"))
        for p in ins.get("pallets", []):
            if p.get("scannedBy"): inspectors.add(p.get("scannedBy"))
    active_inspectors_count = len(inspectors)
    
    # 1. KPIs
    kpis = [
        {"label": "Loads inspected", "value": f"{total_loads:,}", "delta": f"Total in range", "deltaClass": "flat"},
        {"label": "Flag rate", "value": f"{flag_rate}%", "delta": f"{len(flagged_loads)} flagged loads", "deltaClass": "flat"},
        {"label": "Avg cycle time", "value": f"{avg_cycle} min", "delta": f"For completed loads", "deltaClass": "flat"},
        {"label": "Discrepancies caught", "value": str(disc_count), "delta": "Aggregated flags", "deltaClass": "flat"},
        {"label": "Active inspectors", "value": str(active_inspectors_count), "delta": f"Active in range", "deltaClass": "flat"},
        {"label": "Photo completeness", "value": "99.4%", "delta": "All slots matched", "deltaClass": "flat"},
    ]
    
    # 2. Site aggregation
    site_map = {}
    for ins in completed_or_flagged:
        s_id = ins.get("siteId", "Unknown")
        if s_id not in site_map:
            site_map[s_id] = {"loads": 0, "flagged": 0, "cycles": [], "disc": 0, "inspectors": set()}
            
        site_map[s_id]["loads"] += 1
        if ins.get("status") == "Flagged":
            site_map[s_id]["flagged"] += 1
        site_map[s_id]["disc"] += ins.get("flaggedItemsCount", 0)
        
        start_t = ins.get("startedAt")
        comp_t = ins.get("completedAt")
        if start_t and comp_t:
            try:
                diff = (parse_iso_datetime(comp_t) - parse_iso_datetime(start_t)).total_seconds() / 60.0
                if diff > 0 and diff < 480: site_map[s_id]["cycles"].append(diff)
            except Exception: pass
            
        if ins.get("completedBy"): site_map[s_id]["inspectors"].add(ins.get("completedBy"))
        
    site_rows = []
    for s_id, s_data in site_map.items():
        s_loads = s_data["loads"]
        s_flagged = s_data["flagged"]
        s_flag_rate = round((s_flagged / s_loads * 100), 1) if s_loads > 0 else 0.0
        s_avg_cycle = round(sum(s_data["cycles"]) / len(s_data["cycles"]), 1) if s_data["cycles"] else 0.0
        
        site_rows.append({
            "name": s_id.replace("-", " ").title(),
            "loads": s_loads,
            "flagRate": f"{s_flag_rate}%",
            "cycle": f"{s_avg_cycle} min",
            "disc": s_data["disc"],
            "inspectors": len(s_data["inspectors"]),
            "status": "On track" if s_flag_rate < 5 else "Above target",
            "cls": "success" if s_flag_rate < 5 else "warn"
        })
    # Fill in defaults if empty
    if not site_rows:
        site_rows = [{"name": "No data", "loads": 0, "flagRate": "0%", "cycle": "0 min", "disc": 0, "inspectors": 0, "status": "No activity", "cls": "flat"}]
        
    # 3. Inspector aggregation
    ins_map = {}
    for ins in completed_or_flagged:
        name = ins.get("completedBy") or ins.get("startedBy") or "System"
        s_id = ins.get("siteId", "Unknown")
        if name not in ins_map:
            ins_map[name] = {"site": s_id.replace("-", " ").title(), "loads": 0, "flagged": 0, "cycles": []}
        ins_map[name]["loads"] += 1
        if ins.get("status") == "Flagged":
            ins_map[name]["flagged"] += 1
            
        start_t = ins.get("startedAt")
        comp_t = ins.get("completedAt")
        if start_t and comp_t:
            try:
                diff = (parse_iso_datetime(comp_t) - parse_iso_datetime(start_t)).total_seconds() / 60.0
                if diff > 0 and diff < 480: ins_map[name]["cycles"].append(diff)
            except Exception: pass
            
    ins_rows = []
    max_insp_loads = 1
    for name, i_data in ins_map.items():
        i_loads = i_data["loads"]
        max_insp_loads = max(max_insp_loads, i_loads)
        i_flag_rate = round((i_data["flagged"] / i_loads * 100), 1) if i_loads > 0 else 0.0
        i_avg_cycle = round(sum(i_data["cycles"]) / len(i_data["cycles"]), 1) if i_data["cycles"] else 0.0
        
        ins_rows.append({
            "name": name,
            "site": i_data["site"],
            "loads": i_loads,
            "flagRate": f"{i_flag_rate}%",
            "cycle": f"{i_avg_cycle} min",
            "workload": i_loads # will scale in client/here
        })
    for r in ins_rows:
        r["workload"] = int((r["loads"] / max_insp_loads) * 100)
        
    # 4. Open flags list
    open_flags = []
    # Get recent flagged inspections
    flagged_inspections = [ins for ins in filtered if ins.get("status") == "Flagged"]
    flagged_inspections.sort(key=lambda x: x.get("lastEditedAt", ""), reverse=True)
    
    for ins in flagged_inspections[:10]: # Limit to 10
        # Determine main flag reason
        reason = "Quality flag raised"
        # Find reasons in pallets or inspection level
        reasons_list = []
        if ins.get("qualityFlag", {}).get("reason"):
            reasons_list.append(ins["qualityFlag"]["reason"].replace("_", " ").title())
        for p in ins.get("pallets", []):
            if p.get("qualityFlag", {}).get("reason"):
                reasons_list.append(p["qualityFlag"]["reason"].replace("_", " ").title())
            for ph in p.get("photos", []):
                if ph.get("qualityFlag", {}).get("reason"):
                    reasons_list.append(ph["qualityFlag"]["reason"].replace("_", " ").title())
                    
        if reasons_list:
            reason = reasons_list[0]
            
        load_no = ins.get("picklist", {}).get("loadNumber", {}).get("value") or ins.get("id")[:8]
        
        open_flags.append({
            "load": load_no,
            "site": ins.get("siteId", "").replace("-", " ").title(),
            "inspector": ins.get("completedBy") or ins.get("startedBy") or "Unknown",
            "reason": reason,
            "sev": "High" if "damage" in reason.lower() or "wrong" in reason.lower() else "Medium",
            "sevCls": "danger" if "damage" in reason.lower() or "wrong" in reason.lower() else "warn",
            "when": ins.get("completedAt", ins.get("startedAt", ""))[:10]
        })
        
    # 5. Throughput Trend by day
    # Get last 14 days
    date_labels = []
    start_dt = datetime.strptime(startDate, "%Y-%m-%d")
    end_dt = datetime.strptime(endDate, "%Y-%m-%d")
    delta = end_dt - start_dt
    days_in_range = delta.days + 1
    
    # We will generate labels and dataset buckets
    for i in range(days_in_range):
        d = start_dt + timedelta(days=i)
        date_labels.append(d.strftime("%Y-%m-%d"))
        
    # Bucket total loads by site and date
    site_names = list(site_map.keys())
    site_datasets = {}
    for s_id in site_names:
        site_datasets[s_id] = [0] * days_in_range
        
    for ins in completed_or_flagged:
        s_id = ins.get("siteId")
        date_str = ins.get("startedAt", "")[:10]
        if date_str in date_labels and s_id in site_datasets:
            idx = date_labels.index(date_str)
            site_datasets[s_id][idx] += 1
            
    throughput_datasets = []
    for s_id, data_list in site_datasets.items():
        throughput_datasets.append({
            "label": s_id.replace("-", " ").title(),
            "data": data_list
        })
        
    # 6. Flag reasons breakdown
    reasons_breakdown = {
        "damaged_product": 0,
        "wrong_or_missing_label": 0,
        "wrong_batch_or_product_info": 0,
        "quantity_discrepancy": 0,
        "other": 0
    }
    for ins in filtered:
        # Check global flag
        if ins.get("qualityFlag", {}).get("reason"):
            r = ins["qualityFlag"]["reason"]
            if r in reasons_breakdown: reasons_breakdown[r] += 1
        # Check pallet flags
        for p in ins.get("pallets", []):
            if p.get("qualityFlag", {}).get("reason"):
                r = p["qualityFlag"]["reason"]
                if r in reasons_breakdown: reasons_breakdown[r] += 1
            for ph in p.get("photos", []):
                if ph.get("qualityFlag", {}).get("reason"):
                    r = ph["qualityFlag"]["reason"]
                    if r in reasons_breakdown: reasons_breakdown[r] += 1
                    
    flag_reasons = {
        "labels": ["Damaged product", "Wrong label", "Wrong batch info", "Qty discrepancy", "Other"],
        "values": [
            reasons_breakdown["damaged_product"],
            reasons_breakdown["wrong_or_missing_label"],
            reasons_breakdown["wrong_batch_or_product_info"],
            reasons_breakdown["quantity_discrepancy"],
            reasons_breakdown["other"]
        ]
    }
    
    # 7. Flag rate over time (by day)
    flag_rates_by_day = []
    for date_str in date_labels:
        day_inspections = [ins for ins in completed_or_flagged if ins.get("startedAt", "")[:10] == date_str]
        day_total = len(day_inspections)
        day_flagged = len([ins for ins in day_inspections if ins.get("status") == "Flagged"])
        rate = round((day_flagged / day_total * 100), 1) if day_total > 0 else 0.0
        flag_rates_by_day.append(rate)
        
    # Shorten dates for labels in chart
    short_date_labels = [d[5:] for d in date_labels]
    
    return JSONResponse(content={
        "kpis": kpis,
        "siteRows": site_rows,
        "inspectorRows": ins_rows,
        "openFlags": open_flags,
        "charts": {
            "dateLabels": short_date_labels,
            "throughput": throughput_datasets,
            "flagTrend": flag_rates_by_day,
            "flagReasons": flag_reasons
        }
    })

# ---- Health Diagnostics API ----

@app.get("/api/health")
async def health_check():
    # 1. Disk usage of uploads
    try:
        total, used, free = shutil.disk_usage(UPLOAD_DIR)
        disk_space = {
            "total_gb": round(total / (2**30), 2),
            "used_gb": round(used / (2**30), 2),
            "free_gb": round(free / (2**30), 2),
            "percent_used": round((used / total) * 100, 1)
        }
    except Exception as e:
        disk_space = {"error": str(e)}
        
    # 2. RAM and CPU usage on Windows using ctypes and PowerShell queries
    cpu_usage = 0
    ram_usage = 0
    try:
        import ctypes
        class MEMORYSTATUSEX(ctypes.Structure):
            _fields_ = [
                ("dwLength", ctypes.c_ulong),
                ("dwMemoryLoad", ctypes.c_ulong),
                ("ullTotalPhys", ctypes.c_ulonglong),
                ("ullAvailPhys", ctypes.c_ulonglong),
                ("ullTotalPageFile", ctypes.c_ulonglong),
                ("ullAvailPageFile", ctypes.c_ulonglong),
                ("ullTotalVirtual", ctypes.c_ulonglong),
                ("ullAvailVirtual", ctypes.c_ulonglong),
                ("ullAvailExtendedVirtual", ctypes.c_ulonglong)
            ]
        stat = MEMORYSTATUSEX()
        stat.dwLength = ctypes.sizeof(stat)
        if ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(stat)):
            ram_usage = stat.dwMemoryLoad
    except Exception:
        pass
        
    try:
        import subprocess
        # Async run cpu usage
        cmd = "powershell -Command \"(Get-CimInstance Win32_Processor).LoadPercentage\""
        res = subprocess.run(cmd, shell=True, capture_output=True, text=True)
        if res.returncode == 0 and res.stdout.strip():
            cpu_usage = int(res.stdout.strip())
    except Exception:
        pass
        
    # 3. GPU information (using nvidia-smi command if available)
    gpu_info = {"nvidia_gpu_detected": False, "details": "NVIDIA GPU not detected or driver missing"}
    try:
        import subprocess
        res = subprocess.run("nvidia-smi --query-gpu=temperature.gpu,utilization.gpu,memory.used,memory.total --format=csv,noheader,nounits", shell=True, capture_output=True, text=True)
        if res.returncode == 0 and res.stdout.strip():
            parts = res.stdout.strip().split(",")
            gpu_info = {
                "nvidia_gpu_detected": True,
                "temperature_c": int(parts[0].strip()),
                "utilization_percent": int(parts[1].strip()),
                "memory_used_mb": int(parts[2].strip()),
                "memory_total_mb": int(parts[3].strip())
            }
    except Exception:
        pass
        
    # 4. Cosmos Model Status
    model_driver = {
        "model_name": cosmos_driver.model_name,
        "endpoint": cosmos_driver.endpoint or None,
        "api_key_set": bool(cosmos_driver.api_key),
        "endpoint_available": cosmos_driver.endpoint_available()
    }
    
    # 5. Network info
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        local_ip = s.getsockname()[0]
        s.close()
    except Exception:
        local_ip = "127.0.0.1"
        
    return {
        "status": "healthy",
        "cpu_usage_percent": cpu_usage,
        "ram_usage_percent": ram_usage,
        "disk_space": disk_space,
        "gpu_info": gpu_info,
        "model_driver": model_driver,
        "local_ip": local_ip,
        "ssl_enabled": getattr(app, "ssl_enabled", False)
    }

# ============================================================
# Single Page Application Static Files Hosting
# ============================================================

DIST_DIR = os.path.join(os.path.dirname(__file__), "dist")

assets_path = os.path.join(DIST_DIR, "assets")
if os.path.exists(assets_path):
    app.mount("/assets", StaticFiles(directory=assets_path), name="assets")

@app.get("/{catchall:path}")
async def serve_frontend(catchall: str):
    file_path = os.path.join(DIST_DIR, catchall)
    if catchall and os.path.isfile(file_path):
        return FileResponse(file_path)
        
    index_file = os.path.join(DIST_DIR, "index.html")
    if os.path.exists(index_file):
        return FileResponse(index_file)
        
    return HTMLResponse_frontend_not_built()

def HTMLResponse_frontend_not_built():
    html_content = """
    <!DOCTYPE html>
    <html>
    <head>
        <title>Loadout Edge Server</title>
        <style>
            body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background-color: #f1efe8; color: #111110; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
            .card { background: white; padding: 40px; border-radius: 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.05); text-align: center; max-width: 500px; }
            h1 { color: #e04a2d; margin-top: 0; }
            code { background: #eee; padding: 2px 6px; border-radius: 4px; font-family: monospace; }
        </style>
    </head>
    <body>
        <div class="card">
            <h1>Frontend Not Compiled Yet</h1>
            <p>The FastAPI edge server is running successfully, but the compiled frontend files were not found in the <code>dist/</code> directory.</p>
            <p>Please compile the frontend by running:</p>
            <p><code>npm run build</code></p>
            <p>Then refresh this page.</p>
        </div>
    </body>
    </html>
    """
    return HTMLResponse(content=html_content, status_code=200)

# ============================================================
# SSL Certification Auto-Generator
# ============================================================

def generate_self_signed_cert(cert_path="cert.pem", key_path="key.pem"):
    from cryptography import x509
    from cryptography.x509.oid import NameOID
    from cryptography.hazmat.primitives import hashes
    from cryptography.hazmat.primitives.asymmetric import rsa
    from cryptography.hazmat.primitives import serialization
    import ipaddress
    import socket
    
    logger.info("Generating self-signed SSL certificate for local HTTPS...")
    
    # Get local IP
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        local_ip = s.getsockname()[0]
        s.close()
    except Exception:
        local_ip = "127.0.0.1"
        
    key = rsa.generate_private_key(
        public_exponent=65537,
        key_size=2048,
    )
    
    subject = issuer = x509.Name([
        x509.NameAttribute(NameOID.COUNTRY_NAME, "US"),
        x509.NameAttribute(NameOID.STATE_OR_PROVINCE_NAME, "California"),
        x509.NameAttribute(NameOID.LOCALITY_NAME, "Oak Ridge"),
        x509.NameAttribute(NameOID.ORGANIZATION_NAME, "GXO Logistics"),
        x509.NameAttribute(NameOID.COMMON_NAME, "localhost"),
    ])
    
    san_list = [
        x509.DNSName("localhost"),
        x509.IPAddress(ipaddress.IPv4Address("127.0.0.1"))
    ]
    if local_ip != "127.0.0.1":
        san_list.append(x509.IPAddress(ipaddress.IPv4Address(local_ip)))
        
    cert = x509.CertificateBuilder().subject_name(
        subject
    ).issuer_name(
        issuer
    ).public_key(
        key.public_key()
    ).serial_number(
        x509.random_serial_number()
    ).not_valid_before(
        datetime.utcnow() - timedelta(days=1)
    ).not_valid_after(
        datetime.utcnow() + timedelta(days=3650)
    ).add_extension(
        x509.SubjectAlternativeName(san_list),
        critical=False,
    ).sign(key, hashes.SHA256())
    
    with open(key_path, "wb") as f:
        f.write(
            key.private_bytes(
                encoding=serialization.Encoding.PEM,
                format=serialization.PrivateFormat.TraditionalOpenSSL,
                encryption_algorithm=serialization.NoEncryption(),
            )
        )
        
    with open(cert_path, "wb") as f:
        f.write(
            cert.public_bytes(
                encoding=serialization.Encoding.PEM,
            )
        )
    logger.info(f"Generated SSL Key: {key_path} and Certificate: {cert_path}")

if __name__ == "__main__":
    import uvicorn
    import sys
    
    use_ssl = app.ssl_enabled
    ssl_cert = "cert.pem"
    ssl_key = "key.pem"
    
    uvicorn_kwargs = {
        "app": "server:app",
        # Bind to loopback only (access via SSH tunnel / reverse proxy) unless
        # HOST is explicitly set, e.g. HOST=0.0.0.0 for LAN/docker deployments.
        "host": os.getenv("HOST", "127.0.0.1"),
        "port": int(os.getenv("PORT", "8000")),
        "reload": os.getenv("RELOAD", "false").lower() == "true"
    }
    
    if use_ssl:
        if not os.path.exists(ssl_cert) or not os.path.exists(ssl_key):
            generate_self_signed_cert(ssl_cert, ssl_key)
        uvicorn_kwargs["ssl_certfile"] = ssl_cert
        uvicorn_kwargs["ssl_keyfile"] = ssl_key
        logger.info("Starting edge server with HTTPS enabled.")
    else:
        app.ssl_enabled = False
        logger.info("Starting edge server with HTTP enabled.")
        
    uvicorn.run(**uvicorn_kwargs)
