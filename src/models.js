import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { ROOT, MODEL_HOME } from './config.js';

const exec = promisify(execFile);
export async function modelStatus() {
  try {
    const { stdout } = await exec(process.execPath,
      [path.join(ROOT, 'node_modules/kordoc/dist/cli.js'), 'check-ocr-models', '--status-only'],
      { env: { ...process.env, KORDOC_MODEL_CACHE: MODEL_HOME, KORDOC_OFFLINE: '1' }, windowsHide: true, timeout: 30_000 });
    return { checked: true, details: JSON.parse(stdout) };
  } catch { return { checked: false, message: 'OCR 모델 상태를 확인하지 못했습니다. npm run prepare:ocr를 실행해 주세요.' }; }
}
