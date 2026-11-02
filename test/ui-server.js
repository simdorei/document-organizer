// Manual UI fixture only. All responses are synthetic. Never calls a provider.
import { buildApp } from '../src/server.js';
if (!process.env.DOCUMENT_ORGANIZER_DATA_HOME?.includes('test-artifacts')) throw new Error('UI 테스트 전용 데이터 폴더를 지정해야 합니다.');
const { app } = await buildApp({ apiKey: 'sk-ant-synthetic-ui-only', clientFactory: () => ({ messages: { create: async request => {
  const { sources } = JSON.parse(request.messages[0].content);
  const source = sources.find(s => s.text.includes('금액 1,250,000원'));
  return { id: 'synthetic-ui-response', stop_reason: 'end_turn', usage: { input_tokens: 0, output_tokens: 0 }, content: [{ type: 'text', text: JSON.stringify({
    title: '가상 영수증 · 화면 테스트 응답', documentType: '가상 중개보수 영수증',
    summary: '가짜 API 응답으로 화면과 근거 이동을 검증합니다. Claude를 실제 호출한 결과가 아닙니다.',
    facts: source ? [{ category: '비용증빙', label: '지급금액', value: '1,250,000원', sourceId: source.id, quote: '금액 1,250,000원' }] : [],
    reviewNotes: ['가상 자료와 가짜 응답만 사용한 개발 검증입니다.'],
  }) }] };
} } }) });
await app.listen({ port: 4178, host: '127.0.0.1' });
console.log('UI 테스트 서버 · 가짜 응답만 사용 · 외부 API 호출 없음');
