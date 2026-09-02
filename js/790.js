let jobOrders790 = [];
let jobOrder790SearchRequest = 0;
let jobOrders790Initialized = false;


// ==================== MAPPING ====================

function map790Row_(row) {
  return {
    caseNum: row.joa_case_number || '',
    caseKey: row.case_key || '',
    employer: row.employer_name || '',
    fein: row.fein || '',
    state: row.employer_state || '',
    address: row.address || '',
    contact: row.contact || '',
    phone: row.phone || '',
    contactEmail: row.contact_email || '',
    additionalEmail: row.additional_email || '',
    jobTitle: row.job_title || '',
    start: row.start_date || '',
    end: row.end_date || '',
    workers: row.workers ?? '',
    cert: row.cert_required || '',
    drive: row.drive_required || '',
    desc: row.job_description || '',
    syncedAt: row.synced_at || ''
  };
}


// ==================== FILTERS ====================

function getCurrent790Filters_() {
  return {
    caseNum: document.getElementById('filter790CaseNum').value.trim(),
    employer: document.getElementById('filter790Employer').value.trim(),
    state: document.getElementById('filter790State').value,
    email: document.getElementById('filter790Email').value.trim(),
    start: document.getElementById('filter790Start').value,
    end: document.getElementById('filter790End').value,
    limit: Number(document.getElementById('jobOrderLimit').value) || 25
  };
}


async function search790JobOrders_(filters) {
  const client = window.globalQuerySupabase;

  let query = client
    .from('gq_790')
    .select(`
      joa_case_number,
      case_key,
      employer_name,
      fein,
      employer_state,
      address,
      contact,
      phone,
      contact_email,
      additional_email,
      job_title,
      start_date,
      end_date,
      workers,
      cert_required,
      drive_required,
      job_description,
      synced_at
    `, { count: 'exact' });

  if (filters.caseNum) {
    query = query.ilike('joa_case_number', `%${filters.caseNum}%`);
  }

  if (filters.employer) {
    query = query.ilike('employer_name', `%${filters.employer}%`);
  }

  if (filters.state) {
    query = query.eq('employer_state', filters.state);
  }

  if (filters.email) {
    query = query.or(
      `contact_email.ilike.%${filters.email}%,additional_email.ilike.%${filters.email}%`
    );
  }

  if (filters.start) {
    query = query.gte('start_date', filters.start);
  }

  if (filters.end) {
    query = query.lte('start_date', filters.end);
  }

  query = query
    .order('start_date', { ascending: true })
    .order('joa_case_number', { ascending: false })
    .limit(filters.limit);

  const { data, error, count } = await query;

  if (error) throw error;

  return {
    rows: (data || []).map(map790Row_),
    matched: count ?? 0,
    returned: data?.length || 0
  };
}


// ==================== SEARCH ====================

async function apply790Filters() {
  const requestId = ++jobOrder790SearchRequest;
  const filters = getCurrent790Filters_();
  const startedAt = performance.now();

  set790Loading_(true);

  try {
    const result = await search790JobOrders_(filters);

    if (requestId !== jobOrder790SearchRequest) return;

    jobOrders790 = result.rows;
    render790JobOrders_(jobOrders790);

    const matched = Number(result.matched) || 0;
    const returned = Number(result.returned) || 0;

    document.getElementById('row790CountLabel').textContent = matched > returned
      ? `Showing ${returned.toLocaleString()} of ${matched.toLocaleString()} matching job orders`
      : `Showing ${returned.toLocaleString()} job order${returned === 1 ? '' : 's'}`;

    console.log('Supabase 790 search:', {
      roundTripMs: Math.round(performance.now() - startedAt),
      matched,
      returned
    });

  } catch (error) {
    if (requestId !== jobOrder790SearchRequest) return;

    console.error('790 search failed:', error);

    jobOrders790 = [];

    document.querySelector('#jobOrdersTable tbody').innerHTML =
      `<tr><td colspan="8" class="error-cell">${GlobalQueryUI.escapeHtml_(GlobalQueryUI.getErrorMessage_(error))}</td></tr>`;

    document.getElementById('row790CountLabel').textContent = 'Unable to load job orders';

  } finally {
    if (requestId === jobOrder790SearchRequest) {
      set790Loading_(false);
    }
  }
}


function set790Loading_(loading) {
  const applyButton = document.getElementById('apply790FiltersBtn');
  const clearButton = document.getElementById('clear790FiltersBtn');

  applyButton.disabled = loading;
  clearButton.disabled = loading;
  applyButton.textContent = loading ? 'Loading…' : '⌕ Search';

  if (loading) {
    document.querySelector('#jobOrdersTable tbody').innerHTML =
      '<tr><td colspan="8" class="muted">Loading job orders…</td></tr>';

    document.getElementById('row790CountLabel').textContent = 'Searching…';
  }
}


// ==================== RENDER ====================

function render790JobOrders_(rows = jobOrders790) {
  const body = document.querySelector('#jobOrdersTable tbody');

  body.innerHTML = rows.map(row => `
    <tr class="clickable" data-790-case="${GlobalQueryUI.escapeHtml_(row.caseNum)}">
      <td class="ellipsis" title="${GlobalQueryUI.escapeHtml_(row.caseNum || '')}">${GlobalQueryUI.escapeHtml_(row.caseNum || '—')}</td>
      <td class="ellipsis" title="${GlobalQueryUI.escapeHtml_(row.employer || '')}">
        ${row.fein
          ? `<button type="button" class="case-employer-link" data-790-employer-fein="${GlobalQueryUI.escapeHtml_(row.fein)}" title="View employer details">
              ${GlobalQueryUI.escapeHtml_(row.employer || '—')}
            </button>`
          : GlobalQueryUI.escapeHtml_(row.employer || '—')
        }
      </td>
      <td class="nowrap">${GlobalQueryUI.formatDate(row.start)} – ${GlobalQueryUI.formatDate(row.end)}</td>
      <td class="ellipsis" title="${GlobalQueryUI.escapeHtml_(row.jobTitle || '')}">${GlobalQueryUI.escapeHtml_(row.jobTitle || '—')}</td>
    </tr>
  `).join('') || '<tr><td colspan="4" class="muted">No matching job orders.</td></tr>';
}


// ==================== STATE DROPDOWN ====================

async function load790StateDropdown_() {
  const select = document.getElementById('filter790State');

  select.disabled = true;
  select.innerHTML = '<option value="">Loading states…</option>';

  try {
    const { data, error } = await window.globalQuerySupabase
      .from('gq_790')
      .select('employer_state')
      .not('employer_state', 'is', null)
      .order('employer_state');

    if (error) throw error;

    const states = [...new Set(
      (data || [])
        .map(row => String(row.employer_state || '').trim().toUpperCase())
        .filter(Boolean)
    )];

    select.innerHTML = '<option value="">All states</option>';

    states.forEach(state => {
      const option = document.createElement('option');
      option.value = state;
      option.textContent = state;
      select.appendChild(option);
    });

  } catch (error) {
    console.error('Could not load 790 states:', error);
    select.innerHTML = '<option value="">All states</option>';

  } finally {
    select.disabled = false;
  }
}

// ==================== Modal ====================

function open790Modal_(row) {
  if (!row) return;

  setCaseModalMode_('790');

  const modal = document.getElementById('detailModalOverlay');
  const businessInfo = document.getElementById('modalBusinessInfo');
  const jobInfo = document.getElementById('modalJobInfo');
  const jobDescription = document.getElementById('modalJobDesc');
  const employerSubtitle = document.getElementById('detailModalEmployer');

  document.getElementById('detailModalTitle').textContent = row.caseNum || '790 Job Order';
 
  if (row.fein) {
    employerSubtitle.innerHTML = `
      <button
        type="button"
        class="modal-employer-link"
        data-790-employer-fein="${GlobalQueryUI.escapeHtml_(row.fein)}"
        title="View employer details"
      >
        ${GlobalQueryUI.escapeHtml_(row.employer || '—')}
      </button>
    `;
  } else {
    employerSubtitle.textContent = row.employer || '—';
  }

  businessInfo.innerHTML = '';
  jobInfo.innerHTML = '';
  jobDescription.textContent = '';

  GlobalQueryUI.appendKv(businessInfo, [
    ['Address', GlobalQueryUI.escapeHtml_(cleanGlobalQueryText_(row.address) || '—')],
    ['FEIN', GlobalQueryUI.escapeHtml_(row.fein || '—')],
    ['Contact', GlobalQueryUI.escapeHtml_(cleanGlobalQueryText_(row.contact) || '—')],
    ['Phone', GlobalQueryUI.escapeHtml_(row.phone || '—')],
    ['Contact Email', GlobalQueryUI.escapeHtml_(row.contactEmail || '—')],
    ['Additional Email', GlobalQueryUI.escapeHtml_(row.additionalEmail || '—')]
  ]);

  GlobalQueryUI.appendKv(jobInfo, [
    ['Job Title', GlobalQueryUI.escapeHtml_(row.jobTitle || '—')],
    ['Period of Need', `${GlobalQueryUI.formatDate(row.start)} – ${GlobalQueryUI.formatDate(row.end)}`],
    ['Workers', GlobalQueryUI.escapeHtml_(row.workers ?? '—')],
    ['Cert Req', GlobalQueryUI.escapeHtml_(row.cert || '—')],
    ['Drive Req', GlobalQueryUI.escapeHtml_(row.drive || '—')],
    ['State', GlobalQueryUI.escapeHtml_(row.state || '—')]
  ]);

  jobDescription.textContent = row.desc || '—';

  modal.classList.remove('hidden');
}

async function open790Employer_(fein) {
  if (!fein) {
    alert('This employer does not have a FEIN available for lookup.');
    return;
  }

  try {
    await window.openEmployerDetail(fein);
  } catch (error) {
    console.error('Could not open employer detail:', error);
    alert('GlobalQuery could not load this employer right now. Please try again.');
  }
}

// ==================== EVENTS ====================

function bind790Events_() {
  document.getElementById('apply790FiltersBtn').addEventListener('click', apply790Filters);

  document.getElementById('clear790FiltersBtn').addEventListener('click', () => {
    [
      'filter790CaseNum',
      'filter790Employer',
      'filter790State',
      'filter790Email',
      'filter790Start',
      'filter790End'
    ].forEach(id => {
      document.getElementById(id).value = '';
    });

    apply790Filters();
  });

  document.getElementById('jobOrderLimit').addEventListener('change', apply790Filters);

  [
    'filter790CaseNum',
    'filter790Employer',
    'filter790Email',
    'filter790Start',
    'filter790End'
  ].forEach(id => {
    document.getElementById(id).addEventListener('keydown', event => {
      if (event.key !== 'Enter') return;

      event.preventDefault();
      apply790Filters();
    });
  });

  document.querySelector('#jobOrdersTable tbody').addEventListener('click', event => {
    const row = event.target.closest('tr[data-790-case]');
    if (!row) return;

    const jobOrder = jobOrders790.find(item => item.caseNum === row.dataset['790Case']);
    open790Modal_(jobOrder);
  });

  document.querySelector('#jobOrdersTable tbody').addEventListener('click', async event => {
    const employerLink = event.target.closest('[data-790-employer-fein]');

    if (employerLink) {
      event.stopPropagation();

      await open790Employer_(employerLink.dataset['790EmployerFein']);
      return;
    }

    const row = event.target.closest('tr[data-job-order]');
    if (!row) return;

    open790Modal_(
      jobOrders790.find(item => item.caseNum === row.dataset.jobOrder)
    );
  });

  document.getElementById('detailModalEmployer').addEventListener('click', async event => {
    const employerLink = event.target.closest('[data-790-employer-fein]');
    if (!employerLink) return;

    await open790Employer_(employerLink.dataset['790EmployerFein']);
  });
}




// ==================== INITIALIZATION ====================

async function initialize790() {
  if (jobOrders790Initialized) return;
  jobOrders790Initialized = true;

  bind790Events_();

  await Promise.all([
    apply790Filters(),
    load790StateDropdown_()
  ]).catch(error => {
    console.error('Could not finish initializing 790 data:', error);
  });
}


// Load the snapshot only when the user first opens the 790 tab.
document
  .querySelector('.tab-btn[data-tab="jobOrdersTab"]')
  ?.addEventListener('click', initialize790);


window.initialize790 = initialize790;
window.apply790Filters = apply790Filters;
