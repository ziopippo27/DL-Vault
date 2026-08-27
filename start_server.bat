@echo off
call venv\Scripts\activate.bat
echo Avvio del server DL-Vault in corso...
start http://localhost:8000
uvicorn dashboard.main:app --host 0.0.0.0 --port 8000 --reload
pause
