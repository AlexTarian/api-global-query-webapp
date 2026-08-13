console.log('churn.js loaded');

let churn = [];
let globalQueryChurnLoaded = false;
let churnInitialized = false;

function splitAgencyNames_(value) {
  return String(value || '').split('|').map(name => name.trim()).filter(Boolean);
}

function agencyFieldIncludes_(value, agency) {
  return Boolean(agency) && splitAgencyNames_(value).includes(agency);
}

function iconFor(type) {
  switch (type) {
    case 'gain': return '▲';
    case 'loss': return '▼';
    case 'switch': return '➤';
    default: return '•';
  }
}

function agencyNamesFromLinks_(links) {
  const safeLinks = Array.isArray(links) ? links : [];
  const agencies = safeLinks.map(item => item?.agencies).filter(Boolean);

  return {
    keys: agencies.map(item => item.normalized_name).filter(Boolean),
    display: agencies.map(item => item.display_name || item.normalized_name).filter(Boolean)
  };
}

function mapChurnRow_(row) {
  const prior = agencyNamesFromLinks_(row.churn_prior_agencies);
  const current = agencyNamesFromLinks_(row.churn_current_agencies);

  const priorAgency = prior.keys.length ? prior.keys.join(' | ') : String(row.prior_agency_key || '').trim();
  const currentAgency = current.keys.length ? current.keys.join(' | ') : String(row.current_agency_key || '').trim();

  const priorAgencyDisplay = prior.display.length ? prior.display.join(' | ') : priorAgency;
  const currentAgencyDisplay = current.display.length ? current.display.join(' | ') : currentAgency;

  const classification = String(row.classification || '').trim().toUpperCase();
  let type = '';
  let details = '';

  if (classification === 'SWITCHER') {
    type = 'switch';
    details = `${priorAgencyDisplay || 'Unknown'} → ${currentAgencyDisplay || 'Unknown'}`;
  } else if (classification === 'NEW_BUSINESS') {
    type = 'gain';
    details = currentAgencyDisplay ? `New Employer — ${currentAgencyDisplay}` : 'New Employer';
  } else if (classification === 'LOST_BUSINESS') {
    type = 'loss';
    details = priorAgencyDisplay ? `No Case Filed — ${priorAgencyDisplay}` : 'No Case Filed';
  } else if (classification === 'SELF_FILED') {
    type = 'loss';
    details = priorAgencyDisplay ? `Now Self-Filed — ${priorAgencyDisplay}` : 'Now Self-Filed';
  }

  return {
    churnId: row.churn_id,
    fein: row.fein || '',
    employer: row.employer_name || '',
    seriesKey: row.series_key || '',
    currentCase: row.current_case_num || '',
    priorCase: row.prior_case_num || '',
    currentAgency,
    currentAgencyDisplay,
    priorAgency,
    priorAgencyDisplay,
    classification,
    detected: row.detected_at || '',
    type,
    details
  };
}

async function loadGlobalQueryChurn() {
  console.log('loadGlobalQueryChurn started');
  
  if (globalQueryChurnLoaded) {
    renderAgencyChurn();
    renderRecentChurn();
    return;
  }

  setChurnLoading_(true);

  try {
    const [churnResult, agencyResult] = await Promise.all([
      window.globalQuerySupabase
        .from('churn')
        .select(`
          churn_id,
          fein,
          employer_name,
          series_key,
          current_case_num,
          prior_case_num,
          classification,
          detected_at,
          current_agency_key,
          prior_agency_key,
          churn_current_agencies(agencies(normalized_name,display_name)),
          churn_prior_agencies(agencies(normalized_name,display_name))
        `)
        .order('detected_at', { ascending: false })
        .order('churn_id', { ascending: false }),

      window.globalQuerySupabase
        .from('agencies')
        .select('normalized_name,display_name')
        .order('display_name', { ascending: true })
    ]);

    if (churnResult.error) throw churnResult.error;
    if (agencyResult.error) throw agencyResult.error;

    churn = (churnResult.data || []).map(mapChurnRow_).filter(item => item.type);
    populateChurnAgencyDropdown_(agencyResult.data || []);

    globalQueryChurnLoaded = true;
    setChurnLoading_(false);
    renderAgencyChurn();
    renderRecentChurn();
  } catch (error) {
    console.error('Could not load churn data:', error);
    churn = [];
    globalQueryChurnLoaded = false;
    setChurnLoading_(false);
    showChurnLoadError_(error);
  }
}

function setChurnLoading_(loading) {
  const select = document.getElementById('churnAgencySelect');

  if (select) {
    select.disabled = loading;
    if (loading) select.innerHTML = '<option value="">Loading churn data…</option>';
  }

  if (!loading) return;

  document.getElementById('gainMetric').textContent = '—';
  document.getElementById('lossMetric').textContent = '—';
  document.getElementById('netMetric').textContent = '—';
  document.getElementById('activityMetric').textContent = '—';

  document.querySelector('#agencyChurnTable tbody').innerHTML = '<tr><td colspan="4" class="center muted">Loading churn data…</td></tr>';
  document.querySelector('#recentChurnTable tbody').innerHTML = '<tr><td colspan="4" class="center muted">Loading churn data…</td></tr>';
}

function showChurnLoadError_(error) {
  const message = GlobalQueryUI.escapeHtml_(GlobalQueryUI.getErrorMessage_(error));

  document.querySelector('#agencyChurnTable tbody').innerHTML = `<tr><td colspan="4" class="center error-cell">${message}</td></tr>`;
  document.querySelector('#recentChurnTable tbody').innerHTML = `<tr><td colspan="4" class="center error-cell">${message}</td></tr>`;

  document.getElementById('gainMetric').textContent = '0';
  document.getElementById('lossMetric').textContent = '0';
  document.getElementById('netMetric').textContent = '0';
  document.getElementById('activityMetric').textContent = '0';
}

function populateChurnAgencyDropdown_(agencies) {
  const select = document.getElementById('churnAgencySelect');
  const safeAgencies = Array.isArray(agencies) ? agencies : [];
  const savedAgency = localStorage.getItem('globalQueryChurnAgency');

  select.innerHTML = '';

  safeAgencies.forEach(agency => {
    const option = document.createElement('option');
    option.value = agency.normalized_name;
    option.textContent = agency.display_name || agency.normalized_name;
    select.appendChild(option);
  });

  if (!safeAgencies.length) {
    select.innerHTML = '<option value="">No agencies found</option>';
    select.disabled = true;
    return;
  }

  const hasOption = value => [...select.options].some(option => option.value === value);
  const selectedAgency = savedAgency && hasOption(savedAgency)
    ? savedAgency
    : hasOption(GLOBALQUERY_OUR_AGENCY)
      ? GLOBALQUERY_OUR_AGENCY
      : '';

  if (selectedAgency) select.value = selectedAgency;
  select.disabled = false;
}

function renderAgencyChurn() {
  const select = document.getElementById('churnAgencySelect');
  const selected = select ? select.value : '';

  if (!selected) {
    document.getElementById('gainMetric').textContent = '0';
    document.getElementById('lossMetric').textContent = '0';
    document.getElementById('netMetric').textContent = '0';
    document.getElementById('activityMetric').textContent = '0';
    document.querySelector('#agencyChurnTable tbody').innerHTML = '<tr><td colspan="4" class="muted">Select an agency to review its churn activity.</td></tr>';
    return;
  }

  localStorage.setItem('globalQueryChurnAgency', selected);

  const interpreted = churn.map(item => {
    const wasPriorAgency = agencyFieldIncludes_(item.priorAgency, selected);
    const isCurrentAgency = agencyFieldIncludes_(item.currentAgency, selected);
    let type = '';
    let filterType = '';
    let details = '';

    if (item.classification === 'SWITCHER') {
      if (isCurrentAgency && !wasPriorAgency) {
        type = 'gain';
        filterType = 'switch';
        details = item.priorAgencyDisplay ? `From ${item.priorAgencyDisplay}` : 'Gained employer';
      } else if (wasPriorAgency && !isCurrentAgency) {
        type = 'loss';
        filterType = 'switch';
        details = item.currentAgencyDisplay ? `To ${item.currentAgencyDisplay}` : 'Lost employer';
      } else {
        return null;
      }
    } else if (item.classification === 'NEW_BUSINESS' && isCurrentAgency) {
      type = 'gain';
      filterType = 'gain';
      details = 'New Employer';
    } else if (item.classification === 'LOST_BUSINESS' && wasPriorAgency) {
      type = 'loss';
      filterType = 'loss';
      details = 'No Case Filed';
    } else if (item.classification === 'SELF_FILED' && wasPriorAgency) {
      type = 'loss';
      filterType = 'loss';
      details = 'Now Self-Filed';
    } else {
      return null;
    }

    return { ...item, type, filterType, details };
  }).filter(Boolean);

  const gains = interpreted.filter(item => item.type === 'gain').length;
  const losses = interpreted.filter(item => item.type === 'loss').length;
  const net = gains - losses;

  document.getElementById('gainMetric').textContent = gains;
  document.getElementById('lossMetric').textContent = losses;
  document.getElementById('netMetric').textContent = `${net >= 0 ? '+' : ''}${net}`;
  document.getElementById('activityMetric').textContent = interpreted.length;

  const allowed = {
    gain: document.getElementById('showAgencyGains').checked,
    loss: document.getElementById('showAgencyLosses').checked,
    switch: document.getElementById('showAgencySwitches').checked
  };

  const visibleRows = interpreted.filter(item => Boolean(allowed[item.filterType]));
  const body = document.querySelector('#agencyChurnTable tbody');

  body.innerHTML = visibleRows.map(item => `
    <tr class="clickable churn-row ${item.type}">
      <td><span class="type-icon ${item.type}" title="${GlobalQueryUI.escapeHtml_(item.type)}">${iconFor(item.type)}</span></td>
      <td><strong>${GlobalQueryUI.escapeHtml_(item.employer || '—')}</strong></td>
      <td>${GlobalQueryUI.escapeHtml_(item.details || '—')}</td>
      <td>${GlobalQueryUI.escapeHtml_(GlobalQueryUI.formatDate(item.detected))}</td>
    </tr>
  `).join('') || '<tr><td colspan="4" class="muted">No churn records match the selected filters.</td></tr>';

  body.querySelectorAll('tr.clickable').forEach((row, index) => row.addEventListener('click', () => openChurnModal(visibleRows[index])));
}

function renderRecentChurn() {
  const query = document.getElementById('recentChurnSearch').value.trim().toLowerCase();
  const allowed = {
    gain: document.getElementById('showGains').checked,
    loss: document.getElementById('showLosses').checked,
    switch: document.getElementById('showSwitches').checked
  };

  const rows = churn.filter(item => {
    const searchableText = [
      item.employer,
      item.priorAgency,
      item.priorAgencyDisplay,
      item.currentAgency,
      item.currentAgencyDisplay,
      item.details,
      item.classification,
      item.priorCase,
      item.currentCase
    ].filter(Boolean).join(' ').toLowerCase();

    return Boolean(allowed[item.type]) && (!query || searchableText.includes(query));
  });

  const body = document.querySelector('#recentChurnTable tbody');

  body.innerHTML = rows.map(item => `
    <tr class="clickable churn-row ${item.type}">
      <td><span class="type-icon ${item.type}" title="${GlobalQueryUI.escapeHtml_(item.type)}">${iconFor(item.type)}</span></td>
      <td><strong>${GlobalQueryUI.escapeHtml_(item.employer || '—')}</strong></td>
      <td>${GlobalQueryUI.escapeHtml_(item.details || '—')}</td>
      <td>${GlobalQueryUI.escapeHtml_(GlobalQueryUI.formatDate(item.detected))}</td>
    </tr>
  `).join('') || '<tr><td colspan="4" class="muted">No matching churn records.</td></tr>';

  body.querySelectorAll('tr.clickable').forEach((row, index) => row.addEventListener('click', () => openChurnModal(rows[index])));
}

async function getCaseForChurnModal_(item) {
  const caseNum = item.currentCase || item.priorCase;
  if (!caseNum) return null;

  const existingCase = cases.find(row => row.caseNum === caseNum);
  if (existingCase) return existingCase;

  const { data, error } = await window.globalQuerySupabase
    .from('cases')
    .select(caseSelect_(false))
    .eq('case_num', caseNum)
    .maybeSingle();

  if (error) {
    console.error('Could not load churn case details:', error);
    return null;
  }

  return data ? mapCaseRow_(data) : null;
}

async function openChurnModal(item) {
  let caseRow = await getCaseForChurnModal_(item);

  if (!caseRow) {
    caseRow = {
      caseNum: item.currentCase || item.priorCase || '',
      employer: item.employer || '—',
      address: '—',
      contact: '—',
      phone: '—',
      email: '—',
      start: '',
      end: '',
      workers: '—',
      h2alc: null,
      cert: null,
      drive: null,
      multiWorksites: null,
      multiHousing: null,
      agency: item.currentAgency || item.priorAgency || '',
      displayAgency: item.currentAgencyDisplay || item.priorAgencyDisplay || '',
      desc: ''
    };
  }

  openCaseModal(caseRow, 'churn');

  const banner = document.getElementById('churnBanner');
  banner.className = `churn-banner ${item.type}`;
  banner.innerHTML = `<strong>${iconFor(item.type)} ${item.type === 'gain' ? 'Gain' : item.type === 'loss' ? 'Loss' : 'Switch'}</strong><br>${GlobalQueryUI.escapeHtml_(item.details || '')}`;

  document.getElementById('modalChurnInfoPanel').classList.remove('hidden');

  GlobalQueryUI.appendKv(document.getElementById('modalChurnInfo'), [
    ['Classification', GlobalQueryUI.escapeHtml_(item.classification || '—')],
    ['Previous Agency', GlobalQueryUI.escapeHtml_(item.priorAgencyDisplay || item.priorAgency || '—')],
    ['Current Agency', GlobalQueryUI.escapeHtml_(item.currentAgencyDisplay || item.currentAgency || '—')],
    ['Previous Case', GlobalQueryUI.escapeHtml_(item.priorCase || '—')],
    ['Current Case', GlobalQueryUI.escapeHtml_(item.currentCase || '—')],
    ['Detected', GlobalQueryUI.formatDate(item.detected)]
  ]);
}

function bindChurnEvents_() {
  if (churnInitialized) return;
  churnInitialized = true;

  document.getElementById('churnAgencySelect').addEventListener('change', renderAgencyChurn);

  ['showGains', 'showLosses', 'showSwitches'].forEach(id => {
    document.getElementById(id).addEventListener('change', renderRecentChurn);
  });

  ['showAgencyGains', 'showAgencyLosses', 'showAgencySwitches'].forEach(id => {
    document.getElementById(id).addEventListener('change', renderAgencyChurn);
  });

  document.getElementById('recentChurnSearch').addEventListener('input', renderRecentChurn);
}

bindChurnEvents_();

window.loadGlobalQueryChurn = loadGlobalQueryChurn;
window.renderAgencyChurn = renderAgencyChurn;
window.renderRecentChurn = renderRecentChurn;
window.openChurnModal = openChurnModal;
