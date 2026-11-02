import { readFile } from 'node:fs/promises';
import { parse, parseImage } from 'kordoc';
import { LIMITS } from './config.js';
import { normalize } from './normalize.js';

process.once('message', async ({ filename, extension, forceOcr }) => {
  try {
    const buffer = await readFile(filename);
    let result;
    if (['.txt', '.md', '.csv'].includes(extension)) {
      let text;
      try { text = new TextDecoder('utf-8', { fatal: true }).decode(buffer); }
      catch { text = new TextDecoder('euc-kr', { fatal: true }).decode(buffer); }
      if (text.includes('\0')) throw new Error('텍스트 파일에 바이너리 데이터가 있습니다.');
      result = { success: true, fileType: 'text', markdown: text, blocks: [] };
    } else result = await parse(buffer, {
      ocr: forceOcr ? 'force' : true, ocrLines: 'all', removeHeaderFooter: false,
      tableFormat: 'gfm', images: ['.docx', '.xlsx', '.xls', '.pptx'].includes(extension),
      onProgress: (_current, total) => { if (total > LIMITS.pages) throw new Error('PAGE_LIMIT'); },
    });
    const extras = [];
    if (result.success && ['docx', 'xlsx', 'xls', 'pptx'].includes(result.fileType)) {
      const images = result.images || [];
      if (images.length > 100) throw new Error('삽입 그림이 100개를 넘습니다. 문서를 나눠 주세요.');
      for (let i = 0; i < images.length; i++) {
        const label = `삽입 그림 ${i + 1} (${images[i].filename})`;
        let imageResult;
        try { imageResult = await parseImage(Buffer.from(images[i].data), { ocr: true, ocrLines: 'all' }); }
        catch { imageResult = { success: false }; }
        extras.push({ label, result: imageResult });
      }
    }
    process.send({ ok: true, result: normalize(result, extras) }, () => process.exit(0));
  } catch (error) {
    process.send({ ok: false, message: error.message?.slice(0, 300) || '문서를 읽지 못했습니다.' }, () => process.exit(1));
  }
});
