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
python server.py
pause
