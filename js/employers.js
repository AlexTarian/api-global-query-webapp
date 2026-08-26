let employers = [];
let employersInitialized = false;
let employerSearchRequest = 0;

function getCurrentEmployerFilters_() {
  return {
    employer: document.getElementById('filterEmployerName').value.trim(),
    fein: document.getElementById('filterEmployerFein').value.trim(),
    state: document.getElementById('filterEmployerState').value,
    agency: document.getElementById('filterEmployerAgency').value,
    phone: document.getElementById('filterEmployerPhone').value.trim(),
    email: document.getElementById('filterEmployerEmail').value.trim(),
    h2alc: document.getElementById('filterEmployerH2alc').value,
    active: document.getElementById('filterEmployerActive').checked,
    limit: Number(document.getElementById('employerLimit').value) || 25
  };
}

async function searchEmployers_(filters) {
  let query = window.globalQuerySupabase
    .from('employer_directory')
    .select(`
      fein,
      employer_name,
      employer_address,
      employer_state,
      contact_name,
      contact_phone,
      contact_email,
      total_cases,
      total_workers,
      is_h2alc,
      is_active,
      latest_start_date,
      agency_keys,
      agency_names
    `, { count: 'exact' });

  if (filters.employer) {
    query = query.ilike('employer_name', `%${filters.employer}%`);
  }

  if (filters.fein) {
    query = query.ilike('fein', `%${filters.fein}%`);
  }

  if (filters.state) {
    query = query.eq('employer_state', filters.state);
  }

  if (filters.agency) {
    query = query.contains('agency_keys', [filters.agency]);
  }

  if (filters.phone) {
    const phoneDigits = filters.phone.replace(/\D/g, '');

    if (phoneDigits) {
      query = query.ilike('phone_digits', `%${phoneDigits}%`);
    }
  }

  if (filters.email) {
    query = query.ilike('contact_email', `%${filters.email}%`);
  }

  if (filters.active) {
    query = query.eq('is_active', true);
  }

  if (filters.h2alc === 'true') {
    query = query.eq('is_h2alc', true);
  }

  if (filters.h2alc === 'false') {
    query = query.eq('is_h2alc', false);
  }

  query = query
    .order('latest_start_date', { ascending: false })
    .order('employer_name', { ascending: true })
    .limit(filters.limit);

  const { data, error, count } = await query;
  if (error) throw error;

  return {
    rows: data || [],
    matched: count ?? 0,
    returned: data?.length || 0
  };
}

function renderEmployers_(rows = employers) {
  const body = document.querySelector('#employersTable tbody');

  body.innerHTML = rows.map(row => `
    <tr class="clickable" data-fein="${GlobalQueryUI.escapeHtml_(row.fein)}">
      <td class="ellipsis" title="${GlobalQueryUI.escapeHtml_(row.employer_name || '')}">
        ${GlobalQueryUI.escapeHtml_(row.employer_name || '—')}
      </td>
      <td>${GlobalQueryUI.escapeHtml_(row.employer_state || '—')}</td>
      <td>${GlobalQueryUI.escapeHtml_(row.fein || '—')}</td>
      <td class="center">${(Number(row.total_cases) || 0).toLocaleString()}</td>
      <td>${GlobalQueryUI.formatDate(row.latest_start_date)}</td>
    </tr>
  `).join('') || '<tr><td colspan="5" class="muted">No matching employers.</td></tr>';
}

async function loadEmployerCaseHistory_(fein) {
  const { data, error } = await window.globalQuerySupabase
    .from('cases_with_occupation')
    .select(`
      case_num,
      case_status,
      start_date,
      end_date,
      h2a_workers,
      soc_code,
      job_title,
      case_agencies(
        agencies(
          normalized_name,
          display_name
        )
      )
    `)
    .eq('fein', fein)
    .order('start_date', { ascending: false });

  if (error) throw error;

  return data || [];
}

async function getEmployerByFein_(fein) {
  const existing = employers.find(row => row.fein === fein);
  if (existing) return existing;

  const { data, error } = await window.globalQuerySupabase
    .from('employer_directory')
    .select(`
      fein,
      employer_name,
      employer_address,
      employer_state,
      contact_name,
      contact_phone,
      contact_email,
      total_cases,
      total_workers,
      latest_start_date
    `)
    .eq('fein', fein)
    .single();

  if (error) throw error;

  return data;
}

async function openEmployerDetail_(fein) {
  if (!fein) return;

  let employer;

  try {
    employer = await getEmployerByFein_(fein);
  } catch (error) {
    console.error('Could not load employer:', error);
    return;
  }

  if (!employer) {
    console.warn('Employer not found:', fein);
    return;
  }

  const modal = document.getElementById('detailModalOverlay');
  const historyContainer = document.getElementById('modalEmployerHistory');

  setCaseModalMode_('employer');

  document.getElementById('detailModalTitle').textContent =
    employer.employer_name || 'Employer';

  document.getElementById('detailModalEmployer').textContent =
    cleanGlobalQueryText_(employer.contact_name) || '—';

  GlobalQueryUI.appendKv(
    document.getElementById('modalEmployerInfo'),
    [
      [
        'FEIN',
        GlobalQueryUI.escapeHtml_(employer.fein || '—')
      ],
      [
        'Address',
        GlobalQueryUI.escapeHtml_(
          cleanGlobalQueryText_(employer.employer_address) || '—'
        )
      ],
      [
        'Contact',
        GlobalQueryUI.escapeHtml_(
          cleanGlobalQueryText_(employer.contact_name) || '—'
        )
      ],
      [
        'Phone',
        GlobalQueryUI.escapeHtml_(employer.contact_phone || '—')
      ],
      [
        'Email',
        GlobalQueryUI.escapeHtml_(employer.contact_email || '—')
      ],
    ]
  );

  document.getElementById('modalEmployerCases').textContent =
    ' ' + (Number(employer.total_cases) || 0).toLocaleString() + ' Cases';

  historyContainer.innerHTML =
    '<div class="muted">Loading filing history...</div>';

  modal.classList.remove('hidden');

  try {
    const history = await loadEmployerCaseHistory_(fein);
    renderEmployerHistory_(history);
  } catch (error) {
    console.error('Could not load employer filing history:', error);

    historyContainer.innerHTML = `
      <div class="error-cell">
        ${GlobalQueryUI.escapeHtml_(
          GlobalQueryUI.getErrorMessage_(error)
        )}
      </div>
    `;
  }
}

function renderEmployerHistory_(history) {
  const container = document.getElementById('modalEmployerHistory');

  if (!history.length) {
    container.innerHTML =
      '<div class="muted">No filing history was found for this employer.</div>';
    return;
  }

  container.innerHTML = history.map(row => {
    const agencyRows = Array.isArray(row.case_agencies)
      ? row.case_agencies
      : [];

    const agencies = agencyRows
      .map(item => item?.agencies)
      .filter(Boolean);

    const agencyNames = agencies
      .map(item => item.display_name || item.normalized_name)
      .filter(Boolean)
      .join(' | ');

    const jobType = row.soc_code && row.job_title
      ? `${row.soc_code}: ${row.job_title}`
      : row.soc_code || row.job_title || '—';

    return `
      <button
        type="button"
        class="employer-history-tile"
        data-case="${GlobalQueryUI.escapeHtml_(row.case_num || '')}"
      >
        <div class="employer-history-header">
          <strong>${GlobalQueryUI.escapeHtml_(row.case_num || '—')}</strong>
          <span>${GlobalQueryUI.escapeHtml_(row.case_status || '—')}</span>
        </div>

        <div class="employer-history-period">
          ${GlobalQueryUI.formatDate(row.start_date)}
          –
          ${GlobalQueryUI.formatDate(row.end_date)}
        </div>

        <div class="employer-history-meta">
          <span>Workers: ${(Number(row.h2a_workers) || 0).toLocaleString()}</span>
          <span>${GlobalQueryUI.escapeHtml_(agencyNames || '—')}</span>
        </div>
      </button>
    `;
  }).join('');
}

async function openEmployerHistoryCase_(caseNum) {
  if (!caseNum) return;

  const { data, error } = await window.globalQuerySupabase
    .from('cases_with_occupation')
    .select(caseSelect_(false))
    .eq('case_num', caseNum)
    .single();

  if (error) throw error;
  if (!data) return;

  openCaseModal(mapCaseRow_(data), 'case');
}

function setEmployersLoading_(loading) {
  const applyButton = document.getElementById('applyEmployerFiltersBtn');
  const clearButton = document.getElementById('clearEmployerFiltersBtn');

  applyButton.disabled = loading;
  clearButton.disabled = loading;
  applyButton.textContent = loading ? 'Loading…' : '⌕ Search';

  if (loading) {
    document.querySelector('#employersTable tbody').innerHTML =
      '<tr><td colspan="5" class="muted">Loading employers…</td></tr>';

    document.getElementById('employerRowCountLabel').textContent =
      'Searching…';
  }
}

async function initializeEmployers() {
  if (employersInitialized) return;
  employersInitialized = true;

  GlobalQueryUI.populateStateDropdown('filterEmployerState');
  await loadEmployerAgencyDropdown_();
  bindEmployerEvents_();
  await applyEmployerFilters_();
}

async function applyEmployerFilters_() {
  const requestId = ++employerSearchRequest;
  const filters = getCurrentEmployerFilters_();

  setEmployersLoading_(true);

  try {
    const result = await searchEmployers_(filters);

    if (requestId !== employerSearchRequest) return;

    employers = result.rows;
    renderEmployers_(employers);

    document.getElementById('employerRowCountLabel').textContent =
      result.matched > result.returned
        ? `Showing ${result.returned.toLocaleString()} of ${result.matched.toLocaleString()} employers`
        : `Showing ${result.returned.toLocaleString()} employer${result.returned === 1 ? '' : 's'}`;

  } catch (error) {
    if (requestId !== employerSearchRequest) return;

    console.error('Employer search failed:', error);

    employers = [];

    document.querySelector('#employersTable tbody').innerHTML =
      `<tr><td colspan="5" class="error-cell">${GlobalQueryUI.escapeHtml_(
        GlobalQueryUI.getErrorMessage_(error)
      )}</td></tr>`;

    document.getElementById('employerRowCountLabel').textContent =
      'Unable to load employers';

  } finally {
    if (requestId === employerSearchRequest) {
      setEmployersLoading_(false);
    }
  }
}

async function loadEmployerAgencyDropdown_() {
  const select = document.getElementById('filterEmployerAgency');
  if (!select) return;

  try {
    const { data, error } = await window.globalQuerySupabase
      .from('agencies')
      .select(`
        normalized_name,
        display_name
      `)
      .not('normalized_name', 'is', null)
      .order('display_name', { ascending: true });

    if (error) throw error;

    select.innerHTML = '<option value="">All Agencies</option>';

    (data || []).forEach(agency => {
      const key = String(agency.normalized_name || '').trim();
      const name = String(
        agency.display_name ||
        agency.normalized_name ||
        ''
      ).trim();

      if (!key || !name) return;

      const option = document.createElement('option');
      option.value = key;
      option.textContent = name;

      select.appendChild(option);
    });

  } catch (error) {
    console.error('Could not load employer agency filter:', error);
  }
}

function bindEmployerEvents_() {
  document.getElementById('applyEmployerFiltersBtn')
    .addEventListener('click', applyEmployerFilters_);

  // Search when Enter is pressed in either text field.
  [
    'filterEmployerName',
    'filterEmployerFein',
    'filterEmployerPhone',
    'filterEmployerEmail'
  ].forEach(id => {
    document.getElementById(id).addEventListener('keydown', event => {
      if (event.key === 'Enter') {
        event.preventDefault();
        applyEmployerFilters_();
      }
    });
  });

  document.getElementById('clearEmployerFiltersBtn')
    .addEventListener('click', () => {
      [
        'filterEmployerName',
        'filterEmployerFein',
        'filterEmployerState',
        'filterEmployerAgency',
        'filterEmployerPhone',
        'filterEmployerEmail',
        'filterEmployerH2alc'
      ].forEach(id => {
        document.getElementById(id).value = '';
      });

      document.getElementById('filterEmployerActive').checked = false;

      applyEmployerFilters_();
    });

  document.getElementById('employerLimit')
    .addEventListener('change', applyEmployerFilters_);

  document.querySelector('#employersTable tbody')
    .addEventListener('click', event => {
      const row = event.target.closest('tr[data-fein]');
      if (!row) return;

      openEmployerDetail_(row.dataset.fein);
    });

  document.getElementById('modalEmployerHistory')
    .addEventListener('click', async event => {
      const tile = event.target.closest('[data-case]');
      if (!tile) return;

      try {
        await openEmployerHistoryCase_(tile.dataset.case);
      } catch (error) {
        console.error('Could not open employer case:', error);
      }
    });
}

window.initializeEmployers = initializeEmployers;
window.openEmployerDetail = openEmployerDetail_;
