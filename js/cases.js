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
    case_status,
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
    soc_code,
    job_title,
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
    status: row.case_status || '',
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
    socCode: row.soc_code || '',
    jobType: row.job_title || '',
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
    status: document.getElementById('filterStatus').value,
    jobType: document.getElementById('filterJobType').value,
    limit: Number(document.getElementById('caseLimit').value) || 25
  };
}

async function searchGlobalQueryCases(filters) {
  const client = window.globalQuerySupabase;
  const agencyFiltered = Boolean(filters.agency);

  let query = client.from('cases_with_occupation').select(caseSelect_(agencyFiltered), { count: 'exact' });

  if (filters.caseNum) query = query.ilike('case_num', `%${filters.caseNum}%`);
  if (filters.employer) query = query.ilike('employer_name', `%${filters.employer}%`);
  if (filters.state) query = query.eq('employer_state', filters.state);
  if (filters.start) query = query.gte('start_date', filters.start);
  if (filters.end) query = query.lte('start_date', filters.end);
  if (filters.agency) query = query.eq('case_agencies.agencies.normalized_name', filters.agency);
  if (filters.status) {
    query = query.eq('case_status', filters.status);
  }
  if (filters.jobType) {
    query = query.or(
      `soc_code.eq.${filters.jobType},soc_code.like.${filters.jobType}.%`
    );
  }

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

async function loadJobTypeDropdown() {
  const select = document.getElementById('filterJobType');
  select.disabled = true;
  select.innerHTML = '<option value="">Loading job types…</option>';

  try {
    const { data, error } = await window.globalQuerySupabase
      .from('case_job_types')
      .select('soc_code,job_title')
      .order('job_title');

    if (error) throw error;

    select.innerHTML = '<option value="">All Job Types</option>';

    (data || []).forEach(item => {
      const option = document.createElement('option');
      option.value = item.soc_code;
      option.textContent = item.job_title;
      select.appendChild(option);
    });
  } catch (error) {
    console.error('Could not load job types:', error);
    select.innerHTML = '<option value="">All Job Types</option>';
  } finally {
    select.disabled = false;
  }
}

async function loadStatusDropdown() {
  const select = document.getElementById('filterStatus');
  select.disabled = true;
  select.innerHTML = '<option value="">Loading statuses…</option>';

  try {
    const { data, error } = await window.globalQuerySupabase
      .from('case_statuses')
      .select('case_status')
      .order('case_status');

    if (error) throw error;

    select.innerHTML = '<option value="">All Statuses</option>';

    (data || []).forEach(row => {
      const status = String(row.case_status || '').trim();
      if (!status) return;

      const option = document.createElement('option');
      option.value = status;
      option.textContent = status;
      select.appendChild(option);
    });
  } catch (error) {
    console.error('Could not load statuses:', error);
    select.innerHTML = '<option value="">All Statuses</option>';
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
    GlobalQueryUI.appendKv(document.getElementById('modalBusinessInfo'), [
      ['Address', GlobalQueryUI.escapeHtml_(cleanGlobalQueryText_(caseRow.address) || '—')],
      ['FEIN', GlobalQueryUI.escapeHtml_(caseRow.fein || '—')],
      ['Contact', GlobalQueryUI.escapeHtml_(cleanGlobalQueryText_(caseRow.contact) || '—')],
      ['Phone', GlobalQueryUI.escapeHtml_(caseRow.phone || '—')],
      ['Email', GlobalQueryUI.escapeHtml_(caseRow.email || '—')],
    ]);

    GlobalQueryUI.appendKv(document.getElementById('modalJobInfo'), [
      ['Status', GlobalQueryUI.escapeHtml_(caseRow.status || '—')],
      ['Job Type', `
        <span class="modal-job-type" title="${GlobalQueryUI.escapeHtml_(
          caseRow.socCode && caseRow.jobType
            ? `${caseRow.socCode}: ${caseRow.jobType}`
            : caseRow.socCode || caseRow.jobType || '—'
        )}">
          ${caseRow.socCode ? `${GlobalQueryUI.escapeHtml_(caseRow.socCode)}: ` : ''}${GlobalQueryUI.escapeHtml_(caseRow.jobType || '—')}
        </span>
      `],
      ['Period of Need', `${GlobalQueryUI.formatDate(caseRow.start)} – ${GlobalQueryUI.formatDate(caseRow.end)}`],
      ['Workers', GlobalQueryUI.escapeHtml_(caseRow.workers ?? '—')],
      ['H-2ALC', GlobalQueryUI.formatBoolean_(caseRow.h2alc)],
      ['Cert Req', GlobalQueryUI.formatBoolean_(caseRow.cert)],
      ['Drive Req', GlobalQueryUI.formatBoolean_(caseRow.drive)],
      ['Multi Worksites', GlobalQueryUI.formatBoolean_(caseRow.multiWorksites)],
      ['Multi Housing', GlobalQueryUI.formatBoolean_(caseRow.multiHousing)],
      ['Agency', GlobalQueryUI.escapeHtml_(caseRow.displayAgency || caseRow.agency || '—')]
    ]);

    renderModalJobDescription_(caseRow);
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

async function downloadFilteredGlobalQueryCases() {
  const button = document.getElementById('downloadCsvButton');
  const filters = getCurrentGlobalQueryFilters();
  const originalText = button.textContent;

  const confirmed = window.confirm('Export all cases matching the current filters?');
  if (!confirmed) return;

  button.disabled = true;
  button.textContent = 'Preparing CSV...';

  try {
    const rows = await fetchAllFilteredGlobalQueryCases_(filters);

    if (!rows.length) {
      alert('No cases matched the selected filters.');
      return;
    }

    const csvText = buildGlobalQueryCsv_(rows);
    const filename = `GlobalQuery_Export_${new Date().toISOString().slice(0, 10)}.csv`;

    const blob = new Blob(['\uFEFF' + csvText], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');

    link.href = url;
    link.download = filename;

    document.body.appendChild(link);
    link.click();
    link.remove();

    URL.revokeObjectURL(url);
  } catch (error) {
    console.error('CSV export failed:', error);
    alert(`The CSV export failed: ${GlobalQueryUI.getErrorMessage_(error)}`);
  } finally {
    button.disabled = false;
    button.textContent = originalText;
  }
}

async function fetchAllFilteredGlobalQueryCases_(filters) {
  const batchSize = 1000;
  const allRows = [];
  let from = 0;

  while (true) {
    let query = window.globalQuerySupabase
      .from('cases_with_occupation')
      .select(`
        case_num,
        case_status,
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
        soc_code,
        job_title,
        job_description_preview,
        cert_req,
        drive_req,
        has_multiple_worksites,
        has_multiple_housing,
        case_agencies(
          agencies(
            normalized_name,
            display_name
          )
        )
      `)
      .order('case_num', { ascending: false })
      .range(from, from + batchSize - 1);

    if (filters.caseNum) query = query.ilike('case_num', `%${filters.caseNum}%`);
    if (filters.employer) query = query.ilike('employer_name', `%${filters.employer}%`);
    if (filters.state) query = query.eq('employer_state', filters.state);
    if (filters.start) query = query.gte('start_date', filters.start);
    if (filters.end) query = query.lte('start_date', filters.end);

    if (filters.agency) {
      query = query
        .select(`
          case_num,
          case_status,
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
          soc_code,
          job_title,
          job_description_preview,
          cert_req,
          drive_req,
          has_multiple_worksites,
          has_multiple_housing,
          case_agencies!inner(
            agencies!inner(
              normalized_name,
              display_name
            )
          )
        `)
        .eq('case_agencies.agencies.normalized_name', filters.agency);
    }

    if (filters.status) {
      query = query.eq('case_status', filters.status);
    }

    if (filters.jobType) {
      query = query.or(
        `soc_code.eq.${filters.jobType},soc_code.like.${filters.jobType}.%`
      );
    }

    const { data, error } = await query;

    if (error) throw error;

    const rows = (data || []).map(mapCaseRow_);
    allRows.push(...rows);

    if (!data || data.length < batchSize) break;

    from += batchSize;
  }

  return allRows;
}

function renderModalJobDescription_(row) {
  const container = document.getElementById('modalJobDesc');
  const description = row.desc || '';

  if (!description) {
    container.textContent = '—';
    return;
  }

  if (description.length >= 750 && row.caseNum) {
    container.innerHTML =
      `${GlobalQueryUI.escapeHtml_(description)}... ` +
      `<a href="${GlobalQueryUI.escapeHtml_(getSeasonalJobsUrl_(row))}" target="_blank" rel="noopener noreferrer">See more on SJ page</a>`;
  } else {
    container.textContent = description;
  }
}

function buildGlobalQueryCsv_(rows) {
  const headers = [
    'Case Number',
    'Status',
    'Employer',
    'FEIN',
    'H-2ALC',
    'Agency',
    'H-2A Workers',
    'Start Date',
    'End Date',
    'Employer Address',
    'State',
    'Contact Name',
    'Contact Phone',
    'Contact Email',
    'Job Type',
    'Job Description'
  ];

  const csvRows = [headers.map(escapeCsvValue_).join(',')];

  rows.forEach(row => {
    csvRows.push([
      row.caseNum,
      row.status,
      row.employer,
      row.fein,
      formatCsvBoolean_(row.h2alc),
      row.displayAgency || row.agency,
      row.workers,
      row.start,
      row.end,
      row.address,
      row.state,
      row.contact,
      row.phone,
      row.email,
      row.jobType,
      getCsvDescription_(row)
    ].map(escapeCsvValue_).join(','));
  });

  return csvRows.join('\r\n');
}

function getCsvDescription_(row) {
  const description = row.desc || '';

  return description.length >= 750
    ? `${description}...See more on SJ page`
    : description;
}

function cleanGlobalQueryText_(value) {
  return String(value ?? '')
    .replace(/[\u00A0\u1680\u2000-\u200B\u202F\u205F\u3000]/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\r?\n */g, '\n')
    .trim();
}

function escapeCsvValue_(value) {
  const text = cleanGlobalQueryText_(value);

  if (!/[,"\r\n]/.test(text)) return text;

  return `"${text.replace(/"/g, '""')}"`;
}

function formatCsvBoolean_(value) {
  if (value === true) return 'Y';
  if (value === false) return 'N';
  return '';
}

function bindCaseEvents_() {
  document.getElementById('applyFiltersBtn').addEventListener('click', applyCaseFilters);

  document.getElementById('clearFiltersBtn').addEventListener('click', () => {
    ['filterCaseNum', 'filterEmployer', 'filterState', 'filterStart', 'filterEnd', 'filterAgent', 'filterStatus', 'filterJobType'].forEach(id => document.getElementById(id).value = '');
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

  document.getElementById('downloadCsvButton').addEventListener('click', downloadFilteredGlobalQueryCases);
}

async function initializeCases() {
  if (casesInitialized) return;
  casesInitialized = true;

  GlobalQueryUI.populateStateDropdown();
  bindCaseEvents_();
  
  await Promise.all([
    loadAgencyDropdown(),
    loadJobTypeDropdown(),
    loadStatusDropdown()
  ]);
  
  await applyCaseFilters();
}

window.initializeCases = initializeCases;
window.applyCaseFilters = applyCaseFilters;
window.openCaseModal = openCaseModal;
