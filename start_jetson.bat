@echo off
echo ============================================================
echo Starting GXO Loadout on Jetson Orin (Windows Dev Environment)
echo ============================================================
echo.
echo [1/3] Installing Python dependencies...
pip install -r requirements.txt
if %errorlevel% neq 0 (
    echo.
    echo ERROR: Failed to install Python dependencies.
    pause
    exit /b %errorlevel%
)
echo.
echo [2/3] Installing Node packages and building frontend...
call npm install
call npm run build
if %errorlevel% neq 0 (
    echo.
    echo ERROR: Frontend build failed.
    pause
    exit /b %errorlevel%
)
echo.
echo [3/3] Launching Edge Server on http://localhost:8000 ...
REM Point inference at the Vast.ai Cosmos server (see deploy\vastai\README.md):
REM set COSMOS_ENDPOINT=http://your-vast-ip:port/v1
REM set COSMOS_API_KEY=your-vllm-api-key
python server.py
pause
