import { LIMITS } from './config.js';

export function location(result, page) {
  if (!page) return '본문';
  if (['xlsx', 'xls'].includes(result.fileType)) return `시트 ${page}`;
  if (result.fileType === 'pptx') return `슬라이드 ${page}`;
  if (result.fileType === 'image') return '이미지';
  if (result.metadata?.pageMode === 'section') return `섹션 ${page} (쪽 번호 아님)`;
  if (result.fileType === 'pdf' || result.metadata?.pageMode === 'layout') return `${page}쪽`;
  return `문서 구간 ${page}`;
}

// Every byte of extracted text belongs to one source; never silently truncate.
export function splitSources(pages, maxChars = 3500) {
  const sources = [];
  for (const page of pages) {
    let offset = 0;
    while (offset < page.text.length) {
      let end = Math.min(offset + maxChars, page.text.length);
      if (end < page.text.length) {
        const newline = page.text.lastIndexOf('\n', end);
        if (newline > offset + maxChars / 2) end = newline + 1;
        // Do not split a UTF-16 surrogate pair.
        if (/[\uD800-\uDBFF]/.test(page.text[end - 1])) end--;
      }
      const text = page.text.slice(offset, end);
      if (text.trim()) sources.push({ id: `s${sources.length + 1}`, label: page.label, page: page.page ?? null, text });
      offset = end;
    }
  }
  return sources;
}

export function normalize(result, extras = []) {
  if (!result.success) throw new Error(`문서 읽기 실패 (${result.code || 'PARSE_ERROR'}). 암호·손상 여부와 형식을 확인해 주세요.`);
  if ((result.pageCount || 0) > LIMITS.pages) throw new Error(`한 파일은 ${LIMITS.pages}쪽/시트까지 읽습니다. 파일을 나눠 주세요.`);
  const pages = result.pages?.length ? result.pages.map(p => ({
    page: p.pageNumber, label: location(result, p.pageNumber), text: p.markdown,
  })) : [{ label: location(result, result.fileType === 'image' ? 1 : null), text: result.markdown || '' }];
  const warnings = (result.warnings || []).map(w => ({ code: w.code, page: w.page ?? null, message: w.message }));
  for (const extra of extras) {
    if (extra.result.success) {
      pages.push({ label: extra.label, text: extra.result.markdown || '' });
      warnings.push(...(extra.result.warnings || []).map(w => ({ code: w.code, message: `${extra.label}: ${w.message}` })));
    } else warnings.push({ code: 'OCR_FAILED', message: `${extra.label}을 읽지 못했습니다.` });
  }
  const chars = pages.reduce((n, p) => n + p.text.length, 0);
  if (chars > LIMITS.textChars) throw new Error('추출된 글이 40만 자를 넘습니다. 원본을 나눠 다시 넣어 주세요.');
  const sources = splitSources(pages);
  if (!sources.length) throw new Error('읽을 수 있는 글을 찾지 못했습니다. OCR 모델 설치 여부와 원본 이미지 품질을 확인해 주세요.');
  const ocrPages = result.ocrLines || [];
  const lowLines = ocrPages.flatMap(p => p.lines).filter(line => line.dropped || line.confidence < 0.8).length;
  if (lowLines) warnings.push({ code: 'OCR_LOW_CONF', message: `확신도가 낮은 OCR 글줄 ${lowLines}개가 있습니다. 날짜·금액을 원본과 대조해 주세요.` });
  return { version: 1, fileType: result.fileType, pageMode: result.metadata?.pageMode || null,
    pageCount: result.pageCount ?? null, sources, chars, warnings, ocrPages };
}
