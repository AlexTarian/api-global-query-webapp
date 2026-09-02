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

function handleNodFile_(file) {
  if (!file) return;

  if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
    document.getElementById('nodUploadStatus').textContent = 'Please choose a PDF file.';
    return;
  }

  const nod = createEmptyNodState_();

  nod.file = file;
  nod.fileName = file.name;

  setCurrentNod_(nod);

  document.getElementById('nodUploadStatus').textContent =
    `${file.name} selected. Parsing will be added next.`;
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

  document.getElementById('nodCaseSource').textContent =
    currentNod.caseSource || 'Not matched yet';

  document.getElementById('nodNoticeDate').textContent =
    currentNod.noticeDate
      ? GlobalQueryUI.formatDate(currentNod.noticeDate)
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
