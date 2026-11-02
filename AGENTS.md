# Document Organizer

Single-user Windows tool: ZIP/documents/images → local kordoc OCR → explicitly
requested Claude analysis → source review and XLSX export.

- Keep all source and documentation UTF-8.
- Never commit customer documents, extracted content, screenshots, logs or keys.
- Persist private data only in DOCUMENT_ORGANIZER_DATA_HOME, defaulting to
  %LOCALAPPDATA%/DocumentOrganizer. API keys entered in the UI live in memory only.
- Bind HTTP to loopback. All outbound document analysis uses the official
  Anthropic Messages API. Local OCR workers run with KORDOC_OFFLINE=1.
- OCR model setup is a separate public-model download, not a document upload.
- Keep original files intact. A missing page, parse failure, unsupported file,
  incomplete OCR or invalid AI evidence must remain visible.
- Analyze real documents only through the user's analysis action; never use
  real customer data in automated development tests.
- This tool extracts facts for review. It does not determine tax liability,
  deductible expenses or submit declarations.
- Use focused modules and meaningful boundary tests. Run npm test and npm run
  check, plus an actual local OCR fixture before claiming parsing works.
