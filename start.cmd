@echo off
chcp 65001 >nul
cd /d "%~dp0"
node -e "process.exit(Number(process.versions.node.split('.')[0]) >= 24 ? 0 : 1)" >nul 2>&1
if errorlevel 1 (
  echo Node.js 24 이상을 설치한 뒤 setup.cmd를 먼저 실행해 주세요.
  pause
  exit /b 1
)
if not exist "node_modules\kordoc\package.json" (
  echo setup.cmd를 먼저 실행해 주세요.
  pause
  exit /b 1
)
node src/main.js
if errorlevel 1 pause
