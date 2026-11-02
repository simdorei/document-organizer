# 설계 근거

2026-11-02 확인. 별도 로컬 저장소로 구현하며 기존 tax-automation-kit 앱·설정·고객 자료와 연결하지 않습니다.

## 웹 화면을 쓰되 PC에서 실행

서버 공개 없이 Windows에서 Node.js 프로세스를 실행하고 Chrome으로 접속합니다. 파일·OCR을 PC에 두면서 배포·화면 개발을 단순하게 유지하기 위한 선택입니다. 설치형 exe나 직원 공동 사용 서버는 현재 범위가 아닙니다.

## kordoc

[kordoc 공식 저장소](https://github.com/chrisryugj/kordoc)의 4.24.37을 고정했습니다. 코드 라이선스는 MIT, 사용한 기본 PP-OCRv5 검출/한국어 인식 모델은 Apache-2.0입니다. 수식 OCR 모델은 설치·사용하지 않습니다. 모델·배포 라이선스 원문은 패키지의 NOTICE와 THIRD_PARTY를 확인할 수 있습니다.

한글·Office·PDF·이미지를 같은 라이브러리로 읽을 수 있지만 다음 기능은 별도로 구현합니다.

- 일반 ZIP을 파일별로 순회하고 각 항목의 성공·실패를 보존합니다.
- 기본 OCR 모델만 미리 받고 실행 시 `KORDOC_OFFLINE=1`을 설정합니다. 외부 OCR provider를 설정하지 않습니다.
- 파싱 성공과 전체 내용 인식 성공은 다릅니다. OCR_FAILED, PARTIAL_PARSE, 저신뢰 글줄 등 경고를 별도로 보여 줍니다.
- 삽입 그림 OCR은 DOCX/XLS(X)/PPTX에서 추출된 이미지에 별도 적용합니다. HWP 계열은 kordoc의 자체 OCR 경로를 사용합니다.
- 파일마다 프로세스를 분리해 오류·과도한 처리 시간이 다음 파일을 막지 않도록 합니다. JS 힙 한도는 1GB이고 3분이면 종료합니다. native OCR 메모리의 절대 한도를 보장하는 OS 격리 장치는 아닙니다.

## Claude

[공식 TypeScript SDK](https://github.com/anthropics/anthropic-sdk-typescript) 1.3.0과 [Messages API structured outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs)를 사용합니다. 서버에서만 `https://api.anthropic.com`을 호출합니다. SDK 자동 재시도는 0으로 두어 실패한 유료 요청을 자동 반복하지 않습니다.

문서에는 지시문이 들어 있을 수 있으므로 분석 프롬프트에서 문서 데이터를 신뢰하지 않도록 명시합니다. 모델에 브라우저·파일·실행 도구를 제공하지 않습니다. 인용과 값의 원문 포함 여부는 별도 코드에서 검사합니다.

## 모듈

| 영역 | 파일 |
| --- | --- |
| 서버·로컬 접근 제한 | src/server.js, src/main.js |
| 작업 상태·저장 | src/jobs.js, src/store.js |
| 압축 파일 검증 | src/archive.js |
| 파싱·OCR 격리·근거 구간 | src/parser.js, src/parse-worker.js, src/normalize.js |
| 가림·Claude·응답 검증 | src/analysis.js |
| Excel 출력 | src/export.js |
| 화면 | public/ |

원본은 임의 UUID 이름으로 보관해 ZIP 내부 경로를 실제 쓰기 경로로 사용하지 않습니다. 경로 탈출, 링크 항목, 암호화 항목, CRC 손상과 용량 제한을 검사합니다. 결과 JSON은 임시 파일 후 교체해 중단 때 손상될 가능성을 줄입니다. 시작할 때 중단된 작업을 표시하고 자동 전송하지 않습니다.
