import ExcelJS from 'exceljs';
import { mergeParts } from './analysis.js';

export async function exportWorkbook(job, store) {
  const book = new ExcelJS.Workbook();
  book.creator = 'Document Organizer'; book.created = new Date();
  const sheet = (name, columns) => {
    const s = book.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] });
    s.columns = columns.map(([header, width]) => ({ header, width }));
    s.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    s.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF183C39' } };
    s.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
    return s;
  };
  const files = sheet('파일목록', [['파일', 45], ['읽기 상태', 18], ['분석 상태', 18], ['문서 종류', 24], ['AI 요약·검토 전', 70], ['오류·주의', 70]]);
  const facts = sheet('핵심항목', [['파일', 45], ['분류', 15], ['항목', 25], ['원문 값', 40], ['위치', 24], ['근거 번호', 14], ['원문 인용', 80], ['사람 확인 필요', 25]]);
  const notes = sheet('확인할사항', [['파일', 45], ['확인할 사항', 100]]);
  const sources = sheet('추출원문', [['파일', 45], ['근거 번호', 14], ['위치', 25], ['추출된 글·OCR 오류 가능', 110]]);
  const statuses = { ready: '읽기 완료', review: '확인 필요', failed: '실패', unsupported: '지원 안 함', pending: '대기',
    reading: '읽는 중', running: '분석 중', complete: '분석 완료' };
  // Always write plain string cells; document text beginning '=' never becomes a formula.
  const row = (s, values) => {
    const strings = values.map(v => String(v ?? ''));
    const parts = Math.max(1, ...strings.map(v => Math.ceil(v.length / 32000)));
    for (let i = 0; i < parts; i++) {
      const r = s.addRow(strings.map((v, index) => index === 0 ? v : v.slice(i * 32000, (i + 1) * 32000)));
      r.alignment = { vertical: 'top', wrapText: true };
    }
  };
  row(notes, ['', 'AI 정리 결과입니다. 원본과 대조해 주세요. 세액·비과세·필요경비 인정 여부를 판정하지 않습니다.']);
  if (job.error) row(notes, ['', job.error]);
  for (const file of job.files) {
    const parsed = await store.readResult(job, file, 'parsed');
    const checkpoint = await store.readResult(job, file, 'analysis');
    const result = checkpoint ? mergeParts(checkpoint) : null;
    row(files, [file.name, statuses[file.readStatus], statuses[file.analysisStatus], result?.documentType, result?.summary,
      [file.error, file.analysisError, ...file.warnings.map(w => w.message)].filter(Boolean).join('\n')]);
    if (result && !result.complete) row(notes, [file.name, `분석 미완료: ${result.completed}/${result.total}구간. 완료된 구간만 포함합니다.`]);
    for (const fact of result?.facts || []) row(facts, [file.name, fact.category, fact.label, fact.value, fact.location, fact.sourceId, fact.quote, '미검토']);
    for (const note of result?.reviewNotes || []) row(notes, [file.name, note]);
    for (const warning of file.warnings) row(notes, [file.name, warning.message]);
    for (const source of parsed?.sources || []) row(sources, [file.name, source.id, source.label, source.text]);
  }
  return book.xlsx.writeBuffer();
}
