import Fastify from 'fastify';
import multipart from '@fastify/multipart';
import { randomBytes } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { ROOT, DATA_HOME, DEFAULT_MODEL, PURPOSE, LIMITS, EXTENSIONS, appError } from './config.js';
import { JobStore } from './store.js';
import { JobRunner } from './jobs.js';
import { copyLimited } from './archive.js';
import { outgoing, batches, mergeParts } from './analysis.js';
import { exportWorkbook } from './export.js';
import { modelStatus } from './models.js';
import { ocrReview } from './normalize.js';

export async function buildApp({ store = new JobStore(), runner, clientFactory, checkModels = modelStatus, apiKey = process.env.ANTHROPIC_API_KEY || '' } = {}) {
  await store.init();
  runner ||= new JobRunner(store);
  const app = Fastify({ logger: false, bodyLimit: 64_000 });
  const token = randomBytes(32).toString('hex');
  let uploading = false;
  const idle = () => { runner.assertIdle(); if (uploading) throw appError('파일을 넣는 중입니다. 잠시 기다려 주세요.', 409); };
  await app.register(multipart, { limits: { files: 1, fields: 0, parts: 1, fileSize: LIMITS.upload } });
  app.addHook('onRequest', async (request, reply) => {
    const host = request.headers.host || '';
    if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host)) throw appError('이 PC에서만 사용할 수 있습니다.', 403);
    const origin = request.headers.origin;
    if (request.url.startsWith('/api/')) {
      if (origin && origin !== `http://${host}`) throw appError('다른 사이트의 요청을 차단했습니다.', 403);
      if (request.headers['sec-fetch-site'] === 'cross-site') throw appError('다른 사이트의 요청을 차단했습니다.', 403);
    }
    reply.header('Cache-Control', 'no-store');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'SAMEORIGIN');
    reply.header('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob:; frame-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'self'");
    if (request.url.startsWith('/api/') && request.url.split('?')[0] !== '/api/session') {
      const download = request.method === 'GET' && /\/(original|export)$/.test(request.url.split('?')[0]);
      const provided = request.headers['x-app-token'] || (download ? request.query?.token : null);
      if (provided !== token) throw appError('화면을 새로고침한 뒤 다시 실행해 주세요.', 403);
    }
  });
  app.setErrorHandler((error, _request, reply) => {
    const status = error.statusCode || 500;
    reply.status(status).send({ error: status >= 500 ? '처리에 실패했습니다. 저장 공간과 설치 상태를 확인해 주세요.' : error.message });
  });
  for (const [route, file, mime] of [['/', 'index.html', 'text/html'], ['/app.js', 'app.js', 'application/javascript'],
    ['/style.css', 'style.css', 'text/css']]) {
    app.get(route, async (_request, reply) => reply.type(`${mime}; charset=utf-8`).send(await readFile(path.join(ROOT, 'public', file))));
  }
  app.get('/favicon.ico', async (_request, reply) => reply.code(204).send());
  app.get('/api/session', async () => ({ token, version: '0.1.0' }));
  app.get('/api/settings', async () => ({ hasKey: Boolean(apiKey), model: DEFAULT_MODEL, purpose: PURPOSE,
    dataHome: store.home, limits: LIMITS, ocr: await checkModels() }));
  app.post('/api/settings', async request => {
    idle();
    if (request.body?.clearKey === true) apiKey = '';
    else if (typeof request.body?.apiKey === 'string' && /^sk-ant-[\w-]{10,}$/.test(request.body.apiKey.trim())) apiKey = request.body.apiKey.trim();
    else throw appError('Anthropic Console에서 발급한 sk-ant-로 시작하는 API 키를 입력해 주세요.');
    return { hasKey: Boolean(apiKey) };
  });
  app.get('/api/jobs', async () => ({ jobs: store.list(), active: runner.active, uploading }));
  app.get('/api/jobs/:id', async request => store.get(request.params.id));
  app.post('/api/jobs', async request => {
    idle(); uploading = true;
    let job, uploadPath;
    try {
      let count = 0;
      for await (const part of request.parts()) {
        if (part.type !== 'file' || ++count > 1) throw appError('ZIP 또는 파일 하나를 넣어 주세요.');
        const filename = path.basename(part.filename.replaceAll('\\', '/')).replace(/[\x00-\x1f]/g, '').slice(0, 250);
        const extension = path.extname(filename).toLowerCase();
        if (!filename || (!EXTENSIONS.has(extension) && extension !== '.zip')) throw appError('지원하지 않는 파일 형식입니다.');
        job = await store.create(filename); uploadPath = path.join(store.directory(job.id), 'input.part');
        const result = await copyLimited(part.file, uploadPath, extension === '.zip' ? LIMITS.upload : LIMITS.file);
        if (part.file.truncated) throw appError('업로드 크기 제한을 넘었습니다.');
        job.uploadSize = result.size;
      }
      if (!job) throw appError('파일을 선택해 주세요.');
      uploading = false;
      runner.read(job, uploadPath, job.name);
      return { id: job.id };
    } catch (error) {
      if (uploadPath) await rm(uploadPath, { force: true });
      if (job) { job.status = 'failed'; job.error = '업로드에 실패했습니다. 파일 형식·크기·연결을 확인해 주세요.'; await store.save(job); }
      throw error;
    } finally { uploading = false; }
  });
  app.get('/api/jobs/:id/files/:fileId', async request => {
    const { job, file } = store.file(request.params.id, request.params.fileId);
    const checkpoint = await store.readResult(job, file, 'analysis');
    const parsed = ['ready', 'review'].includes(file.readStatus) ? await store.readResult(job, file, 'parsed') : null;
    if (parsed) parsed.ocrReview = ocrReview(parsed);
    return { file, parsed, analysis: checkpoint ? mergeParts(checkpoint) : null };
  });
  app.get('/api/jobs/:id/files/:fileId/outgoing', async request => {
    const { job, file } = store.file(request.params.id, request.params.fileId);
    const parsed = await store.readResult(job, file, 'parsed');
    if (!parsed || !['ready', 'review'].includes(file.readStatus)) throw appError('문서를 먼저 읽어야 합니다.');
    const sources = outgoing(parsed, request.query.masked !== 'false');
    return { sources, requests: batches(sources).length };
  });
  app.get('/api/jobs/:id/files/:fileId/original', async (request, reply) => {
    const { job, file } = store.file(request.params.id, request.params.fileId);
    if (!file.hasOriginal) throw appError('보관된 원본이 없습니다.', 404);
    const types = { '.pdf': 'application/pdf', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };
    const mime = types[file.extension] || 'application/octet-stream';
    const disposition = mime === 'application/octet-stream' || request.query.download === '1' ? 'attachment' : 'inline';
    reply.header('Content-Disposition', `${disposition}; filename="document${file.extension}"; filename*=UTF-8''${encodeURIComponent(file.name.split('/').at(-1))}`);
    return reply.type(mime).send(createReadStream(store.original(job, file)));
  });
  app.post('/api/jobs/:id/files/:fileId/read', async request => {
    idle(); const { job, file } = store.file(request.params.id, request.params.fileId);
    runner.retryRead(job, file, request.body?.forceOcr === true); return { started: true };
  });
  app.post('/api/jobs/:id/analyze', async request => {
    idle(); if (!apiKey) throw appError('먼저 API 키를 설정해 주세요.');
    const { purpose, model, masked, fileIds, consent } = request.body || {};
    if (consent !== true) throw appError('추출된 글을 Claude API로 보내는 동의가 필요합니다.');
    if (typeof purpose !== 'string' || !purpose.trim() || purpose.length > 4000 || typeof model !== 'string' ||
      !/^claude-[a-z0-9.-]{3,80}$/.test(model) || typeof masked !== 'boolean' || !Array.isArray(fileIds) ||
      fileIds.length > LIMITS.files || fileIds.some(id => typeof id !== 'string')) throw appError('분석 설정을 확인해 주세요.');
    const job = store.get(request.params.id);
    runner.analyze(job, { apiKey, purpose, model, masked, fileIds }, clientFactory);
    return { started: true };
  });
  app.get('/api/jobs/:id/export', async (request, reply) => {
    const job = store.get(request.params.id);
    if (runner.active === job.id) throw appError('작업이 끝난 뒤 내려받아 주세요.', 409);
    reply.header('Content-Disposition', `attachment; filename="document-summary-${job.id.slice(0, 8)}.xlsx"`);
    return reply.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').send(await exportWorkbook(job, store));
  });
  return { app, store, runner };
}
