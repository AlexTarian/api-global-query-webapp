pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
let currentNod = null;
let nodInitialized = false;


// ==================== STATE ====================

function createEmptyNodState_() {
  return {
    file: null,
    fileName: '',
    documentType: '',
    title: '',
    noticeDate: '',
    dueDate: '',
    caseNumber: '',
    caseKey: '',
    employerName: '',
    caseSource: '',
    caseData: null,
    parseMetadata: null,
    deficiencies: []
  };
}


function setCurrentNod_(nod) {
  currentNod = nod || createEmptyNodState_();
  renderNodWorkspace_();
}


function clearCurrentNod_() {
  setCurrentNod_(createEmptyNodState_());

  const input = document.getElementById('nodFileInput');
  if (input) input.value = '';

  document.getElementById('nodUploadStatus').textContent = 'No NOD loaded.';
}


// ==================== FILE HANDLING ====================

async function parseNodPdf_(file) {
  const status = document.getElementById('nodUploadStatus');
  const startedAt = performance.now();

  status.textContent = `Reading ${file.name}...`;

  const bytes = new Uint8Array(await file.arrayBuffer());

  if (!looksLikePdf_(bytes)) {
    throw new Error('The selected file does not appear to be a valid PDF.');
  }

  const loadingTask = pdfjsLib.getDocument({ data: bytes });
  const pdf = await loadingTask.promise;

  const pages = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
    status.textContent = `Reading ${file.name}... page ${pageNumber} of ${pdf.numPages}`;

    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();

    const text = extractPdfPageText_(content.items);

    pages.push(text);

    page.cleanup();
  }

  await pdf.destroy();

  const text = pages.join('\n\n');
  const extractionMs = Math.round(performance.now() - startedAt);

  const result = {
    fileName: file.name,
    fileSizeBytes: file.size,
    pageCount: pages.length,
    textLength: text.length,
    extractionMs,
    text
  };

  console.log('NOD PDF extraction result:', {
    fileName: result.fileName,
    fileSizeBytes: result.fileSizeBytes,
    pageCount: result.pageCount,
    textLength: result.textLength,
    extractionMs: result.extractionMs
  });

  return result;
}


function looksLikePdf_(bytes) {
  if (!bytes || bytes.length < 5) return false;

  return (
    bytes[0] === 0x25 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x44 &&
    bytes[3] === 0x46 &&
    bytes[4] === 0x2D
  );
}


function extractPdfPageText_(items) {
  const lines = [];
  let currentLine = [];
  let lastY = null;

  for (const item of items || []) {
    const text = String(item?.str || '');
    if (!text) continue;

    const y = item?.transform?.[5];

    if (
      lastY !== null &&
      Number.isFinite(y) &&
      Math.abs(y - lastY) > 2
    ) {
      if (currentLine.length) {
        lines.push(currentLine.join(' '));
        currentLine = [];
      }
    }

    currentLine.push(text);

    if (Number.isFinite(y)) {
      lastY = y;
    }
  }

  if (currentLine.length) {
    lines.push(currentLine.join(' '));
  }

  return lines.join('\n');
}

async function handleNodFile_(file) {
  if (!file) return;

  const status = document.getElementById('nodUploadStatus');

  if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
    status.textContent = 'Please choose a PDF file.';
    return;
  }

  const nod = createEmptyNodState_();

  nod.file = file;
  nod.fileName = file.name;

  setCurrentNod_(nod);

  try {
    const result = await parseNodPdf_(file);

    status.textContent =
      `${file.name}: extracted ${result.textLength.toLocaleString()} characters ` +
      `from ${result.pageCount.toLocaleString()} page${result.pageCount === 1 ? '' : 's'} ` +
      `in ${result.extractionMs.toLocaleString()} ms.`;

    console.log('Extracted NOD text:\n', result.text);

  } catch (error) {
    status.textContent = `Could not read ${file.name}.`;

    console.error('Could not parse NOD PDF:', error);
  }
}


// ==================== RENDER ====================

function renderNodWorkspace_() {
  const workspace = document.getElementById('nodWorkspace');

  if (!currentNod?.file) {
    workspace.hidden = true;
    return;
  }

  workspace.hidden = false;

  document.getElementById('nodCaseNumber').textContent =
    currentNod.caseNumber || 'Not parsed yet';

  document.getElementById('nodEmployerName').textContent =
    currentNod.employerName || 'Not parsed yet';

  document.getElementById('nodNoticeDate').textContent =
    currentNod.noticeDate
      ? GlobalQueryUI.formatDate(currentNod.noticeDate)
      : 'Not parsed yet';

  document.getElementById('nodDueDate').textContent =
    currentNod.dueDate
      ? GlobalQueryUI.formatDate(currentNod.dueDate)
      : 'Not parsed yet';

  renderNodDeficiencies_();
}


function renderNodDeficiencies_() {
  const container = document.getElementById('nodDeficiencyList');
  const deficiencies = Array.isArray(currentNod?.deficiencies)
    ? currentNod.deficiencies
    : [];

  document.getElementById('nodDeficiencyCount').textContent =
    `${deficiencies.length.toLocaleString()} deficienc${deficiencies.length === 1 ? 'y' : 'ies'} detected.`;

  if (!deficiencies.length) {
    container.innerHTML = `
      <div class="muted">
        No deficiencies have been parsed yet.
      </div>
    `;

    return;
  }

  container.innerHTML = deficiencies.map((deficiency, index) => `
    <section class="nod-deficiency-card" data-deficiency-index="${index}">
      <div class="nod-deficiency-header">
        <strong>Deficiency ${GlobalQueryUI.escapeHtml_(deficiency.number ?? index + 1)}</strong>
        <span class="muted small">${GlobalQueryUI.escapeHtml_(deficiency.type || 'Unclassified')}</span>
      </div>

      <div class="nod-deficiency-body">

        <div class="nod-deficiency-field">
          <span class="label">Regulatory Citation</span>
          <div class="nod-deficiency-text">
            ${GlobalQueryUI.escapeHtml_(formatNodCitations_(deficiency.citations))}
          </div>
        </div>

        <div class="nod-deficiency-field">
          <span class="label">Context</span>
          <div class="nod-deficiency-text">
            ${GlobalQueryUI.escapeHtml_(deficiency.context || '—')}
          </div>
        </div>

        <div class="nod-deficiency-field">
          <span class="label">Modification Required</span>
          <div class="nod-deficiency-text">
            ${GlobalQueryUI.escapeHtml_(deficiency.modificationRequired || '—')}
          </div>
        </div>

      </div>
    </section>
  `).join('');
}


function formatNodCitations_(citations) {
  if (Array.isArray(citations)) {
    return citations.filter(Boolean).join(', ') || '—';
  }

  return String(citations || '—');
}


// ==================== EVENTS ====================

function bindNodEvents_() {
  const input = document.getElementById('nodFileInput');
  const chooseButton = document.getElementById('chooseNodFileBtn');
  const uploadCard = document.getElementById('nodUploadCard');

  chooseButton.addEventListener('click', () => {
    input.click();
  });

  input.addEventListener('change', () => {
    handleNodFile_(input.files?.[0]);
  });

  document.getElementById('clearNodBtn').addEventListener('click', clearCurrentNod_);

  uploadCard.addEventListener('dragover', event => {
    event.preventDefault();
    uploadCard.classList.add('dragover');
  });

  uploadCard.addEventListener('dragleave', () => {
    uploadCard.classList.remove('dragover');
  });

  uploadCard.addEventListener('drop', event => {
    event.preventDefault();
    uploadCard.classList.remove('dragover');

    handleNodFile_(event.dataTransfer?.files?.[0]);
  });
}


// ==================== TEST HELPER ====================

function loadTestNod_() {
  setCurrentNod_({
    ...createEmptyNodState_(),
    file: new File(['test'], 'test-nod.pdf', { type: 'application/pdf' }),
    fileName: 'test-nod.pdf',
    documentType: 'NOD',
    noticeDate: '2026-09-02',
    dueDate: '2026-09-07',
    caseNumber: 'H-300-25305-355491',
    caseKey: '25305-355491',
    employerName: 'Test Employer',
    caseSource: '790 Snapshot',
    deficiencies: [
      {
        number: 1,
        type: 'Job Requirements',
        citations: ['20 CFR 655.122'],
        context: 'Example deficiency context for testing the workspace.',
        modificationRequired: 'The employer must revise the job order.'
      },
      {
        number: 2,
        type: 'Wages',
        citations: ['20 CFR 655.120'],
        context: 'Example wage deficiency context.',
        modificationRequired: 'The employer must update the offered wage.'
      }
    ]
  });

  document.getElementById('nodUploadStatus').textContent =
    'Test NOD loaded.';
}


// ==================== INITIALIZATION ====================

function initializeNod() {
  if (nodInitialized) return;
  nodInitialized = true;

  currentNod = createEmptyNodState_();
  bindNodEvents_();
  renderNodWorkspace_();
}


document
  .querySelector('.tab-btn[data-tab="nodTab"]')
  ?.addEventListener('click', initializeNod);


window.initializeNod = initializeNod;
window.loadTestNod = loadTestNod_;
