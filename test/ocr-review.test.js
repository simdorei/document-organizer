import test from 'node:test';
import assert from 'node:assert/strict';
import { normalize } from '../src/normalize.js';
import { outgoing } from '../src/analysis.js';

const line = (text, confidence, dropped = false) => ({ text, confidence, dropped, box: { x: 10, y: 20, w: 200, h: 30 } });
const page = (pageNumber, lines) => ({ pageNumber, width: 800, height: 1200, scale: 3, deskewAngle: 0, lines });

test('uncertain OCR identifies the exact page, line, text and reason without flagging every line', () => {
  const result = normalize({ success: true, fileType: 'pdf', pageCount: 2,
    pages: [{ pageNumber: 1, markdown: '계약일 2026-01-31' }, { pageNumber: 2, markdown: '금액 1,250,000원' }],
    ocrLines: [page(1, [line('계약일 2026-01-31', 0.98)]), page(2, [
      line('금액 1,250,000원', 0.79), line('판독에서 제외된 글', 0.91, true), line('경계값', 0.8), line('점수 없음', undefined),
    ])],
  });
  assert.deepEqual(result.ocrReview.map(r => [r.location, r.line, r.text, r.confidence, r.dropped]), [
    ['2쪽', 1, '금액 1,250,000원', 0.79, false], ['2쪽', 2, '판독에서 제외된 글', 0.91, true], ['2쪽', 4, '점수 없음', null, false],
  ]);
  assert.match(result.ocrReview[0].reason, /0.80/);
  assert.match(result.ocrReview[1].reason, /제외/);
  assert.match(result.ocrReview[2].reason, /점수 없음/);
  assert.equal(result.ocrReview[0].page, 2);
  assert.match(result.warnings.find(w => w.code === 'OCR_LOW_CONF').message, /3개/);
  assert.ok(!outgoing(result).some(s => s.text.includes('판독에서 제외된 글')));
});

test('embedded images retain their OCR scores and original image labels', () => {
  const label = '삽입 그림 2 (receipt.png)';
  const result = normalize({ success: true, fileType: 'docx', markdown: '증빙 모음' }, [{ label,
    result: { success: true, fileType: 'image', markdown: '날짜 2026-01-31', ocrLines: [page(1, [line('날짜 2026-01-31', 0.62)])] },
  }]);
  assert.equal(result.ocrPages.length, 1);
  assert.equal(result.ocrReview[0].location, label);
  assert.equal(result.ocrReview[0].confidence, 0.62);
  assert.equal(result.sources[1].label, label);
});

test('a document with only discarded OCR lines keeps review evidence without inventing usable text', () => {
  const result = normalize({ success: true, fileType: 'image', markdown: '',
    ocrLines: [page(1, [line('읽기 어려운 금액', 0.22, true)])] });
  assert.equal(result.sources.length, 0);
  assert.equal(outgoing(result).length, 0);
  assert.equal(result.ocrReview[0].text, '읽기 어려운 금액');
  assert.ok(result.warnings.some(w => w.code === 'OCR_NO_TEXT'));
  assert.throws(() => normalize({ success: true, fileType: 'image', markdown: '', ocrLines: [] }), /읽을 수 있는 글/);
});

test('ordinary text and confident OCR do not acquire an invented confidence warning', () => {
  assert.deepEqual(normalize({ success: true, fileType: 'text', markdown: '본문' }).ocrReview, []);
  const result = normalize({ success: true, fileType: 'image', markdown: '본문', ocrLines: [page(1, [line('본문', 0.9)])] });
  assert.deepEqual(result.ocrReview, []);
  assert.ok(!result.warnings.some(w => w.code === 'OCR_LOW_CONF'));
});
