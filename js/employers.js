let employers = [];
let employersInitialized = false;
let employerSearchRequest = 0;

function getCurrentEmployerFilters_() {
  return {
    employer: document.getElementById('filterEmployerName').value.trim(),
    fein: document.getElementById('filterEmployerFein').value.trim(),
    state: document.getElementById('filterEmployerState').value,
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
      latest_start_date
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

function bindEmployerEvents_() {
  document.getElementById('applyEmployerFiltersBtn')
    .addEventListener('click', applyEmployerFilters_);

  // Search when Enter is pressed in either text field.
  ['filterEmployerName', 'filterEmployerFein'].forEach(id => {
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
        'filterEmployerState'
      ].forEach(id => {
        document.getElementById(id).value = '';
      });

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
}

window.initializeEmployers = initializeEmployers;
