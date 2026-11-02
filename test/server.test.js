import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { temporary, zip, multipartBody } from './helpers.js';
import { JobStore } from '../src/store.js';
import { JobRunner } from '../src/jobs.js';
import { buildApp } from '../src/server.js';

async function fixture(t, options = {}) {
  const dir = await temporary(t), store = new JobStore(dir);
  const parser = async filename => ({ fileType: 'text', chars: 20, pageCount: null, warnings: [],
    sources: [{ id: 's1', label: '본문', text: await readFile(filename, 'utf8') }] });
  const runner = new JobRunner(store, options.parser || parser);
  const { app } = await buildApp({ store, runner, checkModels: async () => ({ checked: true, details: { allReady: true } }), apiKey: '', ...options });
  t.after(() => app.close());
  const token = (await app.inject('/api/session')).json().token;
  const headers = { 'x-app-token': token };
  return { app, store, runner, dir, headers, token };
}

test('HTTP rejects foreign origins/hosts and untrusted requests; never returns the API key', async t => {
  const { app, headers } = await fixture(t);
  assert.equal((await app.inject('/api/jobs')).statusCode, 403);
  assert.equal((await app.inject({ url: '/', headers: { 'sec-fetch-site': 'cross-site' } })).statusCode, 200);
  assert.equal((await app.inject({ url: '/api/session', headers: { 'sec-fetch-site': 'cross-site' } })).statusCode, 403);
  assert.equal((await app.inject({ url: '/api/session', headers: { host: 'evil.test' } })).statusCode, 403);
  assert.equal((await app.inject({ method: 'POST', url: '/api/settings', headers: { ...headers, origin: 'https://evil.test' }, payload: { apiKey: 'sk-ant-fake-key' } })).statusCode, 403);
  const fakeKey = 'sk-ant-synthetic-key-for-test';
  assert.equal((await app.inject({ method: 'POST', url: '/api/settings', headers, payload: { apiKey: fakeKey } })).statusCode, 200);
  const settings = await app.inject({ url: '/api/settings', headers }); assert.equal(settings.json().hasKey, true); assert.ok(!settings.body.includes(fakeKey));
  await app.inject({ method: 'POST', url: '/api/settings', headers, payload: { clearKey: true } });
  assert.equal((await app.inject({ url: '/api/settings', headers })).json().hasKey, false);
});

test('ZIP → file ledger → local reading → explicit mocked analysis → valid XLSX with literal money and evidence', async t => {
  let calls = 0;
  const clientFactory = () => ({ messages: { create: async request => {
    calls++; const sources = JSON.parse(request.messages[0].content).sources;
    assert.ok(!sources[0].text.includes('900101-1234567'));
    return { id: 'synthetic-response', stop_reason: 'end_turn', usage: { input_tokens: 100, output_tokens: 50 }, content: [{ type: 'text', text: JSON.stringify({
      title: '=HYPERLINK("evil")', documentType: '가상 계약서', summary: '테스트용 정리', reviewNotes: ['원본 확인'],
      facts: [{ category: '금액', label: '매매금액', value: '450,000,000원', quote: '매매금액 450,000,000원', sourceId: sources[0].id },
        { category: '기타', label: '리터럴 수식', value: '=1+1', quote: '=1+1', sourceId: sources[0].id }],
    }) }] };
  } } });
  const { app, store, runner, headers, token, dir } = await fixture(t, { clientFactory });
  const input = multipartBody('bundle.zip', zip([{ name: '가상/계약.txt', data: '매매금액 450,000,000원\n주민번호 900101-1234567\n=1+1' }, { name: 'unread.heic', data: 'unsupported' }]));
  const upload = await app.inject({ method: 'POST', url: '/api/jobs', ...input, headers: { ...input.headers, ...headers } });
  assert.equal(upload.statusCode, 200, upload.body); await runner.task;
  const job = store.get(upload.json().id); assert.deepEqual(job.files.map(f => f.readStatus), ['ready', 'unsupported']); assert.equal(calls, 0);
  const url = `/api/jobs/${job.id}`;
  const payload = { purpose: '부동산 정리', model: 'claude-sonnet-5-5', masked: true, fileIds: [job.files[0].id], consent: true };
  assert.equal((await app.inject({ method: 'POST', url: `${url}/analyze`, headers, payload })).statusCode, 400);
  await app.inject({ method: 'POST', url: '/api/settings', headers, payload: { apiKey: 'sk-ant-synthetic-key-for-test' } });
  assert.equal((await app.inject({ method: 'POST', url: `${url}/analyze`, headers, payload: { ...payload, consent: false } })).statusCode, 400); assert.equal(calls, 0);
  assert.equal((await app.inject({ method: 'POST', url: `${url}/analyze`, headers, payload })).statusCode, 200); await runner.task;
  assert.equal(calls, 1); assert.equal(job.files[0].analysisStatus, 'complete');
  const detail = (await app.inject({ url: `${url}/files/${job.files[0].id}`, headers })).json(); assert.equal(detail.analysis.facts[0].quote, '매매금액 450,000,000원');
  const original = await app.inject(`${url}/files/${job.files[0].id}/original?token=${token}`); assert.equal(original.statusCode, 200);
  const exported = await app.inject(`${url}/export?token=${token}`); assert.equal(exported.statusCode, 200);
  const book = new ExcelJS.Workbook(); await book.xlsx.load(exported.rawPayload);
  assert.equal(book.worksheets.length, 4); assert.equal(book.getWorksheet('핵심항목').getCell('D2').value, '450,000,000원');
  assert.equal(book.getWorksheet('핵심항목').getCell('D3').value, '=1+1'); assert.equal(book.getWorksheet('핵심항목').getCell('D3').type, ExcelJS.ValueType.String);
  assert.equal(book.getWorksheet('파일목록').getCell('B3').value, '지원 안 함');
  assert.equal(book.getWorksheet('추출원문').getCell('D2').type, ExcelJS.ValueType.String);
  assert.ok(!(await readFile(path.join(store.directory(job.id), 'job.json'), 'utf8')).includes('sk-ant-'));
  const reloaded = new JobStore(dir); await reloaded.init(); assert.equal(reloaded.get(job.id).files[0].analysisStatus, 'complete');
});

test('failed analysis resumes only missing chunks, including after process restart', async t => {
  let calls = 0;
  const { store, runner, dir } = await fixture(t);
  const job = await store.create('long.txt'); job.status = 'ready';
  const file = { id: '00000000-0000-0000-0000-000000000001', name: 'long.txt', readStatus: 'ready', analysisStatus: 'pending', warnings: [] };
  job.files.push(file);
  await store.writeResult(job, file, 'parsed', { sources: [{ id: 's1', label: '본문', text: 'a'.repeat(9000) }, { id: 's2', label: '본문', text: 'b'.repeat(9000) }] }); await store.save(job);
  const factory = () => ({ messages: { create: async () => {
    calls++; if (calls === 2) throw Object.assign(new Error('mock timeout'), { status: 429 });
    return { stop_reason: 'end_turn', id: `mock${calls}`, usage: {}, content: [{ type: 'text', text: JSON.stringify({ title: '가상', documentType: '메모', summary: '테스트', facts: [], reviewNotes: [] }) }] };
  } } });
  const options = { apiKey: 'fake', purpose: '정리', model: 'claude-sonnet-5-5', masked: true, fileIds: [file.id] };
  runner.analyze(job, options, factory); await runner.task; assert.equal(calls, 2); assert.equal(file.analysisStatus, 'failed');
  const store2 = new JobStore(dir); await store2.init(); const runner2 = new JobRunner(store2);
  runner2.analyze(store2.get(job.id), options, factory); await runner2.task;
  assert.equal(calls, 3); assert.equal(store2.get(job.id).files[0].analysisStatus, 'complete');
});

test('restart never automatically repeats an interrupted paid request', async t => {
  const { store, dir } = await fixture(t); const job = await store.create('interrupted');
  job.status = 'analyzing'; job.files.push({ id: 'test', readStatus: 'ready', analysisStatus: 'running' }); await store.save(job);
  const recovered = new JobStore(dir); await recovered.init();
  assert.equal(recovered.get(job.id).status, 'interrupted'); assert.equal(recovered.get(job.id).files[0].analysisStatus, 'failed');
  assert.match(recovered.get(job.id).files[0].analysisError, /과금/);
});

test('a partially enumerated ZIP remains marked incomplete after rereading a valid extracted file', async t => {
  const { app, headers, store, runner } = await fixture(t);
  const input = multipartBody('too-many.zip', zip([{ name: 'a.txt', data: '보존할 글' },
    ...Array.from({ length: 2000 }, (_, i) => ({ name: `folder${i}/`, data: '' }))]));
  const upload = await app.inject({ method: 'POST', url: '/api/jobs', ...input, headers: { ...input.headers, ...headers } });
  assert.equal(upload.statusCode, 200); await runner.task;
  const job = store.get(upload.json().id); assert.match(job.error, /2,000/); assert.equal(job.files[0].readStatus, 'ready');
  runner.retryRead(job, job.files[0], false); await runner.task; assert.match(job.error, /2,000/);
});
