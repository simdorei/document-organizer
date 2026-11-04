import { mkdir, readFile, readdir, writeFile, rename, realpath, rm } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DATA_HOME, appError } from './config.js';

export class JobStore {
  constructor(home = DATA_HOME) { this.home = path.resolve(home); this.jobs = new Map(); }
  directory(id) { if (!/^[\da-f-]{36}$/.test(id)) throw appError('잘못된 작업 번호입니다.'); return path.join(this.home, 'jobs', id); }
  async init() {
    await mkdir(path.join(this.home, 'jobs'), { recursive: true });
    for (const name of await readdir(path.join(this.home, 'jobs'))) {
      if (!/^[\da-f-]{36}$/.test(name)) continue;
      let job;
      try { job = JSON.parse(await readFile(path.join(this.directory(name), 'job.json'), 'utf8')); }
      catch (error) {
        // The final deletion can leave an empty directory if the process stops.
        if (error.code === 'ENOENT' && !(await readdir(this.directory(name))).length) continue;
        throw error;
      }
      if (job.status === 'deleting') {
        job.status = 'delete_failed'; job.error = '삭제 도중 프로그램이 종료됐습니다. 일부 보관 자료가 남아 있을 수 있으니 삭제를 다시 실행해 주세요.';
        for (const file of job.files) { file.readStatus = 'failed'; file.error = job.error; }
      }
      if (job.status === 'reading' || job.status === 'analyzing') {
        job.status = 'interrupted';
        job.error = '프로그램이 종료되어 처리가 중단되었습니다. 완료된 결과는 보존했습니다.';
        for (const file of job.files) {
          if (['reading', 'pending'].includes(file.readStatus)) { file.readStatus = 'failed'; file.error = '문서 읽기 전 또는 읽는 중 프로그램 종료. 원본이 있으면 다시 읽을 수 있습니다.'; }
          if (file.analysisStatus === 'running') { file.analysisStatus = 'failed'; file.analysisError = '응답 확인 전 프로그램 종료. 과금 여부는 Console에서 확인하세요.'; }
        }
      }
      this.jobs.set(job.id, job);
    }
  }
  async create(name) {
    const job = { id: randomUUID(), name, createdAt: new Date().toISOString(), status: 'reading', files: [], error: null };
    await mkdir(path.join(this.directory(job.id), 'originals'), { recursive: true });
    this.jobs.set(job.id, job);
    await this.save(job);
    return job;
  }
  get(id) { const job = this.jobs.get(id); if (!job) throw appError('작업을 찾을 수 없습니다.', 404); return job; }
  file(jobId, fileId) {
    const job = this.get(jobId), file = job.files.find(f => f.id === fileId);
    if (!file) throw appError('파일을 찾을 수 없습니다.', 404);
    return { job, file };
  }
  original(job, file) { return path.join(this.directory(job.id), 'originals', file.id + file.extension); }
  async save(job) {
    job.updatedAt = new Date().toISOString();
    const target = path.join(this.directory(job.id), 'job.json');
    const temp = target + '.' + randomUUID() + '.tmp';
    await writeFile(temp, JSON.stringify(job), { encoding: 'utf8', mode: 0o600 });
    await rename(temp, target);
  }
  async writeResult(job, file, type, result) {
    const target = path.join(this.directory(job.id), `${file.id}.${type}.json`);
    const temp = target + '.' + randomUUID() + '.tmp';
    await writeFile(temp, JSON.stringify(result), { encoding: 'utf8', mode: 0o600 });
    await rename(temp, target);
  }
  async readResult(job, file, type) {
    try { return JSON.parse(await readFile(path.join(this.directory(job.id), `${file.id}.${type}.json`), 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  }
  async remove(id) {
    const job = this.get(id);
    const root = await realpath(path.join(this.home, 'jobs'));
    const target = await realpath(this.directory(id));
    if (path.dirname(target) !== root || path.basename(target) !== id) throw appError('작업 저장 폴더 밖의 자료는 삭제할 수 없습니다.', 409);
    job.status = 'deleting'; await this.save(job);
    try {
      // Keep the manifest until the payload is gone, so interrupted deletion can be retried.
      for (const entry of await readdir(target)) {
        if (entry !== 'job.json') await rm(path.join(target, entry), { recursive: true, force: true, maxRetries: 2, retryDelay: 100 });
      }
      await rm(target, { recursive: true, force: true, maxRetries: 2, retryDelay: 100 });
    } catch {
      job.status = 'delete_failed'; job.error = '보관 자료를 모두 삭제하지 못했습니다. 일부는 이미 삭제됐을 수 있습니다. 원본 보기·다운로드 창을 닫고 삭제를 다시 실행해 주세요.';
      for (const file of job.files) { file.readStatus = 'failed'; file.error = job.error; }
      await this.save(job);
      throw appError(job.error, 409);
    }
    this.jobs.delete(id);
  }
  list() { return [...this.jobs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)); }
}

export function newFile(name, size) {
  return { id: randomUUID(), name, size, extension: path.extname(name).toLowerCase(),
    readStatus: 'pending', analysisStatus: 'pending', warnings: [], error: null };
}
