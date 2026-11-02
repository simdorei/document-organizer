import path from 'node:path';
import { rm, rename } from 'node:fs/promises';
import { unpackZip } from './archive.js';
import { EXTENSIONS, appError } from './config.js';
import { newFile } from './store.js';
import { parseFile } from './parser.js';
import { outgoing, batches, analysisFingerprint, analyzeBatch, createClient } from './analysis.js';

export class JobRunner {
  constructor(store, parser = parseFile) { this.store = store; this.parser = parser; this.active = null; }
  assertIdle() { if (this.active) throw appError('다른 작업이 진행 중입니다. 완료 후 실행해 주세요.', 409); }
  launch(job, work) {
    this.assertIdle(); this.active = job.id;
    this.task = work().catch(async error => { job.status = 'failed'; job.error = error.message; await this.store.save(job); })
      .finally(() => { this.active = null; });
    // Filesystem failures must not create unhandled rejections; status is still visible in memory.
    this.task.catch(() => { job.error = '결과 저장에 실패했습니다. 저장 공간과 폴더 권한을 확인해 주세요.'; });
  }
  read(job, uploadPath, filename) {
    this.launch(job, async () => {
      if (path.extname(filename).toLowerCase() === '.zip') {
        // Preserve the uploaded archive even if one entry fails.
        await rename(uploadPath, path.join(this.store.directory(job.id), 'input.zip'));
        try { await unpackZip(path.join(this.store.directory(job.id), 'input.zip'), job, this.store); }
        catch (error) {
          job.ingestError = error.statusCode ? error.message : 'ZIP 전체 목록을 읽지 못했습니다. 손상되었거나 지원하지 않는 압축 파일입니다. 추출된 항목만 표시합니다.';
        }
      } else {
        const file = newFile(filename, job.uploadSize); job.files.push(file);
        if (!EXTENSIONS.has(file.extension)) {
          file.readStatus = 'unsupported'; file.error = '지원하지 않는 파일 형식입니다.';
          await rm(uploadPath, { force: true });
        } else {
          await rename(uploadPath, this.store.original(job, file)); file.hasOriginal = true;
        }
      }
      for (const file of job.files.filter(f => f.readStatus === 'pending')) await this.readOne(job, file);
      job.status = 'ready';
      job.error = job.ingestError || (!job.files.length ? '읽을 파일이 없습니다.' : null);
      await this.store.save(job);
    });
  }
  async readOne(job, file, forceOcr = false) {
    file.readStatus = 'reading'; file.error = null; await this.store.save(job);
    try {
      const result = await this.parser(this.store.original(job, file), file.extension, forceOcr);
      await this.store.writeResult(job, file, 'parsed', result);
      file.warnings = result.warnings;
      file.readStatus = result.warnings.some(w => w.code !== 'OCR_APPLIED') ? 'review' : 'ready';
      file.chars = result.chars; file.sourceCount = result.sources.length; file.pageCount = result.pageCount;
    } catch (error) { file.readStatus = 'failed'; file.error = error.message; }
    await this.store.save(job);
  }
  retryRead(job, file, forceOcr) {
    if (!file.hasOriginal) throw appError('보관된 원본이 없습니다. 다시 업로드해 주세요.');
    if (file.analysisStatus !== 'pending') throw appError('분석 이력이 있는 파일은 새 작업으로 올려 주세요. 기존 근거를 보존합니다.');
    this.launch(job, async () => {
      job.status = 'reading'; await this.readOne(job, file, forceOcr); job.status = 'ready'; job.error = job.ingestError || null; await this.store.save(job);
    });
  }
  analyze(job, { apiKey, purpose, model, masked, fileIds }, clientFactory = createClient) {
    if (job.analysisOptions && JSON.stringify(job.analysisOptions) !== JSON.stringify({ purpose, model, masked })) {
      throw appError('이 작업은 이전 목적·모델·가림 설정으로만 이어서 분석할 수 있습니다. 설정을 바꾸려면 새 작업으로 올려 주세요.');
    }
    const files = job.files.filter(f => fileIds.includes(f.id) && ['ready', 'review'].includes(f.readStatus) &&
      f.sourceCount !== 0 && !['complete', 'review'].includes(f.analysisStatus));
    if (!files.length) throw appError('새로 분석할 파일이 없습니다. 읽기 상태와 선택한 파일을 확인해 주세요.');
    const client = clientFactory(apiKey);
    this.launch(job, async () => {
      job.status = 'analyzing'; job.error = job.ingestError || null; job.analysisOptions = { purpose, model, masked }; await this.store.save(job);
      for (const file of files) {
        const parsed = await this.store.readResult(job, file, 'parsed');
        const sources = outgoing(parsed, masked), groups = batches(sources);
        const fingerprint = analysisFingerprint(sources, purpose, model);
        let checkpoint = await this.store.readResult(job, file, 'analysis');
        if (checkpoint && checkpoint.fingerprint !== fingerprint) {
          throw appError('이전 분석과 목적·모델·가림 설정이 다릅니다. 이전 설정으로 이어서 분석하거나 새 작업으로 올려 주세요.');
        }
        checkpoint ||= { fingerprint, purpose, model, masked, total: groups.length, parts: [] };
        file.analysisStatus = 'running'; file.analysisError = null;
        file.analysisProgress = `${checkpoint.parts.filter(Boolean).length}/${groups.length}`;
        await this.store.save(job);
        try {
          for (let i = 0; i < groups.length; i++) {
            if (checkpoint.parts[i]) continue;
            checkpoint.parts[i] = await analyzeBatch(client, groups[i], purpose, model);
            await this.store.writeResult(job, file, 'analysis', checkpoint);
            file.analysisProgress = `${i + 1}/${groups.length}`; await this.store.save(job);
          }
          file.analysisStatus = checkpoint.parts.some(p => p.result.rejected.length) ? 'review' : 'complete';
          await this.store.save(job);
        } catch (error) {
          file.analysisStatus = 'failed'; file.analysisError = error.message;
          job.status = 'ready'; job.error = [job.ingestError, '분석을 멈췄습니다. 완료된 구간은 보존했습니다. 오류를 확인한 뒤 다시 실행할 수 있습니다.'].filter(Boolean).join(' ');
          await this.store.save(job); return;
        }
      }
      job.status = 'ready'; await this.store.save(job);
    });
  }
}
