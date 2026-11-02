import { spawn } from 'node:child_process';
import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { ROOT, MODEL_HOME } from '../src/config.js';

await mkdir(MODEL_HOME, { recursive: true });
console.log('공개 한국어 OCR 모델을 다운로드하고 검증합니다. 사용자 문서는 전송하지 않습니다.');
const child = spawn(process.execPath, [path.join(ROOT, 'node_modules/kordoc/dist/cli.js'), 'check-ocr-models'], {
  env: { ...process.env, KORDOC_MODEL_CACHE: MODEL_HOME, KORDOC_OFFLINE: '0' },
  stdio: 'inherit', windowsHide: true,
});
child.on('error', () => { console.error('모델 설치를 시작하지 못했습니다.'); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
