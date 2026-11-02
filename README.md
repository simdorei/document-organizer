# 문서 정리함

ZIP 안의 문서·사진을 **내 PC에서 읽고 OCR 결과를 정리하는** 1인용 도구입니다. 로컬 문서 읽기와 Excel 저장에는 API 키가 필요 없습니다. 선택 기능으로 Claude API 분석 코드가 포함되어 있습니다.

저장소: [simdorei/document-organizer](https://github.com/simdorei/document-organizer) · Windows에서 사용합니다. 현재 MCP 연결은 구현하지 않았습니다.

## 다른 PC에서 처음 설치

1. [Node.js 공식 다운로드](https://nodejs.org/en/download)에서 **Node.js 24 LTS**의 Windows 설치 프로그램을 설치합니다. npm은 함께 설치됩니다. 현재 검증 환경은 Windows x64 + Node.js 24입니다.
2. 이 저장소의 **Code → Download ZIP**을 누릅니다. 공개 저장소라 GitHub 로그인 없이 받을 수 있습니다. 압축을 완전히 풀어 `C:\tools\document-organizer` 같은 폴더에 둡니다. ZIP 안에서 바로 실행하지 마세요.
3. 그 폴더의 **`setup.cmd`를 한 번 실행**합니다. 필요한 프로그램과 공개 OCR 모델을 설치합니다. 처음 설치할 때는 인터넷 연결이 필요하며, API 키는 입력하지 않습니다.
4. 설치 완료가 표시되면 **`start.cmd`를 실행**합니다. 열린 실행 창을 유지하세요.
5. Chrome에서 **http://127.0.0.1:4178** 로 접속해 ZIP이나 문서를 넣습니다.

이후에는 `start.cmd`만 실행하면 됩니다. 각 PC에서 독립적으로 실행하므로 같은 주소를 사용해도 서로 연결되지 않습니다.

Git을 사용하는 경우에는 ZIP 다운로드 대신 다음 명령으로 받아도 됩니다. 공개 저장소라 다운로드에 GitHub 인증이 필요하지 않습니다.

```powershell
git clone https://github.com/simdorei/document-organizer.git
cd document-organizer
.\setup.cmd
.\start.cmd
```

설치가 끝나면 `node scripts/verify-setup.js`로 설치 상태를 다시 확인할 수 있습니다. 실제 가상 영수증 OCR까지 확인하려면 `node scripts/verify-local-ocr.js`를 실행하세요.

## 실행

먼저 위의 설치를 완료합니다. **읽기/OCR만 쓸 때는 API 설정을 건드릴 필요가 없습니다.**

1. `start.cmd`를 더블클릭합니다. 열린 실행 창을 유지하세요.
2. Chrome에서 **http://127.0.0.1:4178** 을 엽니다.
3. ZIP 또는 문서 하나를 넣습니다. 이 단계에는 API 키가 필요 없습니다.
4. 파일별 **추출된 글 / 원본 보기**를 확인합니다.
5. **Excel 내려받기**로 파일 목록과 추출 원문을 저장합니다. 분석하지 않은 핵심항목 시트는 빈 상태입니다.

Claude 분석 기능을 사용할 경우에만 **API 설정**에서 본인 키를 입력하고, 분석할 파일을 체크한 뒤 **선택 파일 분석**을 실행합니다. 키는 채팅으로 보내지 마세요. 기본 정리 목적은 부동산 매매·취득·비용 증빙이며 직접 바꿀 수 있습니다. 실제 Claude API 연결은 아직 검증하지 않았습니다.

종료하려면 실행 창에서 `Ctrl+C`를 누릅니다. 원본과 결과는 보존되고 화면에서 입력한 키는 사라집니다.

`setup.cmd`가 수행하는 작업을 직접 실행하려면 다음 명령을 사용합니다.

```powershell
npm ci --include=optional
npm run prepare:ocr
node scripts/verify-setup.js
npm start
```

`prepare:ocr`는 공개 OCR 모델 약 18MB를 받아 SHA-256을 확인합니다. 이때 사용자 문서를 보내지 않습니다. 실제 문서 읽기는 `KORDOC_OFFLINE=1`인 별도 프로세스에서 실행합니다.

## 업데이트와 자료 이동

- **프로그램 업데이트:** Git으로 받았다면 프로그램을 종료한 뒤 `git pull --ff-only` → `setup.cmd` → `start.cmd` 순서로 실행합니다. ZIP으로 받았다면 새 ZIP을 새 폴더에 풀고 `setup.cmd`를 실행하면 됩니다.
- **고객 자료와 결과:** GitHub에 올라가지 않으며 PC 간 자동 동기화도 하지 않습니다. 기본 저장 위치는 `%LOCALAPPDATA%\DocumentOrganizer`입니다.
- **기존 작업을 다른 PC로 옮길 때:** 양쪽 프로그램을 종료하고 위 데이터 폴더를 안전한 방법으로 복사합니다. 받는 PC에 기존 데이터가 있으면 덮어쓰지 마세요. 별도 폴더로 복사하고 `DOCUMENT_ORGANIZER_DATA_HOME`을 그 폴더로 지정하면 됩니다. 모델은 새 PC에서 `setup.cmd`로 다시 받을 수도 있습니다.
- **API 키:** UI에 입력한 키는 파일에 저장하지 않으므로 복사되지 않습니다. 로컬 OCR에는 필요 없고, Claude 기능을 선택해서 사용할 때만 해당 PC에서 입력합니다.

Codex에게 정리를 맡길 경우에는 이 저장소와 처리할 로컬 자료 경로를 알려 주세요. 현재 웹 화면의 ‘선택 파일 분석’ 버튼은 Claude API용이며 Codex/MCP 호출 버튼으로 바뀐 상태는 아닙니다.

## 처리 흐름과 결과

```text
ZIP/문서 → PC 안에서 파일별 추출 → PC 안에서 kordoc 파싱·OCR
                                ↓
                         추출 원문·오류 확인
                                ↓ 사용자가 분석 버튼 실행
                    일부 번호 가림 → Claude Messages API
                                ↓
                 파일별 요약 + 핵심 항목 + 인용 근거 → Excel
```

- 계약일·잔금일·부동산 표시·당사자 역할·거래금액·비용 증빙을 원문에서 추출합니다.
- 금액은 원문 문자열로 유지합니다. 돈을 부동소수점 숫자로 변환하거나 임의로 합산하지 않습니다.
- AI가 제시한 인용이 해당 원문에 있고, 추출 값이 그 인용 안에 있는지 검사합니다. 불일치는 표시하고 정리표에서 제외합니다. 이 검사는 의미 해석의 정확성까지 보장하지 않습니다.
- 세액, 비과세, 필요경비 인정 여부를 결정하거나 신고하지 않습니다.
- Excel에는 **파일목록 / 핵심항목 / 확인할사항 / 추출원문** 네 시트가 들어갑니다. 실패·미지원 파일도 목록에서 빠지지 않습니다. 추출원문 시트는 가리지 않은 로컬 원문입니다.
- 긴 문서는 여러 번 요청합니다. 완료한 구간은 바로 저장하며, 같은 목적·모델·가림 설정으로 재실행하면 완료 구간을 재전송하지 않습니다. 응답을 받지 못한 요청은 과금 여부를 Console에서 확인해야 합니다.

## 지원 범위

| 파일 | 처리 및 검토 |
| --- | --- |
| ZIP | 하위 폴더의 파일별 처리. 동일한 이름도 별개 원본으로 보관 |
| PDF | 텍스트 추출 + 필요한 페이지 로컬 OCR, 원본 미리보기. 필요하면 전체 OCR 재실행 |
| PNG / JPG / JPEG / WebP | 로컬 OCR, 원본 미리보기 |
| HWP / HWPX / HML | kordoc 파싱. 한글의 일부 페이지 표시는 쪽 번호가 아닌 섹션 근사 |
| DOCX / XLSX / XLS / PPTX | 본문·표 파싱. 추출된 삽입 그림도 별도로 로컬 OCR |
| TXT / MD / CSV | UTF-8 우선, 읽지 못하면 한국어 EUC-KR 시도 |

한글·Office 원본은 다운로드해서 해당 프로그램에서 대조할 수 있습니다. Excel의 위치는 인쇄 쪽이 아닌 시트 번호, PowerPoint는 슬라이드 번호입니다.

제한: ZIP 200MB, 개별 파일 50MB, 압축 해제 합계 500MB, 파일 300개, 폴더 포함 항목 2,000개. 한 문서 500쪽/시트·추출 글 40만 자·삽입 그림 100개까지, 파일 읽기 3분 제한입니다. 제한을 넘긴 파일은 성공으로 처리하지 않습니다.

암호 ZIP, 암호 문서, ZIP 안의 중첩 ZIP, HEIC·TIFF·BMP 직접 입력은 첫 버전에서 지원하지 않습니다. 암호를 풀거나 PDF/PNG/JPG로 변환해 넣어 주세요. 손글씨·흐린 사진·복잡한 병합 표와 오래된 HWP는 오독·누락 가능성이 있습니다. 실제 고객 자료에 대한 정확도 평가는 아직 하지 않았습니다.

## 데이터와 API 키

- 저장 위치: 기본 `%LOCALAPPDATA%\DocumentOrganizer`. Git 저장소 밖에 원본·추출 글·결과를 보관합니다. 저장 파일 자체를 암호화하는 기능은 없습니다.
- `DOCUMENT_ORGANIZER_DATA_HOME`으로 저장 위치를 바꿀 수 있습니다. `DOCUMENT_ORGANIZER_MODEL_HOME`은 OCR 모델 위치, `DOCUMENT_ORGANIZER_PORT`는 포트입니다.
- 서버는 `127.0.0.1`에서만 접속받습니다. 외부 사이트의 API 요청은 차단하며 로그인·팀 협업·서버 공개 용도로 설계하지 않았습니다.
- UI에서 입력한 API 키는 서버 메모리에만 둡니다. `ANTHROPIC_API_KEY` 환경변수도 지원하지만 키를 소스나 Git에 넣지 마세요.
- API에는 추출된 글·표·위치 표기·정리 목적을 보냅니다. 원본 ZIP·문서 파일·이미지 바이너리는 보내지 않습니다. 문서 안에 적힌 파일 이름 등은 추출 글에 남을 수 있습니다.
- 주민번호와 일부 계좌번호를 규칙으로 가릴 수 있습니다. 완전한 익명화가 아니며 이름·주소·금액은 남습니다. ‘전송할 글’에서 확인하세요.
- Claude 채팅 구독 로그인과 API 키는 별개입니다. API 계정의 모델 접근 권한·잔액·사용 한도가 필요합니다. 기본 모델 이름은 `claude-sonnet-5-5`이며 Console에서 이용할 수 있는 모델로 바꿀 수 있습니다.
- API 보관·학습 정책은 Anthropic의 계약 및 설정을 따릅니다. 이 도구가 외부 데이터 보관을 통제하지 않습니다.

## 개발 검증

```powershell
npm test
npm run check
node scripts/verify-local-ocr.js
```

일반 테스트는 외부 API를 호출하지 않습니다. OCR 검증은 가상 영수증 이미지·스캔 PDF·Excel·HWPX를 생성해 실제 로컬 엔진으로 읽습니다. 생성물은 Git에서 제외되는 `test-artifacts/`에 둡니다.

구체적인 검증 범위와 남은 사항은 [docs/verification.md](docs/verification.md), 선택한 도구와 구조는 [docs/design.md](docs/design.md)를 참고하세요.
