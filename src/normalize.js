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

// Derive details from saved OCR lines as well, so existing results need no migration.
export function ocrReview(parsed) {
  const review = [];
  for (const page of parsed?.ocrPages || []) {
    const label = page.label || location({ fileType: parsed.fileType, metadata: { pageMode: parsed.pageMode } }, page.pageNumber);
    for (const [index, line] of (page.lines || []).entries()) {
      const confidence = Number.isFinite(line.confidence) && line.confidence >= 0 && line.confidence <= 1 ? line.confidence : null;
      if (!line.dropped && confidence !== null && confidence >= 0.8) continue;
      review.push({ location: label, page: page.pageNumber ?? null, line: index + 1, text: line.text || '', confidence,
        dropped: Boolean(line.dropped), reason: line.dropped ? 'OCR 엔진이 본문에서 제외한 글줄' :
          confidence === null ? 'OCR 점수 없음 — 원본 확인 필요' : 'OCR 점수 0.80 미만 — 원본 확인 필요' });
    }
  }
  return review;
}

export function normalize(result, extras = []) {
  if (!result.success) throw new Error(`문서 읽기 실패 (${result.code || 'PARSE_ERROR'}). 암호·손상 여부와 형식을 확인해 주세요.`);
  if ((result.pageCount || 0) > LIMITS.pages) throw new Error(`한 파일은 ${LIMITS.pages}쪽/시트까지 읽습니다. 파일을 나눠 주세요.`);
  const pages = result.pages?.length ? result.pages.map(p => ({
    page: p.pageNumber, label: location(result, p.pageNumber), text: p.markdown,
  })) : [{ label: location(result, result.fileType === 'image' ? 1 : null), text: result.markdown || '' }];
  const warnings = (result.warnings || []).map(w => ({ code: w.code, page: w.page ?? null, message: w.message }));
  const ocrPages = (result.ocrLines || []).map(p => ({ ...p, label: location(result, p.pageNumber) }));
  for (const extra of extras) {
    if (extra.result.success) {
      pages.push({ label: extra.label, text: extra.result.markdown || '' });
      warnings.push(...(extra.result.warnings || []).map(w => ({ code: w.code, message: `${extra.label}: ${w.message}` })));
      ocrPages.push(...(extra.result.ocrLines || []).map(p => ({ ...p, label: extra.label })));
    } else warnings.push({ code: 'OCR_FAILED', message: `${extra.label}을 읽지 못했습니다.` });
  }
  const chars = pages.reduce((n, p) => n + p.text.length, 0);
  if (chars > LIMITS.textChars) throw new Error('추출된 글이 40만 자를 넘습니다. 원본을 나눠 다시 넣어 주세요.');
  const sources = splitSources(pages);
  const review = ocrReview({ ocrPages });
  if (!sources.length && !review.length) throw new Error('읽을 수 있는 글을 찾지 못했습니다. OCR 모델 설치 여부와 원본 이미지 품질을 확인해 주세요.');
  if (review.length) warnings.push({ code: 'OCR_LOW_CONF', message: `확인할 OCR 글줄 ${review.length}개가 있습니다. ‘확인할 글줄 보기’에서 위치와 내용을 원본과 대조해 주세요.` });
  if (!sources.length) warnings.push({ code: 'OCR_NO_TEXT', message: '분석에 사용할 추출 본문이 없습니다. 제외된 글줄과 원본을 확인하고 더 선명한 자료로 다시 읽어 주세요.' });
  return { version: 1, fileType: result.fileType, pageMode: result.metadata?.pageMode || null,
    pageCount: result.pageCount ?? null, sources, chars, warnings, ocrPages, ocrReview: review };
}
