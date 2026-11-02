import yauzl from 'yauzl';
import { createWriteStream } from 'node:fs';
import { rm } from 'node:fs/promises';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { crc32 } from 'node:zlib';
import { createHash } from 'node:crypto';
import { LIMITS, EXTENSIONS, appError } from './config.js';
import { newFile } from './store.js';

export function validateName(name) {
  if (!name || name.length > 1000 || /[\x00-\x1f]/.test(name) || name.startsWith('/') || name.includes('\\') ||
    name.includes(':') || name.split('/').some(p => p === '..' || p === '.')) throw appError('안전하지 않은 ZIP 내부 경로입니다.');
}
function decodeName(entry) {
  if (entry.generalPurposeBitFlag & 0x800) return new TextDecoder('utf-8', { fatal: true }).decode(entry.fileName);
  try { return new TextDecoder('utf-8', { fatal: true }).decode(entry.fileName); }
  catch { return new TextDecoder('euc-kr', { fatal: true }).decode(entry.fileName); }
}
export async function copyLimited(input, destination, maxBytes, expectedCrc) {
  let size = 0, crc = 0;
  const hash = createHash('sha256');
  const meter = new Transform({ transform(chunk, _encoding, callback) {
    size += chunk.length;
    if (size > maxBytes) return callback(appError('파일 크기 제한을 초과했습니다.'));
    hash.update(chunk); crc = crc32(chunk, crc); callback(null, chunk);
  } });
  try {
    await pipeline(input, meter, createWriteStream(destination, { flags: 'wx', mode: 0o600 }));
    if (expectedCrc !== undefined && crc !== expectedCrc) throw appError('ZIP 파일의 체크섬이 맞지 않습니다. 파일이 손상되었을 수 있습니다.');
    return { size, sha256: hash.digest('hex') };
  } catch (error) { await rm(destination, { force: true }); throw error; }
}
export async function unpackZip(archivePath, job, store, limits = LIMITS) {
  const zip = await new Promise((resolve, reject) => yauzl.open(archivePath,
    { lazyEntries: true, decodeStrings: false, validateEntrySizes: true }, (error, value) => error ? reject(error) : resolve(value)));
  let expanded = 0, count = 0, entries = 0;
  await new Promise((resolve, reject) => {
    let done = false;
    const fail = error => { if (done) return; done = true; zip.close(); reject(error); };
    zip.on('error', fail);
    zip.on('end', () => { if (!done) { done = true; resolve(); } });
    zip.on('entry', entry => {
      async function consume() {
        if (++entries > 2000) throw appError('ZIP 안의 폴더와 파일 항목이 2,000개를 넘습니다. 압축 파일을 나눠 주세요.');
        let name, decodeError = false;
        try { name = decodeName(entry); }
        catch { name = `[이름을 읽을 수 없는 항목 ${count + 1}]`; decodeError = true; }
        if (name.endsWith('/')) { validateName(name); return; }
        if (++count > limits.files) throw appError(`ZIP의 파일 수가 ${limits.files}개를 초과했습니다. 나머지 항목은 읽지 않았습니다.`);
        const file = newFile(name, entry.uncompressedSize);
        job.files.push(file);
        try {
          if (decodeError) throw appError('ZIP 파일 이름의 인코딩을 읽지 못했습니다. UTF-8 ZIP으로 다시 압축해 주세요.');
          validateName(name);
          if ((entry.generalPurposeBitFlag & 1) !== 0) throw appError('암호화된 ZIP 항목은 지원하지 않습니다.');
          if (((entry.externalFileAttributes >>> 16) & 0xf000) === 0xa000) throw appError('심볼릭 링크는 읽지 않습니다.');
          if (entry.uncompressedSize > limits.file) throw appError('개별 파일은 50MB까지 읽을 수 있습니다.');
          expanded += entry.uncompressedSize;
          if (expanded > limits.expanded) throw appError('ZIP 압축 해제 총 크기가 500MB를 초과했습니다.');
          if (!EXTENSIONS.has(file.extension)) {
            file.readStatus = 'unsupported';
            file.error = file.extension === '.zip' ? '중첩 ZIP은 풀어서 다시 넣어 주세요.' : '지원하지 않는 파일 형식입니다.';
            await store.save(job);
            return;
          }
          const input = await new Promise((res, rej) => zip.openReadStream(entry, (error, stream) => error ? rej(error) : res(stream)));
          Object.assign(file, await copyLimited(input, store.original(job, file), limits.file, entry.crc32));
          file.hasOriginal = true;
        } catch (error) { file.readStatus = 'failed'; file.error = error.statusCode ? error.message : 'ZIP 항목을 읽지 못했습니다. 압축 파일을 확인해 주세요.'; }
        await store.save(job);
      }
      consume().then(() => { if (!done) zip.readEntry(); }).catch(fail);
    });
    zip.readEntry();
  });
}
