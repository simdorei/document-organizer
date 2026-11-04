import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, rename, stat, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { temporary, zip, multipartBody } from './helpers.js';
import { JobStore } from '../src/store.js';
import { JobRunner } from '../src/jobs.js';
import { buildApp } from '../src/server.js';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

async function fixture(t, parser) {
  const dir = await temporary(t), store = new JobStore(path.join(dir, 'state'));
  const runner = new JobRunner(store, parser || (async filename => ({ warnings: [], chars: 5, pageCount: null,
    sources: [{ id: 's1', label: '본문', text: await readFile(filename, 'utf8') }] })));
  const { app } = await buildApp({ store, runner, apiKey: '', checkModels: async () => ({ checked: true }) });
  t.after(() => app.close());
  const token = (await app.inject('/api/session')).json().token, headers = { 'x-app-token': token };
  const upload = async (name, bytes) => {
    const input = multipartBody(name, bytes);
    const response = await app.inject({ method: 'POST', url: '/api/jobs', ...input, headers: { ...input.headers, ...headers } });
    assert.equal(response.statusCode, 200, response.body); await runner.task;
    return store.get(response.json().id);
  };
  return { dir, store, runner, app, headers, token, upload };
}

test('confirmed deletion removes only the chosen import and its stored copies and results, including after restart', async t => {
  const { dir, store, app, headers, token, upload } = await fixture(t);
  const bytes = zip([{ name: '계약.txt', data: '가상 계약 자료' }]);
  const source = path.join(dir, 'source.zip'); await writeFile(source, bytes);
  const removed = await upload('동일한 이름.zip', bytes), kept = await upload('동일한 이름.zip', bytes);
  await store.writeResult(removed, removed.files[0], 'analysis', { synthetic: true });
  await mkdir(path.join(store.home, 'models')); await writeFile(path.join(store.home, 'models', 'keep.txt'), 'model cache');
  const url = `/api/jobs/${removed.id}`;
  assert.equal((await app.inject({ method: 'DELETE', url, headers, payload: { confirm: false } })).statusCode, 400);
  assert.equal((await app.inject({ method: 'DELETE', url, payload: { confirm: true } })).statusCode, 403);
  assert.equal((await app.inject({ method: 'DELETE', url, headers: { ...headers, origin: 'https://evil.test' }, payload: { confirm: true } })).statusCode, 403);
  assert.ok(await stat(store.directory(removed.id)));
  const response = await app.inject({ method: 'DELETE', url, headers, payload: { confirm: true } });
  assert.equal(response.statusCode, 200, response.body); assert.equal(response.json().deleted, true);
  await assert.rejects(stat(store.directory(removed.id)), { code: 'ENOENT' });
  assert.deepEqual(await readFile(source), bytes);
  assert.equal(await readFile(path.join(store.home, 'models', 'keep.txt'), 'utf8'), 'model cache');
  assert.deepEqual(await readFile(path.join(store.directory(kept.id), 'input.zip')), bytes);
  assert.deepEqual((await app.inject({ url: '/api/jobs', headers })).json().jobs.map(j => j.id), [kept.id]);
  for (const endpoint of [url, `${url}/files/${removed.files[0].id}`, `${url}/files/${removed.files[0].id}/original?token=${token}`, `${url}/export?token=${token}`]) {
    assert.equal((await app.inject({ url: endpoint, headers })).statusCode, 404);
  }
  const restarted = new JobStore(store.home); await restarted.init();
  assert.deepEqual(restarted.list().map(j => j.id), [kept.id]);
});

test('an active document read cannot be deleted', async t => {
  const gate = Promise.withResolvers();
  const { app, runner, headers, store } = await fixture(t, async () => { await gate.promise; return { warnings: [], chars: 3, sources: [{ id: 's1', label: '본문', text: '본문' }] }; });
  try {
    const input = multipartBody('reading.txt', Buffer.from('synthetic'));
    const uploaded = await app.inject({ method: 'POST', url: '/api/jobs', ...input, headers: { ...input.headers, ...headers } });
    assert.equal(uploaded.statusCode, 200);
    const response = await app.inject({ method: 'DELETE', url: `/api/jobs/${uploaded.json().id}`, headers, payload: { confirm: true } });
    assert.equal(response.statusCode, 409); assert.ok(await stat(store.directory(uploaded.json().id)));
  } finally { gate.resolve(); await runner.task; }
});

test('deletion locks new mutations and exports until the files are removed, then unlocks', async t => {
  const { app, store, headers, token, upload } = await fixture(t);
  const job = await upload('delete.txt', Buffer.from('synthetic'));
  const started = Promise.withResolvers(), release = Promise.withResolvers(), remove = store.remove.bind(store);
  store.remove = async id => { started.resolve(); await release.promise; await remove(id); };
  const pending = app.inject({ method: 'DELETE', url: `/api/jobs/${job.id}`, headers, payload: { confirm: true } });
  await started.promise;
  try {
    assert.equal((await app.inject({ url: '/api/jobs', headers })).json().deleting, job.id);
    assert.equal((await app.inject({ method: 'DELETE', url: `/api/jobs/${job.id}`, headers, payload: { confirm: true } })).statusCode, 409);
    const input = multipartBody('new.txt', Buffer.from('synthetic'));
    assert.equal((await app.inject({ method: 'POST', url: '/api/jobs', ...input, headers: { ...input.headers, ...headers } })).statusCode, 409);
    assert.equal((await app.inject({ url: `/api/jobs/${job.id}/export?token=${token}`, headers })).statusCode, 409);
  } finally { release.resolve(); }
  assert.equal((await pending).statusCode, 200);
  assert.equal((await app.inject({ url: '/api/jobs', headers })).json().deleting, null);
  assert.equal((await app.inject({ method: 'POST', url: '/api/settings', headers, payload: { clearKey: true } })).statusCode, 200);
});

test('a linked folder outside the selected job is rejected and deletion failure does not leave the server locked', async t => {
  const { dir, app, store, headers, upload } = await fixture(t);
  const job = await upload('linked.txt', Buffer.from('synthetic'));
  const outside = path.join(dir, 'outside'); await mkdir(outside); await writeFile(path.join(outside, 'keep.txt'), 'preserve');
  await rename(store.directory(job.id), path.join(dir, 'saved-job'));
  await symlink(outside, store.directory(job.id), 'junction');
  const response = await app.inject({ method: 'DELETE', url: `/api/jobs/${job.id}`, headers, payload: { confirm: true } });
  assert.equal(response.statusCode, 409); assert.match(response.json().error, /폴더 밖/);
  assert.equal(await readFile(path.join(outside, 'keep.txt'), 'utf8'), 'preserve');
  const listing = (await app.inject({ url: '/api/jobs', headers })).json();
  assert.equal(listing.deleting, null); assert.equal(listing.jobs[0].id, job.id);
});

test('interrupted deletion stays visible for retry and never resumes analysis', async t => {
  const { store, upload } = await fixture(t);
  const job = await upload('interrupted.txt', Buffer.from('synthetic'));
  job.status = 'deleting'; await store.save(job);
  const restarted = new JobStore(store.home); await restarted.init();
  const recovered = restarted.get(job.id);
  assert.equal(recovered.status, 'delete_failed'); assert.match(recovered.error, /삭제 도중/);
  assert.equal(recovered.files[0].readStatus, 'failed');
  await restarted.remove(job.id); assert.equal(restarted.list().length, 0);
  await assert.rejects(stat(restarted.directory(job.id)), { code: 'ENOENT' });
});

test('a Windows file lock reports partial deletion, retains the job and permits retry', { skip: process.platform !== 'win32', timeout: 15000 }, async t => {
  const { store, app, headers, upload } = await fixture(t);
  const job = await upload('locked.txt', Buffer.from('synthetic'));
  const locked = path.join(store.directory(job.id), 'locked-copy.txt'); await writeFile(locked, 'synthetic locked copy');
  const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    '$stream = [System.IO.File]::Open($env:DOCUMENT_ORGANIZER_LOCK_FILE, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::None); [Console]::WriteLine("ready"); [Console]::ReadLine() | Out-Null; $stream.Dispose()'],
  { windowsHide: true, env: { ...process.env, DOCUMENT_ORGANIZER_LOCK_FILE: locked }, stdio: ['pipe', 'pipe', 'pipe'] });
  t.after(() => child.kill());
  try {
    const [signal] = await once(child.stdout, 'data'); assert.match(signal.toString(), /ready/);
    const response = await app.inject({ method: 'DELETE', url: `/api/jobs/${job.id}`, headers, payload: { confirm: true } });
    assert.equal(response.statusCode, 409); assert.match(response.json().error, /모두 삭제하지 못/);
    const restarted = new JobStore(store.home); await restarted.init();
    assert.equal(restarted.get(job.id).status, 'delete_failed');
    assert.equal((await app.inject({ url: '/api/jobs', headers })).json().deleting, null);
  } finally { const exited = once(child, 'exit'); child.stdin.end('\n'); await exited; }
  assert.equal((await app.inject({ method: 'DELETE', url: `/api/jobs/${job.id}`, headers, payload: { confirm: true } })).statusCode, 200);
  await assert.rejects(stat(store.directory(job.id)), { code: 'ENOENT' });
});
