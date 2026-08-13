let cases = [];
let caseSearchRequest = 0;
let activeCaseModalRow = null;
let casesInitialized = false;

function caseSelect_(agencyFiltered = false) {
  const relation = agencyFiltered
    ? 'case_agencies!inner(agencies!inner(normalized_name,display_name))'
    : 'case_agencies(agencies(normalized_name,display_name))';

  return `
    case_num,
    h2alc,
    employer_name,
    employer_address,
    employer_state,
    fein,
    contact_name,
    contact_phone,
    contact_email,
    h2a_workers,
    start_date,
    end_date,
    job_description_preview,
    cert_req,
    drive_req,
    has_multiple_worksites,
    has_multiple_housing,
    ${relation}
  `;
}

function mapCaseRow_(row) {
  const agencyRows = Array.isArray(row.case_agencies) ? row.case_agencies : [];
  const agencies = agencyRows.map(item => item?.agencies).filter(Boolean);
  const agencyKeys = agencies.map(item => item.normalized_name).filter(Boolean);
  const agencyNames = agencies.map(item => item.display_name || item.normalized_name).filter(Boolean);

  return {
    caseNum: row.case_num || '',
    employer: row.employer_name || '',
    address: row.employer_address || '',
    state: row.employer_state || '',
    fein: row.fein || '',
    contact: row.contact_name || '',
    phone: row.contact_phone || '',
    email: row.contact_email || '',
    workers: row.h2a_workers ?? '',
    start: row.start_date || '',
    end: row.end_date || '',
    desc: row.job_description_preview || '',
    h2alc: row.h2alc,
    cert: row.cert_req,
    drive: row.drive_req,
    multiWorksites: row.has_multiple_worksites,
    multiHousing: row.has_multiple_housing,
    agency: agencyKeys.join(' | '),
    displayAgency: agencyNames.join(' | ')
  };
}

function getCurrentGlobalQueryFilters() {
  return {
    caseNum: document.getElementById('filterCaseNum').value.trim(),
    employer: document.getElementById('filterEmployer').value.trim(),
    state: document.getElementById('filterState').value,
    start: document.getElementById('filterStart').value,
    end: document.getElementById('filterEnd').value,
    agency: document.getElementById('filterAgent').value,
    limit: Number(document.getElementById('caseLimit').value) || 25
  };
}

async function searchGlobalQueryCases(filters) {
  const client = window.globalQuerySupabase;
  const agencyFiltered = Boolean(filters.agency);

  let query = client.from('cases').select(caseSelect_(agencyFiltered), { count: 'exact' });

  if (filters.caseNum) query = query.ilike('case_num', `%${filters.caseNum}%`);
  if (filters.employer) query = query.ilike('employer_name', `%${filters.employer}%`);
  if (filters.state) query = query.eq('employer_state', filters.state);
  if (filters.start) query = query.gte('start_date', filters.start);
  if (filters.end) query = query.lte('start_date', filters.end);
  if (filters.agency) query = query.eq('case_agencies.agencies.normalized_name', filters.agency);

  query = query.order('case_num', { ascending: false }).limit(filters.limit);

  const { data, error, count } = await query;
  if (error) throw error;

  return { rows: (data || []).map(mapCaseRow_), matched: count ?? 0, returned: data?.length || 0 };
}

async function applyCaseFilters() {
  const requestId = ++caseSearchRequest;
  const filters = getCurrentGlobalQueryFilters();
  const startedAt = performance.now();

  setCasesLoading_(true);

  try {
    const result = await searchGlobalQueryCases(filters);
    if (requestId !== caseSearchRequest) return;

    cases = result.rows;
    renderCases(cases);

    const matched = Number(result.matched) || 0;
    const returned = Number(result.returned) || 0;
    document.getElementById('rowCountLabel').textContent = matched > returned
      ? `Showing ${returned.toLocaleString()} of ${matched.toLocaleString()} matching cases`
      : `Showing ${returned.toLocaleString()} case${returned === 1 ? '' : 's'}`;

    console.log('Supabase case search:', { roundTripMs: Math.round(performance.now() - startedAt), matched, returned });
  } catch (error) {
    if (requestId !== caseSearchRequest) return;

    console.error('Case search failed:', error);
    cases = [];
    document.querySelector('#casesTable tbody').innerHTML = `<tr><td colspan="4" class="error-cell">${GlobalQueryUI.escapeHtml_(GlobalQueryUI.getErrorMessage_(error))}</td></tr>`;
    document.getElementById('rowCountLabel').textContent = 'Unable to load cases';
  } finally {
    if (requestId === caseSearchRequest) setCasesLoading_(false);
  }
}

function setCasesLoading_(loading) {
  const applyButton = document.getElementById('applyFiltersBtn');
  const clearButton = document.getElementById('clearFiltersBtn');

  applyButton.disabled = loading;
  clearButton.disabled = loading;
  applyButton.textContent = loading ? 'Loading…' : '⌕ Search';

  if (loading) {
    document.querySelector('#casesTable tbody').innerHTML = '<tr><td colspan="4" class="muted">Loading cases…</td></tr>';
    document.getElementById('rowCountLabel').textContent = 'Searching…';
  }
}

function renderCases(rows = cases) {
  const body = document.querySelector('#casesTable tbody');

  body.innerHTML = rows.map(row => `
    <tr class="clickable" data-case="${GlobalQueryUI.escapeHtml_(row.caseNum)}">
      <td>${GlobalQueryUI.escapeHtml_(row.caseNum || '—')}</td>
      <td class="ellipsis" title="${GlobalQueryUI.escapeHtml_(row.employer || '')}">${GlobalQueryUI.escapeHtml_(row.employer || '—')}</td>
      <td>${GlobalQueryUI.formatDate(row.start)} – ${GlobalQueryUI.formatDate(row.end)}</td>
      <td class="ellipsis" title="${GlobalQueryUI.escapeHtml_(row.displayAgency || row.agency || '')}">${GlobalQueryUI.escapeHtml_(row.displayAgency || row.agency || '—')}</td>
    </tr>
  `).join('') || '<tr><td colspan="4" class="muted">No matching cases.</td></tr>';
}

async function loadAgencyDropdown() {
  const select = document.getElementById('filterAgent');
  select.disabled = true;
  select.innerHTML = '<option value="">Loading agencies…</option>';

  try {
    const { data, error } = await window.globalQuerySupabase.from('agencies').select('normalized_name,display_name').order('display_name');
    if (error) throw error;

    select.innerHTML = '<option value="">All Agencies</option>';
    (data || []).forEach(agency => {
      const option = document.createElement('option');
      option.value = agency.normalized_name;
      option.textContent = agency.display_name || agency.normalized_name;
      select.appendChild(option);
    });
  } catch (error) {
    console.error('Could not load agency options:', error);
    select.innerHTML = '<option value="">All Agencies</option>';
  } finally {
    select.disabled = false;
  }
}

function setCaseModalMode_(mode) {
  const isChurn = mode === 'churn';
  document.getElementById('modalBusinessJobSection')?.classList.toggle('hidden', isChurn);
  document.getElementById('modalJobDescriptionSection')?.classList.toggle('hidden', isChurn);
  document.getElementById('modalActionRow')?.classList.toggle('hidden', isChurn);
}

function openCaseModal(caseRow, mode = 'case') {
  if (!caseRow) return;

  activeCaseModalRow = caseRow;
  setCaseModalMode_(mode);

  const modal = document.getElementById('detailModalOverlay');
  const churnPanel = document.getElementById('modalChurnInfoPanel');
  const churnBanner = document.getElementById('churnBanner');

  document.getElementById('modalChurnInfo').innerHTML = '';
  churnPanel.classList.add('hidden');
  churnBanner.className = 'churn-banner hidden';
  churnBanner.innerHTML = '';
  document.getElementById('detailModalTitle').textContent = caseRow.caseNum || 'Case';
  document.getElementById('detailModalEmployer').textContent = caseRow.employer || '—';

  if (mode === 'case') {
    GlobalQueryUI.appendKv(document.getElementById('modalCaseInfo'), [
      ['Address', GlobalQueryUI.escapeHtml_(caseRow.address || '—')],
      ['Contact', GlobalQueryUI.escapeHtml_(caseRow.contact || '—')],
      ['Phone', GlobalQueryUI.escapeHtml_(caseRow.phone || '—')],
      ['Email', GlobalQueryUI.escapeHtml_(caseRow.email || '—')],
      ['Period of Need', `${GlobalQueryUI.formatDate(caseRow.start)} – ${GlobalQueryUI.formatDate(caseRow.end)}`],
      ['Workers', GlobalQueryUI.escapeHtml_(caseRow.workers ?? '—')],
      ['H-2ALC', GlobalQueryUI.formatBoolean_(caseRow.h2alc)],
      ['Cert Req', GlobalQueryUI.formatBoolean_(caseRow.cert)],
      ['Drive Req', GlobalQueryUI.formatBoolean_(caseRow.drive)],
      ['Multi Worksites', GlobalQueryUI.formatBoolean_(caseRow.multiWorksites)],
      ['Multi Housing', GlobalQueryUI.formatBoolean_(caseRow.multiHousing)],
      ['Agency', GlobalQueryUI.escapeHtml_(caseRow.displayAgency || caseRow.agency || '—')]
    ]);

    const desc = caseRow.desc ? `${caseRow.desc}${caseRow.desc.length >= 750 ? '…' : ''}` : '—';
    document.getElementById('modalJobDesc').textContent = desc;
  }

  modal.classList.remove('hidden');
}

function getJotformUrl_(caseRow) {
  if (!caseRow?.caseNum) throw new Error('This case does not have a case number.');

  const agencyKeys = String(caseRow.agency || '').split('|').map(value => value.trim().toUpperCase()).filter(Boolean);
  const formType = agencyKeys.includes(GLOBALQUERY_OUR_AGENCY) ? 'renew' : 'onboard';
  return `https://agri-placements.jotform.com/261243361011946?${new URLSearchParams({ formtype: formType, caseNum: caseRow.caseNum })}`;
}

function getSeasonalJobsUrl_(caseRow) {
  if (!caseRow?.caseNum) throw new Error('This case does not have a case number.');
  return `https://seasonaljobs.dol.gov/jobs/${encodeURIComponent(caseRow.caseNum)}`;
}

function getJobOrderUrl_(caseRow) {
  if (!caseRow?.caseNum) throw new Error('This case does not have a case number.');
  return `https://seasonaljobs.dol.gov/api/job-order/${encodeURIComponent(caseRow.caseNum)}`;
}

function openExternalUrl_(url) {
  window.open(url, '_blank', 'noopener,noreferrer');
}

async function copyTextToClipboard_(text) {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text);

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();

  const copied = document.execCommand('copy');
  textarea.remove();
  if (!copied) throw new Error('The browser could not copy the link.');
}

function closeCaseModal_() {
  document.getElementById('detailModalOverlay').classList.add('hidden');
}

function bindCaseEvents_() {
  document.getElementById('applyFiltersBtn').addEventListener('click', applyCaseFilters);

  document.getElementById('clearFiltersBtn').addEventListener('click', () => {
    ['filterCaseNum', 'filterEmployer', 'filterState', 'filterStart', 'filterEnd', 'filterAgent'].forEach(id => document.getElementById(id).value = '');
    applyCaseFilters();
  });

  document.getElementById('caseLimit').addEventListener('change', applyCaseFilters);

  document.querySelector('#casesTable tbody').addEventListener('click', event => {
    const row = event.target.closest('tr[data-case]');
    if (!row) return;
    openCaseModal(cases.find(item => item.caseNum === row.dataset.case));
  });

  document.getElementById('closeModalBtn').addEventListener('click', closeCaseModal_);
  document.getElementById('detailModalOverlay').addEventListener('click', event => { if (event.target.id === 'detailModalOverlay') closeCaseModal_(); });
  document.addEventListener('keydown', event => { if (event.key === 'Escape') closeCaseModal_(); });

  document.getElementById('copyJfBtn').addEventListener('click', async event => {
    const button = event.currentTarget;
    const originalText = button.textContent;

    try {
      await copyTextToClipboard_(getJotformUrl_(activeCaseModalRow));
      button.textContent = 'Copied!';
    } catch (error) {
      console.error('Could not copy Jotform link:', error);
      button.textContent = 'Copy Failed';
    }

    window.setTimeout(() => { button.textContent = originalText; }, 1400);
  });

  document.getElementById('openJfBtn').addEventListener('click', () => {
    try { openExternalUrl_(getJotformUrl_(activeCaseModalRow)); } catch (error) { console.error('Could not open Jotform:', error); }
  });

  document.getElementById('seasonalJobsBtn').addEventListener('click', () => {
    try { openExternalUrl_(getSeasonalJobsUrl_(activeCaseModalRow)); } catch (error) { console.error('Could not open SeasonalJobs:', error); }
  });

  document.getElementById('jobOrderBtn').addEventListener('click', () => {
    try { openExternalUrl_(getJobOrderUrl_(activeCaseModalRow)); } catch (error) { console.error('Could not open the job order:', error); }
  });

  document.getElementById('downloadCsvButton').addEventListener('click', () => {
    alert('CSV export will be ported after the Supabase case search is validated.');
  });
}

async function initializeCases() {
  if (casesInitialized) return;
  casesInitialized = true;

  GlobalQueryUI.populateStateDropdown();
  bindCaseEvents_();
  await loadAgencyDropdown();
  await applyCaseFilters();
}

window.initializeCases = initializeCases;
window.applyCaseFilters = applyCaseFilters;
window.openCaseModal = openCaseModal;
