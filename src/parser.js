import { fork } from 'node:child_process';
import path from 'node:path';
import { ROOT, MODEL_HOME, LIMITS } from './config.js';

export function parseFile(filename, extension, forceOcr = false, timeout = LIMITS.parseMs) {
  return new Promise((resolve, reject) => {
    const worker = fork(path.join(ROOT, 'src/parse-worker.js'), [], {
      env: { ...process.env, KORDOC_OFFLINE: '1', KORDOC_MODEL_CACHE: MODEL_HOME,
        OMP_NUM_THREADS: '2', OPENBLAS_NUM_THREADS: '2' },
      execArgv: ['--max-old-space-size=1024'], windowsHide: true,
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'], serialization: 'advanced',
    });
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true; clearTimeout(timer); worker.kill();
      if (error) reject(error); else resolve(value);
    };
    const timer = setTimeout(() => finish(new Error('문서 읽기가 3분을 넘겨 중단했습니다. 파일을 나누거나 이미지 크기를 줄여 주세요.')), timeout);
    worker.once('error', () => finish(new Error('문서 읽기 프로세스를 시작하지 못했습니다.')));
    worker.once('exit', () => finish(new Error('문서 읽기 프로세스가 종료됐습니다. 손상 파일 또는 메모리 부족을 확인해 주세요.')));
    worker.once('message', message => finish(message.ok ? null : new Error(message.message), message.result));
    worker.send({ filename, extension, forceOcr });
  });
}
