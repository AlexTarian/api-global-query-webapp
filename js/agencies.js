let globalQueryAgenciesLoaded = false;
let globalQueryAgencyRows = [];

async function loadGlobalQueryAgencies() {
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
        prior_count,
        earlier_count,
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

function renderAgencyLeaderboard() {
  const table = document.getElementById('agenciesTable');
  const headers = table.querySelectorAll('thead th');
  const tableBody = table.querySelector('tbody');
  const rows = globalQueryAgencyRows;

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

  tableBody.innerHTML = rows.map(row => {
    const currentCount = Number(row.current_count) || 0;
    const priorCount = Number(row.prior_count) || 0;
    const earlierCount = Number(row.earlier_count) || 0;
    const changeCount = Number(row.change_count) || 0;

    const changePercent = row.change_percent === null || row.change_percent === undefined || row.change_percent === ''
      ? null
      : Number(row.change_percent);

    const churnRate = row.churn_rate === null || row.churn_rate === undefined || row.churn_rate === ''
      ? null
      : Number(row.churn_rate);

    const previousEmployers = Number(row.previous_employers) || 0;
    const lostEmployers = Number(row.lost_employers) || 0;

    const changeClass = changeCount > 0 ? 'positive' : changeCount < 0 ? 'negative' : '';

    const percentageText = changePercent === null
      ? priorCount > 0 && earlierCount === 0 ? 'New' : '—'
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
        <td class="center">${currentCount.toLocaleString()}</td>
        <td class="center" title="${GlobalQueryUI.escapeHtml_(churnTooltip)}"><span class="${churnClass}"><strong>${churnText}</strong></span></td>
        <td class="center">${priorCount.toLocaleString()}</td>
        <td class="center">${earlierCount.toLocaleString()}</td>
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

window.loadGlobalQueryAgencies = loadGlobalQueryAgencies;
window.renderAgencyLeaderboard = renderAgencyLeaderboard;
window.refreshGlobalQueryAgencies = refreshGlobalQueryAgencies;
