import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT } from '../src/config.js';

let count = 0;
for (const dir of ['src', 'public', 'scripts', 'test']) {
  for (const file of await readdir(path.join(ROOT, dir))) {
    if (!file.endsWith('.js')) continue;
    const result = spawnSync(process.execPath, ['--check', path.join(ROOT, dir, file)], { encoding: 'utf8', windowsHide: true });
    if (result.status !== 0) { console.error(result.stderr); process.exitCode = 1; }
    count++;
  }
}
console.log(`${count}개 JavaScript 파일 문법 검사${process.exitCode ? ' 실패' : ' 통과'}`);
