import sharp from 'sharp';
import ExcelJS from 'exceljs';
import { markdownToHwpx } from 'kordoc';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { ROOT } from '../src/config.js';
import { parseFile } from '../src/parser.js';
import { zip, scanPdf } from '../test/helpers.js';

const folder = path.join(ROOT, 'test-artifacts', 'local-ocr'); await mkdir(folder, { recursive: true });
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="700"><rect width="100%" height="100%" fill="white"/><g font-family="Malgun Gothic" font-size="50" fill="black"><text x="100" y="140">자료 정리 테스트 — 가상 증빙</text><text x="100" y="270">중개보수 영수증</text><text x="100" y="380">지급일 2026-01-31</text><text x="100" y="490">금액 1,250,000원</text></g></svg>`;
const png = await sharp(Buffer.from(svg)).png().toBuffer();
const jpeg = await sharp(png).jpeg().toBuffer();
const workbook = new ExcelJS.Workbook(); workbook.addWorksheet('비용').addRows([['항목', '금액'], ['중개보수', '1,250,000원']]);
const docs = [
  ['영수증.png', png, ['1,250,000', '2026']],
  ['영수증.jpg', jpeg, ['1,250,000', '2026']],
  ['영수증.webp', await sharp(png).webp().toBuffer(), ['1,250,000', '2026']],
  ['스캔영수증.pdf', scanPdf(jpeg, 1600, 700), ['1,250,000', '2026']],
  ['비용.xlsx', await workbook.xlsx.writeBuffer(), ['중개보수', '1,250,000']],
  ['계약.hwpx', Buffer.from(await markdownToHwpx('# 가상 매매 계약\n\n잔금일 2026-01-31\n\n매매금액 450,000,000원')), ['450,000,000', '2026']],
  ['그림포함.docx', zip([
    { name: '[Content_Types].xml', data: '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>' },
    { name: '_rels/.rels', data: '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>' },
    { name: 'word/document.xml', data: '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body><w:p><w:r><w:t>가상 비용 증빙 모음</w:t></w:r></w:p><w:p><w:r><w:drawing><wp:inline><wp:extent cx="6000000" cy="3000000"/><wp:docPr id="1" name="증빙"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:blipFill><a:blip r:embed="rIdImg"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p></w:body></w:document>' },
    { name: 'word/_rels/document.xml.rels', data: '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdImg" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/receipt.png"/></Relationships>' },
    { name: 'word/media/receipt.png', data: png },
  ]), ['가상 비용 증빙 모음', '1,250,000', '2026']],
];
const report = [];
for (const [name, buffer, expected] of docs) {
  const filename = path.join(folder, name); await writeFile(filename, buffer); const started = Date.now();
  const result = await parseFile(filename, path.extname(name)); const text = result.sources.map(s => s.text).join('\n');
  for (const part of expected) assert.ok(text.includes(part), `${name}에서 ${part}을 찾지 못함: ${text}`);
  report.push({ file: name, chars: result.chars, sources: result.sources.length, warnings: result.warnings, seconds: (Date.now() - started) / 1000 });
  console.log(`${name}: 원문 값 확인 통과 (${report.at(-1).seconds}초)`);
}
await writeFile(path.join(folder, '가상자료.zip'), zip([...docs.map(([name, data]) => ({ name, data })), { name: '참고/지원안함.heic', data: 'synthetic unsupported file' }]));
await writeFile(path.join(folder, 'report.json'), JSON.stringify(report, null, 2));
console.log('가상 자료만 사용했습니다. Claude API 호출 없음.');
