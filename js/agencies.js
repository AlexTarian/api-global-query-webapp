let globalQueryAgenciesLoaded = false;
let globalQueryAgencyRows = [];
let agencyMetricMode = 'cases';
let agencyControlsBound = false;
let agencySort = {
  key: 'current_count',
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
    globalQueryAgenciesLoaded = true;
    renderAgencyLeaderboard();
  } catch (error) {
    console.error('Agency leaderboard error:', error);
    tableBody.innerHTML = `<tr><td colspan="6" class="center error-cell">${GlobalQueryUI.escapeHtml_(GlobalQueryUI.getErrorMessage_(error))}</td></tr>`;
  }
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

function renderAgencyLeaderboard() {
  const table = document.getElementById('agenciesTable');
  const headers = table.querySelectorAll('thead th');
  const tableBody = table.querySelector('tbody');
  const rows = [...globalQueryAgencyRows].sort((a, b) => {
    const aValue = a[agencySort.key];
    const bValue = b[agencySort.key];

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
      <tr>
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
        key: fields.current,
        direction: 'desc'
      };

      renderAgencyLeaderboard();
    });
  });
}

window.loadGlobalQueryAgencies = loadGlobalQueryAgencies;
window.renderAgencyLeaderboard = renderAgencyLeaderboard;
window.refreshGlobalQueryAgencies = refreshGlobalQueryAgencies;
