let globalQueryAgenciesLoaded = false;
let globalQueryAgencyRows = [];
let selectedAgencyId = null;
let globalQueryAgencyProfiles = new Map();
let agencyMetricMode = 'cases';
let agencyControlsBound = false;
let agencySort = {
  key: 'current',
  direction: 'desc'
};

async function loadAgencyProfiles_() {
  const { data, error } = await window.globalQuerySupabase
    .from('agencies')
    .select(`
      agency_id,
      agent_fein,
      normalized_name,
      display_name,
      contact_first_name,
      contact_last_name,
      address,
      state,
      phone,
      email
    `);

  if (error) throw error;

  globalQueryAgencyProfiles = new Map(
    (data || []).map(row => [String(row.agency_id), row])
  );
}

async function loadGlobalQueryAgencies() {
  if (!agencyControlsBound) {
    bindAgencyLeaderboardControls_();
    agencyControlsBound = true;
  }
  if (globalQueryAgenciesLoaded) {
    renderAgencyLeaderboard();
    return;
  }

  const tableBody = document.querySelector('#agenciesTable tbody');
  tableBody.innerHTML = '<tr><td colspan="6" class="center muted">Loading agency data...</td></tr>';

  try {
    const { data, error } = await window.globalQuerySupabase
      .from('agency_leaderboard')
      .select(`
        agency_id,
        normalized_name,
        display_name,
        analysis_year,
        current_count,
        current_employers,
        current_workers,
        prior_count,
        prior_employers,
        prior_workers,
        earlier_count,
        earlier_employers,
        earlier_workers,
        change_count,
        change_percent,
        previous_employers,
        retained_employers,
        lost_employers,
        churn_rate,
        refreshed_at
      `)
      .order('current_count', { ascending: false })
      .order('prior_count', { ascending: false })
      .order('earlier_count', { ascending: false })
      .order('display_name', { ascending: true });

    if (error) throw error;

    globalQueryAgencyRows = Array.isArray(data) ? data : [];
    await loadAgencyProfiles_();
    populateAgencyJumpOptions_();
    globalQueryAgenciesLoaded = true;
    renderAgencyLeaderboard();
  } catch (error) {
    console.error('Agency leaderboard error:', error);
    tableBody.innerHTML = `<tr><td colspan="6" class="center error-cell">${GlobalQueryUI.escapeHtml_(GlobalQueryUI.getErrorMessage_(error))}</td></tr>`;
  }
}

function populateAgencyJumpOptions_() {
  const datalist = document.getElementById('agencyJumpOptions');

  datalist.innerHTML = globalQueryAgencyRows
    .map(row => row.display_name || row.normalized_name)
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b))
    .map(name => `<option value="${GlobalQueryUI.escapeHtml_(name)}"></option>`)
    .join('');
}

function getAgencyMetricFields_() {
  switch (agencyMetricMode) {
    case 'employers':
      return {
        current: 'current_employers',
        prior: 'prior_employers',
        earlier: 'earlier_employers'
      };

    case 'workers':
      return {
        current: 'current_workers',
        prior: 'prior_workers',
        earlier: 'earlier_workers'
      };

    default:
      return {
        current: 'current_count',
        prior: 'prior_count',
        earlier: 'earlier_count'
      };
  }
}

function jumpToAgency_(searchValue) {
  const search = String(searchValue || '').trim().toLowerCase();
  if (!search) return;

  const agency = globalQueryAgencyRows.find(row => {
    const displayName = String(row.display_name || '').trim().toLowerCase();
    const normalizedName = String(row.normalized_name || '').trim().toLowerCase();

    return displayName === search || normalizedName === search;
  });

  if (!agency) return;

  selectAgency_(agency.agency_id);

  const row = document.querySelector(
    `#agenciesTable tbody tr[data-agency-id="${agency.agency_id}"]`
  );

  if (!row) return;

  row.scrollIntoView({
    behavior: 'smooth',
    block: 'center'
  });

  row.classList.remove('agency-jump-highlight');

  // Forces a restart if the same agency is searched twice.
  void row.offsetWidth;

  row.classList.add('agency-jump-highlight');

  setTimeout(() => {
    row.classList.remove('agency-jump-highlight');
  }, 1800);
}

function selectAgency_(agencyId) {
  const id = String(agencyId || '');
  if (!id) return;

  const leaderboardRow = globalQueryAgencyRows.find(
    row => String(row.agency_id) === id
  );

  if (!leaderboardRow) return;

  selectedAgencyId = id;

  renderAgencyLeaderboard();
  renderAgencyDetail_(leaderboardRow);
}

function getAgencySortKey_(sortKey) {
  const fields = getAgencyMetricFields_();

  switch (sortKey) {
    case 'current': return fields.current;
    case 'prior': return fields.prior;
    case 'earlier': return fields.earlier;
    default: return sortKey;
  }
}

function renderAgencyLeaderboard() {
  const table = document.getElementById('agenciesTable');
  const headers = table.querySelectorAll('thead th');
  const tableBody = table.querySelector('tbody');
  const rows = [...globalQueryAgencyRows].sort((a, b) => {
    const sortKey = getAgencySortKey_(agencySort.key);

    let aValue;
    let bValue;

    if (agencySort.key === 'change') {
      const fields = getAgencyMetricFields_();

      const aEarlier = Number(a[fields.earlier]) || 0;
      const aPrior = Number(a[fields.prior]) || 0;
      const bEarlier = Number(b[fields.earlier]) || 0;
      const bPrior = Number(b[fields.prior]) || 0;

      aValue = aEarlier > 0 ? (aPrior - aEarlier) / aEarlier : null;
      bValue = bEarlier > 0 ? (bPrior - bEarlier) / bEarlier : null;
    } else {
      aValue = a[sortKey];
      bValue = b[sortKey];
    }

    if (typeof aValue === 'string' || typeof bValue === 'string') {
      const result = String(aValue || '').localeCompare(String(bValue || ''));
      return agencySort.direction === 'asc' ? result : -result;
    }

    const result = (Number(aValue) || 0) - (Number(bValue) || 0);
    return agencySort.direction === 'asc' ? result : -result;
  });

  if (!rows.length) {
    tableBody.innerHTML = '<tr><td colspan="6" class="center muted">No agency data was found.</td></tr>';
    return;
  }

  if (
    !selectedAgencyId ||
    !rows.some(row => String(row.agency_id) === String(selectedAgencyId))
  ) {
    selectedAgencyId = String(rows[0].agency_id);
  }

  const analysisYear = Number(rows[0].analysis_year) || 0;
  headers[1].textContent = analysisYear || 'Current';
  headers[2].textContent = 'Chrn';
  headers[3].textContent = analysisYear ? analysisYear - 1 : 'Prior';
  headers[4].textContent = analysisYear ? analysisYear - 2 : 'Earlier';
  headers[5].textContent = 'Change';

  headers.forEach(header => {
    header.classList.remove('sort-asc', 'sort-desc');

    if (header.dataset.sort === agencySort.key) {
      header.classList.add(
        agencySort.direction === 'asc' ? 'sort-asc' : 'sort-desc'
      );
    }
  });

  const fields = getAgencyMetricFields_();

  tableBody.innerHTML = rows.map(row => {
    const selectedRow = rows.find(
      row => String(row.agency_id) === String(selectedAgencyId)
    );

    if (selectedRow) {
      renderAgencyDetail_(selectedRow);
    }
    const currentValue = Number(row[fields.current]) || 0;
    const priorValue = Number(row[fields.prior]) || 0;
    const earlierValue = Number(row[fields.earlier]) || 0;
    const changeCount = priorValue - earlierValue;

    const changePercent = earlierValue > 0
      ? ((priorValue - earlierValue) / earlierValue) * 100
      : null;

    const churnRate = row.churn_rate === null || row.churn_rate === undefined || row.churn_rate === ''
      ? null
      : Number(row.churn_rate);

    const previousEmployers = Number(row.previous_employers) || 0;
    const lostEmployers = Number(row.lost_employers) || 0;

    const changeClass = changeCount > 0 ? 'positive' : changeCount < 0 ? 'negative' : '';

    const percentageText = changePercent === null
      ? priorValue > 0 && earlierValue === 0 ? 'New' : '—'
      : `${changePercent > 0 ? '+' : ''}${changePercent.toFixed(1)}%`;

    const validChurnRate = churnRate !== null && Number.isFinite(churnRate);
    const churnPercent = validChurnRate ? churnRate * 100 : null;
    const churnText = validChurnRate ? `${churnPercent.toFixed(1)}%` : '—';
    const churnTooltip = validChurnRate
      ? `${lostEmployers.toLocaleString()}/${previousEmployers.toLocaleString()} employers lost.`
      : 'No prior-year employers.';

    const churnClass = !validChurnRate
      ? 'muted'
      : churnPercent < 10
        ? 'churn-low'
        : churnPercent < 20
          ? 'churn-moderate'
          : churnPercent < 30
            ? 'churn-high'
            : 'churn-severe';

    const displayName = row.display_name || row.normalized_name || '—';

    return `
      <tr data-agency-id="${row.agency_id}" class="${String(row.agency_id) === String(selectedAgencyId) ? 'selected-agency' : ''}">
        <td class="ellipsis agency-column" title="${GlobalQueryUI.escapeHtml_(displayName)}">${GlobalQueryUI.escapeHtml_(displayName)}</td>
        <td class="center">${currentValue.toLocaleString()}</td>
        <td class="center" title="${GlobalQueryUI.escapeHtml_(churnTooltip)}"><span class="${churnClass}"><strong>${churnText}</strong></span></td>
        <td class="center">${priorValue.toLocaleString()}</td>
        <td class="center">${earlierValue.toLocaleString()}</td>
        <td class="center ${changeClass}">${percentageText}</td>
      </tr>
    `;
  }).join('');
}

function renderAgencyDetail_(leaderboardRow) {
  const nameElement = document.getElementById('agencyDetailName');
  const content = document.getElementById('agencyDetailContent');

  if (!nameElement || !content) return;

  if (!leaderboardRow) {
    nameElement.textContent = '—';
    content.innerHTML =
      '<div class="muted">Select an agency to view its details.</div>';
    return;
  }

  const profile = globalQueryAgencyProfiles.get(
    String(leaderboardRow.agency_id)
  ) || {};

  const displayName =
    profile.display_name ||
    leaderboardRow.display_name ||
    leaderboardRow.normalized_name ||
    '—';

  const contactName = [
    profile.contact_first_name,
    profile.contact_last_name
  ].filter(Boolean).join(' ');

  const year = Number(leaderboardRow.analysis_year) || 0;

  const currentCases = Number(leaderboardRow.current_count) || 0;
  const currentEmployers = Number(leaderboardRow.current_employers) || 0;
  const currentWorkers = Number(leaderboardRow.current_workers) || 0;

  const priorCases = Number(leaderboardRow.prior_count) || 0;
  const priorEmployers = Number(leaderboardRow.prior_employers) || 0;
  const priorWorkers = Number(leaderboardRow.prior_workers) || 0;

  const earlierCases = Number(leaderboardRow.earlier_count) || 0;
  const earlierEmployers = Number(leaderboardRow.earlier_employers) || 0;
  const earlierWorkers = Number(leaderboardRow.earlier_workers) || 0;

  const churnRate =
    leaderboardRow.churn_rate === null ||
    leaderboardRow.churn_rate === undefined ||
    leaderboardRow.churn_rate === ''
      ? null
      : Number(leaderboardRow.churn_rate);

  const churnText =
    churnRate !== null && Number.isFinite(churnRate)
      ? `${(churnRate * 100).toFixed(1)}%`
      : '—';

  nameElement.textContent = displayName;

  content.innerHTML = `
    <div class="agency-detail-grid">

      <div class="agency-profile-section">
        <div class="agency-detail-row">
          <span class="muted">Contact</span>
          <strong>${GlobalQueryUI.escapeHtml_(contactName || '—')}</strong>
        </div>

        <div class="agency-detail-row">
          <span class="muted">FEIN</span>
          <strong>${GlobalQueryUI.escapeHtml_(profile.agent_fein || '—')}</strong>
        </div>

        <div class="agency-detail-row">
          <span class="muted">Address</span>
          <strong>${GlobalQueryUI.escapeHtml_(profile.address || '—')}</strong>
        </div>

        <div class="agency-detail-row">
          <span class="muted">Phone</span>
          <strong>${GlobalQueryUI.escapeHtml_(profile.phone || '—')}</strong>
        </div>

        <div class="agency-detail-row">
          <span class="muted">Email</span>
          <strong>${GlobalQueryUI.escapeHtml_(profile.email || '—')}</strong>
        </div>
      </div>

      <div class="agency-performance-section">
        <div class="agency-year-grid">

          <div class="agency-year-card">
            <span class="muted">${year || 'Current'}</span>
            <strong>${currentCases.toLocaleString()} cases</strong>
            <span>${currentEmployers.toLocaleString()} employers</span>
            <span>${currentWorkers.toLocaleString()} workers</span>
          </div>

          <div class="agency-year-card">
            <span class="muted">${year ? year - 1 : 'Prior'}</span>
            <strong>${priorCases.toLocaleString()} cases</strong>
            <span>${priorEmployers.toLocaleString()} employers</span>
            <span>${priorWorkers.toLocaleString()} workers</span>
          </div>

          <div class="agency-year-card">
            <span class="muted">${year ? year - 2 : 'Earlier'}</span>
            <strong>${earlierCases.toLocaleString()} cases</strong>
            <span>${earlierEmployers.toLocaleString()} employers</span>
            <span>${earlierWorkers.toLocaleString()} workers</span>
          </div>

        </div>

        <div class="agency-summary-metrics">
          <div class="agency-detail-metric">
            <span class="muted">Employer Churn</span>
            <strong>${churnText}</strong>
          </div>
        </div>
      </div>

    </div>
  `;
}

function refreshGlobalQueryAgencies() {
  globalQueryAgenciesLoaded = false;
  globalQueryAgencyRows = [];
  return loadGlobalQueryAgencies();
}

function bindAgencyLeaderboardControls_() {
  document.querySelectorAll('input[name="agencyMetric"]').forEach(input => {
    input.addEventListener('change', event => {
      agencyMetricMode = event.target.value;

      agencySort = {
        key: 'current',
        direction: 'desc'
      };

      renderAgencyLeaderboard();
    });
  });
  document.querySelectorAll('#agenciesTable th[data-sort]').forEach(header => {
    header.addEventListener('click', () => {
      const key = header.dataset.sort;

      if (agencySort.key === key) {
        agencySort.direction = agencySort.direction === 'asc' ? 'desc' : 'asc';
      } else {
        agencySort.key = key;
        agencySort.direction = key === 'display_name' ? 'asc' : 'desc';
      }

      renderAgencyLeaderboard();
    });
  });
  document.querySelector('#agenciesTable tbody').addEventListener('click', event => {
    const row = event.target.closest('tr[data-agency-id]');
    if (!row) return;

    selectAgency_(row.dataset.agencyId);
  });
  const agencySearch = document.getElementById('agencyJumpSearch');

  agencySearch.addEventListener('change', () => {
    jumpToAgency_(agencySearch.value);
  });

  agencySearch.addEventListener('keydown', event => {
    if (event.key === 'Enter') {
      event.preventDefault();
      jumpToAgency_(agencySearch.value);
    }
  });
}

window.loadGlobalQueryAgencies = loadGlobalQueryAgencies;
window.renderAgencyLeaderboard = renderAgencyLeaderboard;
window.refreshGlobalQueryAgencies = refreshGlobalQueryAgencies;
