const GLOBALQUERY_OUR_AGENCY = 'AGRIPLACEMENTSINTERNATIONAL';

const STATES = [
  { code: '', name: 'All States' }, { code: 'AL', name: 'Alabama' }, { code: 'AK', name: 'Alaska' },
  { code: 'AZ', name: 'Arizona' }, { code: 'AR', name: 'Arkansas' }, { code: 'CA', name: 'California' },
  { code: 'CO', name: 'Colorado' }, { code: 'CT', name: 'Connecticut' }, { code: 'DE', name: 'Delaware' },
  { code: 'FL', name: 'Florida' }, { code: 'GA', name: 'Georgia' }, { code: 'HI', name: 'Hawaii' },
  { code: 'ID', name: 'Idaho' }, { code: 'IL', name: 'Illinois' }, { code: 'IN', name: 'Indiana' },
  { code: 'IA', name: 'Iowa' }, { code: 'KS', name: 'Kansas' }, { code: 'KY', name: 'Kentucky' },
  { code: 'LA', name: 'Louisiana' }, { code: 'ME', name: 'Maine' }, { code: 'MD', name: 'Maryland' },
  { code: 'MA', name: 'Massachusetts' }, { code: 'MI', name: 'Michigan' }, { code: 'MN', name: 'Minnesota' },
  { code: 'MS', name: 'Mississippi' }, { code: 'MO', name: 'Missouri' }, { code: 'MT', name: 'Montana' },
  { code: 'NE', name: 'Nebraska' }, { code: 'NV', name: 'Nevada' }, { code: 'NH', name: 'New Hampshire' },
  { code: 'NJ', name: 'New Jersey' }, { code: 'NM', name: 'New Mexico' }, { code: 'NY', name: 'New York' },
  { code: 'NC', name: 'North Carolina' }, { code: 'ND', name: 'North Dakota' }, { code: 'OH', name: 'Ohio' },
  { code: 'OK', name: 'Oklahoma' }, { code: 'OR', name: 'Oregon' }, { code: 'PA', name: 'Pennsylvania' },
  { code: 'RI', name: 'Rhode Island' }, { code: 'SC', name: 'South Carolina' }, { code: 'SD', name: 'South Dakota' },
  { code: 'TN', name: 'Tennessee' }, { code: 'TX', name: 'Texas' }, { code: 'UT', name: 'Utah' },
  { code: 'VT', name: 'Vermont' }, { code: 'VA', name: 'Virginia' }, { code: 'WA', name: 'Washington' },
  { code: 'WV', name: 'West Virginia' }, { code: 'WI', name: 'Wisconsin' }, { code: 'WY', name: 'Wyoming' },
  { code: 'DC', name: 'District of Columbia' }, { code: 'PR', name: 'Puerto Rico' }, { code: 'GU', name: 'Guam' },
  { code: 'VI', name: 'U.S. Virgin Islands' }, { code: 'MP', name: 'Northern Mariana Islands' },
  { code: 'AS', name: 'American Samoa' }
];

function escapeHtml_(value) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

function formatDate(value) {
  if (!value || value === '—') return '—';
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatBoolean_(value) {
  if (value === true) return '✓';
  if (value === false) return '✗';

  const normalized = String(value ?? '').trim().toLowerCase();
  if (['y', 'yes', 'true', '1'].includes(normalized)) return '✓';
  if (['n', 'no', 'false', '0'].includes(normalized)) return '✗';
  return '—';
}

function getErrorMessage_(error) {
  if (!error) return 'Unknown error.';
  if (typeof error === 'string') return error;
  return error.message || String(error);
}

function appendKv(container, pairs) {
  container.innerHTML = pairs.map(([key, value]) => `<div class="k">${escapeHtml_(key)}</div><div class="v">${value ?? '—'}</div>`).join('');
}

function populateStateDropdown(selectId = 'filterState') {
  const select = document.getElementById(selectId);
  if (!select) return;

  select.innerHTML = '';

  STATES.forEach(state => {
    const option = document.createElement('option');
    option.value = state.code;
    option.textContent = state.name;
    select.appendChild(option);
  });
}

function initializeTabs() {
  document.querySelectorAll('.tab-btn').forEach(button => {
    button.addEventListener('click', () => {
      const targetId = button.dataset.tab;

      document.querySelectorAll('.tab-btn').forEach(item => {
        item.classList.toggle('active', item === button);
      });

      document.querySelectorAll('.tab-panel').forEach(panel => {
        panel.classList.toggle('active', panel.id === targetId);
      });

      if (
        targetId === 'employersTab' &&
        typeof window.initializeEmployers === 'function'
      ) {
        window.initializeEmployers();
      }

      if (
        targetId === 'agenciesTab' &&
        typeof window.loadGlobalQueryAgencies === 'function'
      ) {
        window.loadGlobalQueryAgencies();
      }

      if (
        targetId === 'churnTab' &&
        typeof window.loadGlobalQueryChurn === 'function'
      ) {
        window.loadGlobalQueryChurn();
      }
    });
  });
}

window.GlobalQueryUI = { escapeHtml_, formatDate, formatBoolean_, getErrorMessage_, appendKv, populateStateDropdown, initializeTabs };
