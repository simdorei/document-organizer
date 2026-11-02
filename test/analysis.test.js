import test from 'node:test';
import assert from 'node:assert/strict';
import { redact, outgoing, batches, analyzeBatch, validateAnalysis, createClient } from '../src/analysis.js';
import { normalize, splitSources } from '../src/normalize.js';

const source = { id: 's1', label: '2쪽', text: '잔금일: 2026-01-31\n잔금 450,000,000원' };
const result = { title: '계약서', documentType: '매매계약서', summary: '매매 자료', reviewNotes: [],
  facts: [{ category: '금액', label: '잔금', value: '450,000,000원', sourceId: 's1', quote: '잔금 450,000,000원' }] };

test('invented values or references are excluded and reported, not accepted as evidence', () => {
  assert.equal(validateAnalysis(result, [source]).facts[0].location, '2쪽');
  for (const patch of [{ value: '4억5천만원' }, { sourceId: 's9' }, { quote: '취득금액 450,000,000원' }]) {
    const invalid = validateAnalysis({ ...result, facts: [{ ...result.facts[0], ...patch }] }, [source]);
    assert.equal(invalid.facts.length, 0); assert.equal(invalid.rejected.length, 1); assert.match(invalid.reviewNotes[0], /제외/);
  }
});

test('local masking removes supported identifiers but preserves transaction amounts', () => {
  const text = '주민번호 900101-1234567 계좌번호: 123-456-789012\n매매금액 450,000,000원';
  const masked = redact(text); assert.ok(!masked.includes('900101')); assert.ok(!masked.includes('123-456')); assert.ok(masked.includes('450,000,000원'));
  assert.equal(outgoing({ sources: [{ ...source, text }] }, false)[0].text, text);
});

test('page labels distinguish sheets and approximate sections; large text is not silently lost', () => {
  const section = normalize({ success: true, fileType: 'hwpx', metadata: { pageMode: 'section' }, pageCount: 1,
    pages: [{ pageNumber: 1, markdown: '섹션 본문' }], warnings: [{ code: 'PARTIAL_PARSE', message: '일부 누락' }] });
  assert.match(section.sources[0].label, /쪽 번호 아님/); assert.equal(section.warnings[0].code, 'PARTIAL_PARSE');
  const text = '금액 1234원\n'.repeat(4000); const sources = splitSources([{ text, label: '본문' }]);
  assert.equal(sources.map(s => s.text).join(''), text); assert.ok(batches(sources).length > 1);
  assert.throws(() => normalize({ success: true, fileType: 'pdf', markdown: 'a'.repeat(400001) }), /40만/);
});

test('official SDK uses structured output and never retries a failed request', async () => {
  let calls = 0; const client = createClient('sk-ant-test-key-never-real');
  client.fetch = async (url, options) => {
    calls++; assert.equal(String(url), 'https://api.anthropic.com/v1/messages');
    const body = JSON.parse(options.body); assert.equal(body.output_config.format.type, 'json_schema');
    assert.equal(body.tools, undefined);
    return new Response(JSON.stringify({ type: 'error', error: { type: 'rate_limit_error', message: 'synthetic' } }), { status: 429, headers: { 'content-type': 'application/json' } });
  };
  await assert.rejects(analyzeBatch(client, [source], '자료 정리', 'claude-sonnet-5-5'), /한도 초과/); assert.equal(calls, 1);
});

test('complete response validates evidence, incomplete response cannot become success', async () => {
  const message = { stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(result) }], usage: { input_tokens: 12, output_tokens: 13 }, id: 'mock' };
  const client = { messages: { create: async () => message } };
  assert.equal((await analyzeBatch(client, [source], '정리', 'claude-sonnet-5-5')).result.facts.length, 1);
  message.stop_reason = 'max_tokens'; await assert.rejects(analyzeBatch(client, [source], '정리', 'claude-sonnet-5-5'), /완료되지/);
});
