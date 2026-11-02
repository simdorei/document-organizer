import { buildApp } from './server.js';

const port = Number(process.env.DOCUMENT_ORGANIZER_PORT || 4178);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('잘못된 포트 번호입니다.');
try {
  const { app } = await buildApp();
  await app.listen({ port, host: '127.0.0.1' });
  console.log(`문서 정리함 v0.1.0 · http://127.0.0.1:${port}`);
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { await app.close(); process.exit(0); });
} catch (error) {
  console.error(error.code === 'EADDRINUSE' ? '이미 실행 중이거나 이 포트를 다른 프로그램이 사용하고 있습니다.' : '프로그램을 시작하지 못했습니다. 설치 상태와 데이터 폴더 권한을 확인해 주세요.');
  process.exitCode = 1;
}
