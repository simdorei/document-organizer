import { mkdir, readFile, readdir, writeFile, rename } from 'node:fs/promises';
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
      const job = JSON.parse(await readFile(path.join(this.directory(name), 'job.json'), 'utf8'));
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
  list() { return [...this.jobs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)); }
}

export function newFile(name, size) {
  return { id: randomUUID(), name, size, extension: path.extname(name).toLowerCase(),
    readStatus: 'pending', analysisStatus: 'pending', warnings: [], error: null };
}
