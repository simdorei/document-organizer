import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { zip, temporary } from './helpers.js';
import { JobStore } from '../src/store.js';
import { unpackZip } from '../src/archive.js';
import { LIMITS } from '../src/config.js';

test('ZIP preserves nested Korean names and duplicate names as different originals; unsafe entries stay visible', async t => {
  const dir = await temporary(t), store = new JobStore(dir); await store.init(); const job = await store.create('bundle.zip');
  const archive = path.join(dir, 'input.zip');
  await writeFile(archive, zip([
    { name: '계약/계약서.txt', data: '계약금 1,000원' }, { name: '계약/계약서.txt', data: '잔금 2,000원' },
    { name: '../outside.txt', data: 'escape' }, { name: 'nested.zip', data: 'not expanded' },
    { name: 'secret.txt', flags: 0x801, data: 'encrypted' }, { name: 'bad.txt', data: 'broken checksum', crc: 1 },
    { name: 'link.txt', attrs: (0xa000 << 16) >>> 0, data: 'target' }, { name: 'file.exe', data: 'unsupported' },
    { name: Buffer.from([255, 254, 46, 116, 120, 116]), flags: 0x800, data: 'bad filename' },
  ]));
  await unpackZip(archive, job, store);
  assert.equal(job.files.length, 9); assert.equal(job.files[0].name, '계약/계약서.txt');
  assert.equal(await readFile(store.original(job, job.files[0]), 'utf8'), '계약금 1,000원');
  assert.equal(await readFile(store.original(job, job.files[1]), 'utf8'), '잔금 2,000원');
  assert.deepEqual(job.files.slice(2).map(f => f.readStatus), ['failed', 'unsupported', 'failed', 'failed', 'failed', 'unsupported', 'failed']);
  assert.equal((await readdir(path.join(store.directory(job.id), 'originals'))).length, 2);
});

test('ZIP expansion and file count limits are explicit', async t => {
  const dir = await temporary(t), store = new JobStore(dir); await store.init();
  const archive = path.join(dir, 'input.zip'); await writeFile(archive, zip([{ name: 'a.txt', data: '123456789' }, { name: 'b.txt', data: 'next' }]));
  const sizeJob = await store.create('size'); await unpackZip(archive, sizeJob, store, { ...LIMITS, file: 5 });
  assert.equal(sizeJob.files[0].readStatus, 'failed'); assert.equal(sizeJob.files[1].hasOriginal, true);
  const countJob = await store.create('count');
  await assert.rejects(unpackZip(archive, countJob, store, { ...LIMITS, files: 1 }), /초과/);
});
