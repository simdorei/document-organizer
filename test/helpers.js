import { crc32, deflateRawSync } from 'node:zlib';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { ROOT } from '../src/config.js';
import { mkdir } from 'node:fs/promises';

export async function temporary(t) {
  const parent = path.join(ROOT, 'test-artifacts'); await mkdir(parent, { recursive: true });
  const dir = await mkdtemp(path.join(parent, 'run-'));
  t.after(async () => {
    const resolved = path.resolve(dir);
    if (!resolved.startsWith(path.resolve(parent) + path.sep)) throw new Error('Unsafe test cleanup');
    await rm(resolved, { recursive: true, force: true });
  });
  return dir;
}

export function zip(entries) {
  const local = [], central = []; let offset = 0;
  for (const entry of entries) {
    const name = Buffer.isBuffer(entry.name) ? entry.name : Buffer.from(entry.name);
    const data = Buffer.from(entry.data || ''), compressed = deflateRawSync(data), crc = entry.crc ?? crc32(data);
    const flags = entry.flags ?? 0x800;
    const header = Buffer.alloc(30); header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4); header.writeUInt16LE(flags, 6);
    header.writeUInt16LE(8, 8); header.writeUInt32LE(crc, 14); header.writeUInt32LE(compressed.length, 18); header.writeUInt32LE(data.length, 22); header.writeUInt16LE(name.length, 26);
    local.push(header, name, compressed);
    const record = Buffer.alloc(46); record.writeUInt32LE(0x02014b50); record.writeUInt16LE(0x314, 4); record.writeUInt16LE(20, 6);
    record.writeUInt16LE(flags, 8); record.writeUInt16LE(8, 10); record.writeUInt32LE(crc, 16); record.writeUInt32LE(compressed.length, 20);
    record.writeUInt32LE(entry.declaredSize ?? data.length, 24); record.writeUInt16LE(name.length, 28); record.writeUInt32LE(entry.attrs ?? 0, 38); record.writeUInt32LE(offset, 42);
    central.push(record, name); offset += header.length + name.length + compressed.length;
  }
  const centralBuffer = Buffer.concat(central), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(centralBuffer.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, centralBuffer, end]);
}

export function multipartBody(filename, data) {
  const boundary = 'document-organizer-test-boundary';
  return { headers: { 'content-type': `multipart/form-data; boundary=${boundary}` }, payload: Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`), data, Buffer.from(`\r\n--${boundary}--\r\n`),
  ]) };
}

export function scanPdf(jpeg, width, height) {
  const objects = [Buffer.from('<< /Type /Catalog /Pages 2 0 R >>'), Buffer.from('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'),
    Buffer.from(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Resources << /XObject << /Im1 4 0 R >> >> /Contents 5 0 R >>`),
    Buffer.concat([Buffer.from(`<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`), jpeg, Buffer.from('\nendstream')])];
  const content = `q ${width} 0 0 ${height} 0 0 cm /Im1 Do Q`;
  objects.push(Buffer.from(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`));
  const parts = [Buffer.from('%PDF-1.4\n')], offsets = [0]; let position = parts[0].length;
  objects.forEach((object, i) => { offsets.push(position); const chunk = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`), object, Buffer.from('\nendobj\n')]); parts.push(chunk); position += chunk.length; });
  parts.push(Buffer.from(`xref\n0 ${offsets.length}\n0000000000 65535 f \n${offsets.slice(1).map(o => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${position}\n%%EOF`));
  return Buffer.concat(parts);
}
