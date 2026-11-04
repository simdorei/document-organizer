const $ = id => document.getElementById(id);
const state = { token: '', jobs: [], job: null, file: null, detail: null, selected: new Set(), tab: 'summary', busy: false, settings: null, detailStamp: '' };
function el(tag, text, className) { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (className) node.className = className; return node; }
function notify(message, error = false) {
  const modalMessage = document.querySelector('dialog[open] .dialog-message');
  if (modalMessage) { modalMessage.textContent = message; modalMessage.hidden = !message; }
  $('message').textContent = message; $('message').className = error ? 'error' : ''; $('message').hidden = !message;
}
async function api(url, { method = 'GET', body } = {}) {
  const headers = { 'X-App-Token': state.token };
  if (body && !(body instanceof FormData)) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(body); }
  const response = await fetch(url, { method, body, headers });
  const data = await response.json(); if (!response.ok) throw new Error(data.error || '요청을 처리하지 못했습니다.'); return data;
}
const run = fn => async event => { try { await fn(event); } catch (error) { notify(error.message, true); } };
const jobUrl = () => `/api/jobs/${state.job.id}`;
const fileUrl = () => `${jobUrl()}/files/${state.file}`;
const originalUrl = () => `${fileUrl()}/original?token=${encodeURIComponent(state.token)}`;
const eligible = f => ['ready', 'review'].includes(f.readStatus) && f.sourceCount !== 0 && !['complete', 'review'].includes(f.analysisStatus);
const statusLabel = { pending: '대기', reading: '읽는 중', ready: '읽기 완료', review: '확인 필요', failed: '실패', unsupported: '지원 안 함', running: '분석 중', complete: '분석 완료' };
function selection() {
  const n = state.job?.files.filter(f => eligible(f) && state.selected.has(f.id)).length || 0;
  $('selectionCount').textContent = `${n}개 파일 선택 · 완료된 분석은 보존됩니다`;
  $('analysisButton').disabled = !n || state.busy;
  const candidates = state.job?.files.filter(eligible) || [];
  $('selectAll').checked = candidates.length > 0 && candidates.every(f => state.selected.has(f.id));
  $('selectAll').disabled = state.busy;
}
async function refresh(force = false) {
  const previous = JSON.stringify(state.job), wasBusy = state.busy;
  const data = await api('/api/jobs'); state.jobs = data.jobs; state.busy = Boolean(data.active || data.uploading || data.deleting);
  const navStamp = JSON.stringify([state.job?.id, state.busy, data.jobs.map(j => [j.id, j.name, j.files.length])]);
  if (state.navStamp !== navStamp) {
    state.navStamp = navStamp; $('jobCount').textContent = data.jobs.length; $('jobs').replaceChildren();
    for (const job of data.jobs) {
      const entry = el('div', undefined, 'job-entry');
      const button = el('button', undefined, `job-open${state.job?.id === job.id ? ' active' : ''}`);
      button.append(el('strong', job.name), el('small', `${new Date(job.createdAt).toLocaleDateString('ko-KR')} · ${job.files.length}개`));
      button.onclick = run(() => selectJob(job.id));
      const remove = el('button', '삭제', 'job-delete'); remove.setAttribute('aria-label', `${job.name} 작업 삭제`); remove.disabled = state.busy;
      remove.onclick = () => {
        state.deleteJob = job; $('deleteJobName').textContent = job.name;
        $('deleteJobInfo').textContent = `이 작업의 파일 ${job.files.length}개와 아래 보관 자료를 삭제합니다.`;
        $('deleteDialog').querySelector('.dialog-message').hidden = true; $('deleteDialog').showModal();
      };
      entry.append(button, remove); $('jobs').append(entry);
    }
  }
  $('uploadButton').disabled = state.busy; $('newButton').disabled = state.busy;
  if (state.job) {
    state.job = data.jobs.find(j => j.id === state.job.id) || null;
    if (!state.job) resetWorkspace();
    else if (force || previous !== JSON.stringify(state.job) || wasBusy !== state.busy) await renderJob();
  }
}
function resetWorkspace() {
  state.job = null; state.file = null; state.detail = null; state.detailStamp = ''; state.originalPage = null; state.selected.clear();
  state.renderId = (state.renderId || 0) + 1; state.navStamp = '';
  $('detailBody').replaceChildren(); $('fileWarnings').replaceChildren(); $('fileName').textContent = '';
  $('detail').hidden = true; $('emptyDetail').hidden = false; $('welcome').hidden = false; $('workspace').hidden = true;
}
async function selectJob(id) {
  state.job = state.jobs.find(j => j.id === id); state.file = null; state.detail = null; state.detailStamp = ''; state.selected.clear();
  if (!state.job) { resetWorkspace(); await refresh(); return; }
  for (const file of state.job.files) if (eligible(file)) state.selected.add(file.id);
  const options = state.job.analysisOptions || state.settings;
  $('purpose').value = options.purpose; $('model').value = options.model; $('masked').checked = options.masked !== false;
  $('welcome').hidden = true; $('workspace').hidden = false; notify('');
  await refresh(true);
  if (!state.job) return;
  const first = state.job.files.find(f => ['ready', 'review'].includes(f.readStatus)) || state.job.files[0];
  if (first) await selectFile(first.id);
}
async function renderJob() {
  const job = state.job;
  $('jobName').textContent = job.name;
  const read = job.files.filter(f => ['ready', 'review'].includes(f.readStatus)).length;
  const done = job.files.filter(f => ['complete', 'review'].includes(f.analysisStatus)).length;
  $('jobMeta').textContent = `${job.files.length}개 파일 · 읽기 ${read}개 · 분석 ${done}개${job.status === 'reading' ? ' · PC에서 읽는 중…' : job.status === 'analyzing' ? ' · Claude 분석 중…' : ''}`;
  $('jobError').hidden = !job.error; $('jobError').textContent = job.error || '';
  $('exportButton').disabled = state.busy || !job.files.length;
  $('files').replaceChildren();
  for (const file of job.files) {
    const item = el('div', undefined, `file-item${state.file === file.id ? ' active' : ''}`);
    const check = document.createElement('input'); check.type = 'checkbox'; check.checked = state.selected.has(file.id) && eligible(file);
    check.disabled = !eligible(file) || state.busy; check.setAttribute('aria-label', `${file.name} 분석 선택`);
    check.onchange = () => { if (check.checked) state.selected.add(file.id); else state.selected.delete(file.id); selection(); };
    const info = el('div', undefined, 'file-info'); const button = el('button', file.name); button.onclick = run(() => selectFile(file.id));
    const badge = el('span', statusLabel[file.readStatus], `badge ${file.readStatus === 'failed' ? 'error' : ['review', 'unsupported'].includes(file.readStatus) ? 'warn' : ''}`);
    const small = el('small'); small.append(badge, document.createTextNode(` · ${statusLabel[file.analysisStatus] || ''}${file.analysisProgress ? ` ${file.analysisProgress}` : ''}`));
    info.append(button, small); item.append(check, info); $('files').append(item);
  }
  selection();
  if (state.file) {
    const file = job.files.find(f => f.id === state.file);
    const stamp = JSON.stringify(file);
    if (stamp !== state.detailStamp) { state.detailStamp = stamp; await loadDetail(); }
  } else if (job.files.length) await selectFile(job.files[0].id);
}
async function selectFile(id) { state.file = id; state.originalPage = null; state.detailStamp = ''; await renderJob(); }
async function loadDetail() {
  const selected = state.file, jobId = state.job.id;
  const result = await api(fileUrl());
  if (state.file !== selected || state.job?.id !== jobId) return;
  state.detail = result; $('emptyDetail').hidden = true; $('detail').hidden = false;
  $('fileName').textContent = result.file.name; $('downloadOriginal').hidden = !result.file.hasOriginal;
  $('downloadOriginal').href = originalUrl() + '&download=1';
  $('fileWarnings').replaceChildren();
  for (const message of [result.file.error, result.file.analysisError, ...result.file.warnings.filter(w => w.code !== 'OCR_APPLIED').map(w => w.message)].filter(Boolean)) $('fileWarnings').append(el('div', message, 'notice'));
  if (result.parsed?.ocrReview?.length) {
    const button = el('button', `확인할 글줄 보기 · ${result.parsed.ocrReview.length}개`, 'review-link');
    button.onclick = run(async () => {
      state.tab = 'text'; await renderDetail(); document.getElementById('ocrReview')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    $('fileWarnings').append(button);
  }
  await renderDetail();
}
function renderOcrReview(body, parsed, file) {
  if (!parsed?.ocrReview?.length) return;
  const section = el('section', undefined, 'ocr-review'); section.id = 'ocrReview'; section.setAttribute('aria-labelledby', 'ocrReviewTitle');
  const heading = el('h3', `원본 확인이 필요한 글줄 · ${parsed.ocrReview.length}개`); heading.id = 'ocrReviewTitle'; section.append(heading);
  section.append(el('p', 'OCR 점수는 글자 인식 엔진의 판단값입니다. 정답 확률이 아니며, 표시가 없는 글도 정확성을 보장하지 않습니다. 글줄 번호는 OCR이 감지한 순서입니다.', 'small'));
  for (const item of parsed.ocrReview) {
    const card = el('div', undefined, 'ocr-review-item');
    card.append(el('strong', `${item.location} · OCR 글줄 ${item.line}`),
      el('span', item.dropped ? '본문에서 제외됨' : '본문에 포함됨 · 확인 필요', 'badge warn'),
      el('p', `${item.reason} · OCR 점수 ${item.confidence === null ? '없음' : `${item.confidence.toFixed(3)} / 1`}`, 'small'),
      el('pre', item.text || '(읽힌 글자 없음)'));
    if (file.hasOriginal) {
      const button = el('button', file.extension === '.pdf' ? '원본 페이지 보기 ↗' : '원본 확인 ↗', 'review-link');
      button.onclick = run(async () => {
        state.originalPage = item.page; state.tab = 'original'; await renderDetail(); $('detailBody').scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
      card.append(button);
    }
    section.append(card);
  }
  body.append(section);
}
async function renderDetail(highlight) {
  if (!state.detail) return;
  const renderId = state.renderId = (state.renderId || 0) + 1;
  for (const button of document.querySelectorAll('[data-tab]')) button.setAttribute('aria-selected', String(button.dataset.tab === state.tab));
  const body = $('detailBody'); body.replaceChildren(); const { file, parsed, analysis } = state.detail;
  if (state.tab === 'summary') {
    if (!analysis) body.append(el('div', file.sourceCount === 0 ? '분석할 추출 본문이 없습니다. ‘확인할 글줄 보기’에서 제외된 글줄과 원본을 대조해 주세요.' :
      file.analysisStatus === 'running' ? 'Claude가 자료를 정리하고 있습니다…' : '아직 분석하지 않았습니다. ‘추출된 글’을 먼저 확인하고 필요한 파일을 선택해 분석하세요.', 'empty'));
    else {
      body.append(el('span', analysis.documentType, 'badge'), el('h3', analysis.title, 'section-label'));
      if (!analysis.complete) body.append(el('div', `일부 결과입니다. ${analysis.completed}/${analysis.total}구간 완료`, 'notice'));
      body.append(el('p', analysis.summary, 'summary'), el('p', 'AI 정리 · 날짜와 금액은 원본 대조가 필요합니다.', 'small'));
      const table = el('table', undefined, 'facts'); const head = el('tr'); for (const text of ['항목', '원문 값', '근거']) head.append(el('th', text)); const thead = el('thead'); thead.append(head); table.append(thead);
      const tbody = el('tbody');
      for (const fact of analysis.facts) {
        const row = el('tr'); row.append(el('td', fact.label), el('td', fact.value)); const cell = el('td');
        const button = el('button', `${fact.location} · ${fact.sourceId} ↗`); button.title = fact.quote;
        button.onclick = run(async () => { state.tab = 'text'; await renderDetail(fact.sourceId); }); cell.append(button); row.append(cell); tbody.append(row);
      }
      table.append(tbody); body.append(table);
      if (analysis.reviewNotes.length) { body.append(el('h3', '확인할 사항', 'section-label')); const list = el('ul', undefined, 'notes'); analysis.reviewNotes.forEach(n => list.append(el('li', n))); body.append(list); }
      body.append(el('p', `${analysis.model} · 입력 ${analysis.usage.input_tokens.toLocaleString()} / 출력 ${analysis.usage.output_tokens.toLocaleString()} 토큰`, 'small'));
    }
  } else if (state.tab === 'original') {
    if (!file.hasOriginal) body.append(el('p', '보관된 원본이 없습니다.', 'empty'));
    else if (file.extension === '.pdf') { const frame = document.createElement('iframe'); frame.className = 'original-pdf'; frame.title = 'PDF 원본';
      frame.src = originalUrl() + (Number.isInteger(state.originalPage) && state.originalPage > 0 ? `#page=${state.originalPage}` : ''); body.append(frame); }
    else if (['.png', '.jpg', '.jpeg', '.webp'].includes(file.extension)) { const image = document.createElement('img'); image.className = 'original-image'; image.alt = file.name; image.src = originalUrl(); body.append(image); }
    else body.append(el('p', '이 형식은 원본 다운로드 후 한글·Word·Excel 등으로 열어 확인해 주세요. 추출된 글은 옆 탭에서 볼 수 있습니다.', 'empty'));
  } else {
    let sources = parsed?.sources || [];
    if (state.tab === 'outgoing' && parsed) {
      const data = await api(`${fileUrl()}/outgoing?masked=${$('masked').checked}`); sources = data.sources;
      if (state.renderId !== renderId) return;
      body.append(el('div', `현재 설정으로 전송할 글입니다. 본문 기준 ${data.requests}회 요청으로 나뉩니다. 정리 목적도 함께 전송합니다. 가림 설정은 ‘선택 파일 분석’에서 변경할 수 있습니다.`, 'notice'));
    } else {
      renderOcrReview(body, parsed, file);
      body.append(el('p', '로컬에서 추출한 글입니다. OCR 오독과 표 순서가 원본과 다를 수 있습니다.', 'small'));
    }
    if (!sources.length) body.append(el('p', '표시할 추출 내용이 없습니다.', 'empty'));
    for (const source of sources) {
      const section = el('section', undefined, `source${source.id === highlight ? ' highlight' : ''}`); section.id = `source-${source.id}`;
      section.append(el('strong', `${source.label} · ${source.id}`), el('pre', source.text)); body.append(section);
    }
    if (highlight) document.getElementById(`source-${highlight}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  if (file.hasOriginal && file.analysisStatus === 'pending' && !state.busy) {
    const retry = el('button', file.extension === '.pdf' ? '이 PDF를 전체 OCR로 다시 읽기' : '이 파일 다시 읽기', 'retry');
    retry.onclick = run(async () => { await api(`${fileUrl()}/read`, { method: 'POST', body: { forceOcr: file.extension === '.pdf' } }); await refresh(); }); body.append(retry);
  }
}
for (const button of document.querySelectorAll('[data-tab]')) button.onclick = run(async () => { state.tab = button.dataset.tab; await renderDetail(); });
for (const button of document.querySelectorAll('[data-close]')) button.onclick = () => $(button.dataset.close).close();
$('newButton').onclick = () => { resetWorkspace(); notify(''); };
$('deleteDialog').oncancel = event => { if ($('deleteConfirm').disabled) event.preventDefault(); };
$('deleteDialog').onclose = () => { state.deleteJob = null; };
$('deleteForm').onsubmit = run(async event => {
  event.preventDefault();
  const job = state.deleteJob; if (!job || $('deleteConfirm').disabled) return;
  $('deleteConfirm').disabled = true; $('deleteCancel').disabled = true;
  try {
    await api(`/api/jobs/${job.id}`, { method: 'DELETE', body: { confirm: true } });
    $('deleteDialog').close();
    if (state.job?.id === job.id) resetWorkspace();
    await refresh(true); notify(`‘${job.name}’ 작업과 앱에 보관한 자료를 삭제했습니다.`);
  } finally { $('deleteConfirm').disabled = false; $('deleteCancel').disabled = false; }
});
$('uploadButton').onclick = () => $('fileInput').click();
$('fileInput').onchange = run(async () => {
  const file = $('fileInput').files[0]; if (!file) return;
  const form = new FormData(); form.append('file', file); $('uploadButton').disabled = true;
  notify('이 PC로 파일을 가져오고 있습니다…');
  try { const result = await api('/api/jobs', { method: 'POST', body: form }); await refresh(); await selectJob(result.id); }
  finally { $('fileInput').value = ''; await refresh(); }
});
$('selectAll').onchange = () => { for (const f of state.job.files.filter(eligible)) { if ($('selectAll').checked) state.selected.add(f.id); else state.selected.delete(f.id); } void renderJob(); };
$('exportButton').onclick = () => { window.location.assign(`${jobUrl()}/export?token=${encodeURIComponent(state.token)}`); };
$('settingsButton').onclick = run(async () => { await loadSettings(); $('settings').showModal(); });
$('settingsForm').onsubmit = run(async event => {
  event.preventDefault(); const data = await api('/api/settings', { method: 'POST', body: { apiKey: $('apiKey').value } });
  state.settings.hasKey = data.hasKey; $('apiKey').value = ''; $('settings').close(); notify('키를 메모리에 적용했습니다. 실제 API 연결 여부는 분석 요청 때 확인됩니다.');
});
$('clearKey').onclick = run(async () => { await api('/api/settings', { method: 'POST', body: { clearKey: true } }); $('apiKey').value = ''; await loadSettings(); });
async function loadSettings() {
  state.settings = await api('/api/settings');
  $('keyStatus').textContent = state.settings.hasKey ? '키 입력됨 · 실제 인증은 아직 확인하지 않았습니다.' : '입력한 API 키가 없습니다. 문서 읽기는 키 없이 사용할 수 있습니다.';
  $('dataHome').textContent = `저장 위치: ${state.settings.dataHome}`;
  const details = state.settings.ocr.details;
  $('ocrStatus').textContent = details?.allReady ? '한국어 OCR 모델 준비 완료 · 문서 읽기는 오프라인으로 실행합니다.' : 'OCR 모델이 필요하면 저장소에서 npm run prepare:ocr를 실행해 주세요.';
}
$('analysisButton').onclick = run(async () => {
  if (!state.settings.hasKey) { await loadSettings(); $('settings').showModal(); return; }
  const files = state.job.files.filter(f => eligible(f) && state.selected.has(f.id));
  $('analysisInfo').textContent = `${files.length}개 파일을 분석합니다. 완료된 구간은 같은 설정으로 이어서 처리합니다.`;
  $('consent').checked = false; $('analysisDialog').showModal();
});
$('analysisForm').onsubmit = run(async event => {
  event.preventDefault(); const files = state.job.files.filter(f => eligible(f) && state.selected.has(f.id));
  await api(`${jobUrl()}/analyze`, { method: 'POST', body: { purpose: $('purpose').value, model: $('model').value.trim(),
    masked: $('masked').checked, consent: $('consent').checked, fileIds: files.map(f => f.id) } });
  $('analysisDialog').close(); notify('선택한 자료의 Claude 분석을 시작했습니다.'); await refresh();
});
async function start() {
  state.token = (await api('/api/session')).token; await loadSettings();
  $('purpose').value = state.settings.purpose; $('model').value = state.settings.model;
  await refresh();
  setInterval(() => { refresh().catch(error => notify(error.message, true)); }, 2500);
}
start().catch(error => notify(error.message, true));
