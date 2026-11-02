import { modelStatus } from '../src/models.js';

try {
  if (Number(process.versions.node.split('.')[0]) < 24) throw new Error('Node.js 24 이상이 필요합니다.');
  // These are optional upstream dependencies, but required for this app's local OCR.
  for (const name of ['kordoc', 'sharp', 'onnxruntime-node', '@hyzyla/pdfium']) {
    try { await import(name); }
    catch { throw new Error(`${name}을 불러오지 못했습니다. 설치 출력과 Windows 호환 여부를 확인해 주세요.`); }
  }
  const status = await modelStatus();
  if (!status.details?.allReady) throw new Error('한국어 OCR 모델 검증에 실패했습니다. npm run prepare:ocr를 다시 실행해 주세요.');
  console.log('로컬 OCR 실행 모듈과 한국어 모델 검증 완료. API 키는 필요하지 않습니다.');
} catch (error) {
  console.error(error.message); process.exitCode = 1;
}
