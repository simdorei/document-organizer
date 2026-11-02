import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

export const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const DATA_HOME = path.resolve(process.env.DOCUMENT_ORGANIZER_DATA_HOME ||
  path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), '.local', 'share'), 'DocumentOrganizer'));
export const MODEL_HOME = path.resolve(process.env.DOCUMENT_ORGANIZER_MODEL_HOME || path.join(DATA_HOME, 'models'));
export const LIMITS = Object.freeze({ upload: 200 * 1024 ** 2, file: 50 * 1024 ** 2,
  expanded: 500 * 1024 ** 2, files: 300, pages: 500, parseMs: 180_000, textChars: 400_000 });
export const EXTENSIONS = new Set(['.hwp', '.hwpx', '.hml', '.pdf', '.docx', '.xlsx', '.xls', '.pptx',
  '.png', '.jpg', '.jpeg', '.webp', '.txt', '.md', '.csv']);
export const DEFAULT_MODEL = 'claude-sonnet-5-5';
export const PURPOSE = '부동산 양도세 자료 검토를 위해 문서 종류와 내용을 요약하고, 부동산 표시·당사자 역할·취득/양도 계약일·잔금일·거래금액·비용 증빙의 내용과 금액을 원문 근거와 함께 정리해 주세요. 문서에 없는 값이나 비용 인정 여부, 세액은 판단하지 마세요.';

export function appError(message, statusCode = 400) {
  return Object.assign(new Error(message), { statusCode });
}
