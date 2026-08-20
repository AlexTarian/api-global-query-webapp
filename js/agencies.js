let globalQueryAgenciesLoaded = false;
let globalQueryAgencyRows = [];
let agencyMetricMode = 'cases';
let agencyControlsBound = false;
let agencySort = {
  key: 'current',
  direction: 'desc'
};

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
      <tr data-agency-id="${row.agency_id}">
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

function refreshGlobalQueryAgencies() {
  globalQueryAgenciesLoaded = false;
  globalQueryAgencyRows = [];
  return loadGlobalQueryAgencies();
}

function bindAgencyLeaderboardControls_() {
  document.querySelectorAll('input[name="agencyMetric"]').forEach(input => {
    input.addEventListener('change', event => {
      agencyMetricMode = event.target.value;

      const fields = getAgencyMetricFields_();

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
