@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

node -e "process.exit(Number(process.versions.node.split('.')[0]) >= 24 ? 0 : 1)" >nul 2>&1
if errorlevel 1 goto node_required
where npm.cmd >nul 2>&1
if errorlevel 1 goto node_required

echo [1/3] 필요한 프로그램을 설치합니다. 처음에는 인터넷 연결이 필요합니다.
call npm.cmd ci --include=optional --no-fund --no-audit
if errorlevel 1 goto failed

echo [2/3] 공개 한국어 OCR 모델을 준비합니다. 사용자 문서는 전송하지 않습니다.
call npm.cmd run prepare:ocr
if errorlevel 1 goto failed

echo [3/3] 로컬 OCR 실행 환경을 확인합니다.
node scripts/verify-setup.js
if errorlevel 1 goto failed

echo.
echo 설치 완료. start.cmd를 실행한 뒤 Chrome에서 http://127.0.0.1:4178 을 여세요.
if /i not "%~1"=="--no-pause" pause
exit /b 0

:node_required
echo Node.js 24 이상과 npm이 필요합니다.
echo https://nodejs.org/en/download 에서 Node.js 24 LTS를 설치한 뒤 이 파일을 다시 실행하세요.
if /i not "%~1"=="--no-pause" pause
exit /b 1

:failed
echo.
echo 설치가 완료되지 않았습니다. 위 오류를 확인하세요. 문서와 기존 결과는 삭제하지 않았습니다.
if /i not "%~1"=="--no-pause" pause
exit /b 1
