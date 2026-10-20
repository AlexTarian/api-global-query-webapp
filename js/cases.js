let cases = [];
let caseSearchRequest = 0;
let activeCaseModalRow = null;
let casesInitialized = false;
let caseModalView = 'details';
let activeJobOrderData = null;
let activeJobOrderTab = 'worksites';

function initializeJobOrderTabs_() {
  document.querySelectorAll('[data-jo-tab]').forEach(button => {
    button.addEventListener('click', () => {
      activeJobOrderTab = button.dataset.joTab;
      renderJobOrderTab_();
    });
  });
}

function renderJobOrderTab_() {
  document.querySelectorAll('[data-jo-tab]').forEach(button => {
    const active = button.dataset.joTab === activeJobOrderTab;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', String(active));
  });

  if (!activeJobOrderData) return;

  const container = document.getElementById('modalExtractedContent');

  switch (activeJobOrderTab) {
    case 'rates':
      renderAddendumARates_(activeJobOrderData.rates);
      break;

    case 'worksites':
      renderAddendumBWorksites_(activeJobOrderData.worksites);
      break;

    case 'housing':
      renderJobOrderHousing_(activeJobOrderData.housing);
      break;

    case 'terms':
      renderAddendumCTerms_(activeJobOrderData.terms);
      break;
  }

  // Only enable CSV downloads once a tab has export-ready records.
  const exportReady = activeJobOrderData.exportReady?.[activeJobOrderTab] === true;
  if (exportReady) addJobOrderCsvButton_(container, activeJobOrderTab);
}

function jobOrderAddressLine_(record) {
  if (record.address) return String(record.address).replace(/\s+/g, ' ').trim();

  const street = record.address_street || '';
  const city = record.city || '';
  const state = record.state || '';
  const zip = record.zip || '';
  const county = record.county || '';

  return [street, city, [state, zip, county].filter(Boolean).join(' ')]
    .filter(Boolean).join(', ').replace(/\s+/g, ' ').trim();
}

function makeJobOrderCopyAddressButton_(address) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'btn jo-copy-address';
  button.textContent = 'Copy Address';
  button.disabled = !address;

  button.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(address);
      button.textContent = 'Copied!';
      setTimeout(() => { button.textContent = 'Copy Address'; }, 1500);
    } catch (error) {
      console.error('Could not copy address:', error);
      button.textContent = 'Copy failed';
    }
  });

  return button;
}

function normalizeWorksiteForCsv_(site) {
  const address = String(site.address || '').replace(/\s+/g, ' ').trim();

  // Expected format:
  // Street, City, State ZIP, COUNTY
  const parts = address.split(',').map(part => part.trim()).filter(Boolean);

  let street = '';
  let city = '';
  let state = '';
  let zip = '';
  let county = '';

  if (parts.length >= 4) {
    county = parts.pop().replace(/\s+COUNTY$/i, ' County');
    const stateZip = parts.pop();
    city = parts.pop();
    street = parts.join(', ');

    const match = stateZip.match(/^(.+?)\s+(\d{5})(?:-\d{4})?$/);

    if (match) {
      state = match[1].trim();
      zip = match[2];
    }
  }

  return {
    id: '',
    address_street: site.address_street || street,
    city: site.city || city,
    county: site.county || county,
    state: site.state || state,
    zip: site.zip || zip,
    name_of_business: site.name_of_business || site.business || '',
    nickname: site.nickname || ''
  };
}

const JOB_ORDER_CSV_COLUMNS = {
  rates: ['id', 'crop_id', 'crop_or_ag_activity', 'wage_offer', 'per', 'units_rate_info', 'default_sort_order'],
  worksites: ['id', 'address_street', 'city', 'county', 'state', 'zip', 'name_of_business', 'nickname'],
  housing: [
    'id', 'address_street', 'city', 'county', 'state', 'zip', 'description', 'type',
    'num_units', 'total_occupancy', 'nickname', 'is_inspection_authority_local',
    'is_inspection_authority_swa', 'is_inspection_authority_other_state',
    'is_inspection_authority_federal', 'is_inspection_authority_other', 'inspection_authority_other'
  ],
  terms: ['id', 'section', 'summary', 'details']
};

function buildJobOrderCsv_(tab, rows) {
  const columns = JOB_ORDER_CSV_COLUMNS[tab];
  if (!columns) throw new Error(`Unknown job order export type: ${tab}`);

  const exportRows = tab === 'worksites' ? rows.map(normalizeWorksiteForCsv_) : rows;

  return [
    columns.map(escapeCsvValue_).join(','),
    ...exportRows.map(row => columns.map(column => escapeCsvValue_(row[column])).join(','))
  ].join('\r\n');
}

function downloadJobOrderCsv_(tab = activeJobOrderTab) {
  if (!activeJobOrderData) return;

  const rows = activeJobOrderData[tab] || [];
  if (!rows.length) {
    alert('There are no extracted records to export from this tab.');
    return;
  }

  const csv = buildJobOrderCsv_(tab, rows);
  const filename = `${activeJobOrderData.caseNum}_${tab}.csv`;
  const blob = new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');

  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function addJobOrderCsvButton_(container, tab) {
  const rows = activeJobOrderData?.[tab] || [];
  const heading = container.querySelector('h4');
  if (!heading) return;

  const header = document.createElement('div');
  header.className = 'jo-section-header';

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'btn jo-download-btn';
  button.textContent = `↓ Download CSV (${rows.length})`;
  button.disabled = !rows.length;
  button.addEventListener('click', () => downloadJobOrderCsv_(tab));

  heading.replaceWith(header);
  header.append(heading, button);
}

function setCaseModalView_(view) {
  caseModalView = view;

  document.getElementById('modalCaseDetailsView').hidden = view !== 'details';
  document.getElementById('modalExtractedView').hidden = view !== 'extracted';
  document.getElementById('extractBackButton').hidden = view !== 'extracted';
}

let jobOrderExtractRequest = 0;

async function openExtractedCaseView_() {
  if (!activeCaseModalRow?.caseNum) return;

  const caseNum = activeCaseModalRow.caseNum;
  const requestId = ++jobOrderExtractRequest;
  const container = document.getElementById('modalExtractedContent');

  setCaseModalView_('extracted');
  container.textContent = `Retrieving job order ${caseNum}...`;

  try {
    const { data: { session }, error: sessionError } = await window.globalQuerySupabase.auth.getSession();

    if (sessionError || !session?.access_token) {
      throw new Error('You must be signed in to retrieve job orders.');
    }

    const response = await fetch(
      `${window.globalQuerySupabase.supabaseUrl}/functions/v1/fetch-job-order`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'apikey': window.globalQuerySupabase.supabaseKey,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ caseNum })
      }
    );

    if (!response.ok) throw new Error(`PDF request returned HTTP ${response.status}`);

    const contentType = response.headers.get('content-type') || '';
    console.log('Job order response:', { caseNum, contentType, status: response.status });

    const pdfBytes = new Uint8Array(await response.arrayBuffer());

    if (pdfBytes.length < 5 || String.fromCharCode(...pdfBytes.slice(0, 5)) !== '%PDF-') {
      throw new Error('The endpoint did not return a valid PDF.');
    }

    if (!window.pdfjsLib) throw new Error('PDF.js is not available.');

    const pdf = await pdfjsLib.getDocument({ data: pdfBytes }).promise;
    const pages = [];

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      const page = await pdf.getPage(pageNumber);
      const textContent = await page.getTextContent();

      const items = textContent.items
        .filter(item => typeof item.str === 'string' && item.str.trim())
        .map(item => ({
          text: item.str,
          x: Math.round(item.transform[4] * 100) / 100,
          y: Math.round(item.transform[5] * 100) / 100,
          width: Math.round(item.width * 100) / 100,
          height: Math.round(item.height * 100) / 100
        }));

      const text = items.map(item => item.text).join(' ');
      pages.push({ pageNumber, text, items });
    }

    if (requestId !== jobOrderExtractRequest || activeCaseModalRow?.caseNum !== caseNum) return;

    const fullText = pages.map(page => `PAGE ${page.pageNumber}\n${page.text}`).join('\n\n');

    console.log('Job order extraction complete:', {
      caseNum,
      pages: pdf.numPages,
      characters: fullText.length
    });

    activeJobOrderData = {
      caseNum,
      pages,
      rates: parseAddendumARates_(pages),
      worksites: parseAddendumBWorksites_(pages),
      housing: parseJobOrderHousing_(pages),
      terms: parseAddendumCTerms_(pages),
      exportReady: {
        rates: true,
        worksites: true,
        housing: true,
        terms: true
      }
    };

    console.log('Addendum A parsed rates:', activeJobOrderData.rates.length);
    console.table(activeJobOrderData.rates);
    console.log('Housing records:', activeJobOrderData.housing.length);
    console.table(activeJobOrderData.housing);

    inspectAddendumALayout_(pages);
    inspectAddendumBHousingCheckboxes_(pages);

    activeJobOrderTab = 'worksites';
    renderJobOrderTab_();

    const addendumBPages = pages.filter(page =>
      page.text.includes('ETA-790A Addendum B')
    );

  } catch (error) {
    if (requestId !== jobOrderExtractRequest) return;

    console.error('Job order extraction failed:', error);
    container.textContent = `Unable to extract job order: ${GlobalQueryUI.getErrorMessage_(error)}`;
  }
}

function renderJobOrderTextPreview_(caseNum, pages) {
  const container = document.getElementById('modalExtractedContent');
  container.replaceChildren();

  const summary = document.createElement('p');
  summary.textContent = `Successfully extracted ${pages.length} page(s) from ${caseNum}.`;
  container.appendChild(summary);

  pages.forEach(({ pageNumber, text }) => {
    const section = document.createElement('div');
    section.className = 'modal-info-card';

    const heading = document.createElement('h4');
    heading.textContent = `Page ${pageNumber}`;

    const preview = document.createElement('pre');
    preview.className = 'job-order-text-preview';
    preview.textContent = text || '(No embedded text found)';

    section.append(heading, preview);
    container.appendChild(section);
  });
}

function parseAddendumBWorksites_(pages) {
  const worksites = [];

  const addendumBPages = pages.filter(page =>
    page.text.includes('Form ETA-790A Addendum B')
  );

  for (const page of addendumBPages) {
    const items = page.items || [];

    // Find the section boundaries.
    const sectionStart = items.find(item =>
      item.text.includes('C. Additional Place of Employment Information')
    );

    const sectionEnd = items.find(item =>
      item.text.includes('D. Additional Housing Information')
    );

    if (!sectionStart || !sectionEnd) continue;

    // Only use text positioned inside the worksite section.
    const sectionItems = items.filter(item =>
      item.y < 485 &&
      item.y > sectionEnd.y &&
      item.text.trim()
    );

    // Each worksite begins with an agricultural business name.
    const businessItems = sectionItems
      .filter(item => item.x >= 35 && item.x < 175)
      .sort((a, b) => b.y - a.y);

    for (let i = 0; i < businessItems.length; i++) {
      const business = businessItems[i];
      const nextBusiness = businessItems[i + 1];

      const upperY = business.y + 6;
      const lowerY = nextBusiness ? nextBusiness.y + 6 : sectionEnd.y;

      const rowItems = sectionItems.filter(item =>
        item.y <= upperY && item.y > lowerY
      );

      const columnText = (minX, maxX) => rowItems
        .filter(item => item.x >= minX && item.x < maxX)
        .sort((a, b) => b.y - a.y || a.x - b.x)
        .map(item => item.text.trim())
        .join(', ');

      worksites.push({
        business: business.text.trim(),
        address: columnText(175, 400),
        additionalInfo: columnText(400, 600),
        beginDate: columnText(600, 655),
        endDate: columnText(655, 700),
        workers: Number(columnText(700, 760)) || null
      });
    }
  }

  return worksites;
}

function getAddendumAPages_(pages) {
  return pages.filter(page =>
    /(?:Form\s+)?ETA-790A\s+Addendum\s+A/i.test(page.text)
  );
}

function getPdfTextRows_(page, tolerance = 3) {
  const rows = [];

  const sorted = [...(page.items || [])]
    .filter(item => item.text?.trim())
    .sort((a, b) => b.y - a.y || a.x - b.x);

  for (const item of sorted) {
    let row = rows.find(row => Math.abs(row.y - item.y) <= tolerance);

    if (!row) {
      row = { y: item.y, items: [] };
      rows.push(row);
    }

    row.items.push(item);
  }

  return rows
    .sort((a, b) => b.y - a.y)
    .map(row => ({
      y: row.y,
      items: row.items.sort((a, b) => a.x - b.x),
      text: row.items.map(item => item.text.trim()).join(' ')
    }));
}

function parseAddendumARates_(pages) {
  const rates = [];

  for (const page of getAddendumAPages_(pages)) {
    const items = (page.items || []).filter(item => item.text?.trim());

    // The Addendum A table has ten slots per page, each approximately
    // 40.08 PDF points tall. Detect slots using the activity column.
    const activities = items
      .filter(item => item.x >= 80 && item.x < 230 && item.y > 85 && item.y < 485)
      .sort((a, b) => b.y - a.y || a.x - b.x);

    const groups = [];

    for (const item of activities) {
      const existing = groups.find(group => Math.abs(group.anchorY - item.y) < 22);

      if (existing) {
        existing.activityItems.push(item);
      } else {
        groups.push({ anchorY: item.y, activityItems: [item] });
      }
    }

    for (const group of groups) {
      const anchorY = group.anchorY;

      // Include content in the same table slot, including the wage
      // digits printed below the activity description.
      const slotItems = items.filter(item =>
        item.y <= anchorY + 9 &&
        item.y > anchorY - 29
      );

      const column = (minX, maxX) => slotItems
        .filter(item => item.x >= minX && item.x < maxX)
        .sort((a, b) => b.y - a.y || a.x - b.x)
        .map(item => item.text.trim())
        .join(' ')
        .trim();

      const activity = group.activityItems
        .sort((a, b) => b.y - a.y || a.x - b.x)
        .map(item => item.text.trim())
        .join(' ')
        .trim();

      const cropId = column(35, 80);

      // Wage values are printed as two separate numeric components,
      // generally at x=242 and x=275.48.
      const wageItems = slotItems.filter(item =>
        item.x >= 235 && item.x < 295 &&
        /^\d{1,3}$/.test(item.text.trim())
      ).sort((a, b) => b.y - a.y || a.x - b.x);

      let wageOffer = '';

      if (wageItems.length >= 2) {
        const dollars = wageItems.find(item => item.x < 260);
        const cents = wageItems.find(item => item.x >= 260);

        if (dollars && cents) {
          wageOffer = `${Number(dollars.text)}.${cents.text.trim().padStart(2, '0')}`;
        }
      }

      const perText = column(295, 335);
      const per = /piece\s*rate/i.test(perText) ? 'Piece Rate'
        : /\bhour\b/i.test(perText) ? 'Hour'
        : perText;

      const unitsInfo = column(335, 780);

      if (!activity || !wageOffer) continue;

      rates.push({
        id: '',
        crop_id: cropId,
        crop_or_ag_activity: activity,
        wage_offer: wageOffer,
        per,
        units_rate_info: unitsInfo,
        default_sort_order: rates.length + 1,
      });
    }
  }

  return rates;
}

function makeEmptyHousingRecord_(source, pageNumber) {
  return {
    id: '', address_street: '', city: '', county: '', state: '', zip: '',
    description: '', type: '', num_units: '', total_occupancy: '', nickname: '',
    is_inspection_authority_local: '', is_inspection_authority_swa: '',
    is_inspection_authority_other_state: '', is_inspection_authority_federal: '',
    is_inspection_authority_other: '', inspection_authority_other: '',
    source, reviewWarnings: []
  };
}

function housingText_(items) {
  return items.sort((a, b) => b.y - a.y || a.x - b.x)
    .map(item => item.text.trim()).filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
}

function housingBetween_(page, topY, bottomY, minX = 0, maxX = Infinity) {
  return (page.items || []).filter(item =>
    item.y < topY && item.y > bottomY && item.x >= minX && item.x < maxX && item.text?.trim()
  );
}

function housingFind_(page, pattern) {
  return (page.items || []).find(item => pattern.test(item.text));
}

function parseHousingAddress_(raw, record) {
  const lines = String(raw || '').split(/\n|,\s*(?=[A-Za-z ]+\s+\d{5})/).map(s => s.trim()).filter(Boolean);
  const text = lines.join(', ');
  const match = text.match(/^(.*?),?\s+([A-Za-z][A-Za-z .'-]*),\s*([A-Za-z][A-Za-z ]+?)\s+(\d{5})(?:-\d{4})?(?:,?\s+([A-Za-z ]+COUNTY))?$/i);

  if (match) {
    record.address_street = match[1].replace(/,\s*$/, '').trim();
    record.city = match[2].trim();
    record.state = match[3].trim();
    record.zip = match[4];
    if (match[5]) record.county = match[5].trim();
  } else {
    record.address_street = lines[0] || '';
    record.reviewWarnings.push('Review address components against PDF.');
  }
}

function housingClean_(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function housingItems_(page, top, bottom, left = 0, right = Infinity) {
  return (page.items || [])
    .filter(i => i.text?.trim() && i.y <= top && i.y > bottom && i.x >= left && i.x < right)
    .sort((a, b) => b.y - a.y || a.x - b.x);
}

function housingValue_(page, top, bottom, left, right) {
  return housingClean_(housingItems_(page, top, bottom, left, right).map(i => i.text).join(' '));
}

function housingLabel_(page, pattern) {
  return (page.items || []).find(i => pattern.test(housingClean_(i.text)));
}

function housingRowLabel_(page, pattern, belowY = Infinity) {
  return getPdfTextRows_(page, 3)
    .find(row => row.y < belowY && pattern.test(row.text));
}

function housingCheck_(page, x, y, toleranceX = 8, toleranceY = 8) {
  const items = housingItems_(page, y + toleranceY, y - toleranceY, x - toleranceX, x + toleranceX);

  // Checked boxes may appear as an overlaid "4" in the PDF's symbol font.
  const checked = items.some(item =>
    item.text.trim() === '4' ||
    /[✓✔☑\u0001-\u001F]/.test(item.text)
  );

  // An unchecked checkbox glyph confirms the field exists.
  const hasBox = items.some(item => /[□☐]/.test(item.text));

  return checked ? 1 : hasBox ? 0 : '';
}

function housingCheckByLabel_(page, label, top, bottom) {
  const items = housingItems_(page, top, bottom);
  const labelItem = items.find(item => label.test(housingClean_(item.text)));

  if (!labelItem) return '';

  // The checkbox is approximately 10.5 PDF points left of its label.
  const boxX = labelItem.x - 10.5;

  return housingCheck_(page, boxX, labelItem.y, 6, 5);
}

function housingSetAddress_(record, street, location, county) {
  record.address_street = housingClean_(street);
  record.county = housingClean_(county).replace(/\s+COUNTY$/i, ' County');

  const match = housingClean_(location).match(/^(.+?),\s*(.+?)\s+(\d{5})(?:-\d{4})?$/);

  if (match) {
    record.city = match[1];
    record.state = match[2];
    record.zip = match[3];
  } else {
    record.reviewWarnings.push('Review city, state, and ZIP.');
  }
}

function parseMainHousing_(pages) {
  const records = [];

  for (const page of pages) {
    const heading = housingRowLabel_(page, /D\.\s*Housing Information/i);
    if (!heading) continue;

    const address = housingRowLabel_(page, /Housing Address\/Location/i, heading.y);
    const city = housingRowLabel_(page, /2\s*\.\s*City/i, address?.y);
    const type = housingRowLabel_(page, /Type of Housing/i, city?.y);
    const inspection = housingRowLabel_(page, /Identify the entity/i, type?.y);
    const description = housingRowLabel_(page, /Additional Housing Information/i, inspection?.y);

    if (!address || !city || !type || !inspection) {
      console.warn('Incomplete main housing labels:', {
        page: page.pageNumber, heading, address, city, type, inspection, description
      });
      continue;
    }

    const record = makeEmptyHousingRecord_('Main ETA-790A', page.pageNumber);

    record.address_street = housingValue_(page, address.y - 2, city.y + 2, 35, 600);

    const locationItems = housingItems_(page, city.y - 2, type.y + 3);

    const columns = [
      [35, 260, 'city'],
      [260, 315, 'state'],
      [315, 405, 'zip'],
      [405, 600, 'county']
    ];

    for (const [minX, maxX, key] of columns) {
      record[key] = housingClean_(
        locationItems.filter(item => item.x >= minX && item.x < maxX)
          .map(item => item.text).join(' ')
      );
    }

    // Some PDFs place the ZIP and county in the same text item.
    const zipCountyMatch = record.zip.match(/^(\d{5})(?:-\d{4})?\s+(.+)$/);

    if (zipCountyMatch) {
      record.zip = zipCountyMatch[1];
      record.county = zipCountyMatch[2].replace(/\s+COUNTY$/i, ' County');
    }

    const numericItems = housingItems_(page, type.y - 2, inspection.y + 3, 390, 600)
      .filter(item => /^\d+$/.test(item.text.trim()));

    record.num_units = numericItems.find(item => item.x < 475)?.text || '';
    record.total_occupancy = numericItems.find(item => item.x >= 475)?.text || '';

    record.description = description
      ? housingValue_(page, description.y - 3, description.y - 42, 35, 600)
      : '';

    if (/^none$/i.test(record.description)) record.description = '';

    // Housing type: employer-provided versus rental/public.
    const employerProvided = housingCheck_(page, 71.94, type.y - 10);
    const rentalPublic = housingCheck_(page, 227.95, type.y - 10);

    if (employerProvided === 1 && rentalPublic === 0) {
      record.type = 1;
    } else if (rentalPublic === 1 && employerProvided === 0) {
      record.type = 2;
    } else {
      record.reviewWarnings.push('Verify housing type.');
    }

    // Inspection authority checkboxes.
    record.is_inspection_authority_local = housingCheck_(page, 71.94, inspection.y - 12);
    record.is_inspection_authority_swa = housingCheck_(page, 153.48, inspection.y - 12);
    record.is_inspection_authority_other_state = housingCheck_(page, 196.98, inspection.y - 12);
    record.is_inspection_authority_federal = housingCheck_(page, 303.06, inspection.y - 12);
    record.is_inspection_authority_other = housingCheck_(page, 393.60, inspection.y - 12);

    if ([
      record.is_inspection_authority_local,
      record.is_inspection_authority_swa,
      record.is_inspection_authority_other_state,
      record.is_inspection_authority_federal,
      record.is_inspection_authority_other
    ].some(value => value === '')) {
      record.reviewWarnings.push('Verify inspection authority.');
    }

    if (record.address_street) records.push(record);
  }

  return records;
}

function parseAddendumBHousing_(pages) {
  const records = [];

  for (const page of pages) {
    if (!/Form ETA-790A Addendum B/i.test(page.text)) continue;

    const header = housingLabel_(page, /2\.\s*Physical Location/i);
    if (!header) continue;

    // Housing tables can have multiple rows and unused blank rows.
    // Each populated address begins at the left edge of the location column.
    const addressStarts = (page.items || [])
      .filter(i => i.x >= 140 && i.x < 250 && i.y < header.y - 8 && i.y > 80)
      .filter(i => /^\d+\s+\S/.test(i.text.trim()))
      .sort((a, b) => b.y - a.y);

    for (let index = 0; index < addressStarts.length; index++) {
      const start = addressStarts[index];
      const next = addressStarts[index + 1];

      // Each row is bounded by the next populated housing address.
      const top = start.y + 8;
      const bottom = next ? next.y + 8 : Math.max(80, start.y - 90);

      const locationItems = housingItems_(page, top, bottom, 140, 350);
      const lines = locationItems.map(i => housingClean_(i.text)).filter(Boolean);

      if (!lines.length) continue;

      const record = makeEmptyHousingRecord_('Addendum B', page.pageNumber);

      record.address_street = lines[0];

      const countyIndex = lines.findIndex(line => /\bCOUNTY\b/i.test(line));
      if (countyIndex !== -1) {
        record.county = lines[countyIndex].replace(/\s+COUNTY$/i, ' County');
      }

      const location = lines.slice(1, countyIndex === -1 ? undefined : countyIndex).join(' ');
      const match = location.match(/^(.+?),\s*(.+?)\s+(\d{5})(?:-\d{4})?$/);

      if (match) {
        record.city = match[1];
        record.state = match[2];
        record.zip = match[3];
      } else {
        record.reviewWarnings.push('Review address components.');
      }

      const units = housingItems_(page, top, bottom, 530, 575)
        .find(i => /^\d+$/.test(i.text.trim()));
      const occupancy = housingItems_(page, top, bottom, 575, 640)
        .find(i => /^\d+$/.test(i.text.trim()));

      record.num_units = units?.text || '';
      record.total_occupancy = occupancy?.text || '';

      // Identify housing type using the checkboxes within this record's row.
      const employerProvided = housingCheckByLabel_(page, /^Employer-provided$/i, top, bottom);
      const rentalPublic = housingCheckByLabel_(page, /^Rental or public$/i, top, bottom);

      if (employerProvided === 1 && rentalPublic === 0) {
        record.type = 1;
      } else if (rentalPublic === 1 && employerProvided === 0) {
        record.type = 2;
      } else {
        record.reviewWarnings.push('Verify housing type.');
      }

      // Identify inspection authorities for this housing record.
      record.is_inspection_authority_local = housingCheckByLabel_(page, /^Local authority$/i, top, bottom);
      record.is_inspection_authority_swa = housingCheckByLabel_(page, /^SWA$/i, top, bottom);
      record.is_inspection_authority_other_state = housingCheckByLabel_(page, /^Other State authority$/i, top, bottom);
      record.is_inspection_authority_federal = housingCheckByLabel_(page, /^Federal authority$/i, top, bottom);
      record.is_inspection_authority_other = housingCheckByLabel_(page, /^Other$/i, top, bottom);

      if ([
        record.is_inspection_authority_local,
        record.is_inspection_authority_swa,
        record.is_inspection_authority_other_state,
        record.is_inspection_authority_federal,
        record.is_inspection_authority_other
      ].some(value => value === '')) {
        record.reviewWarnings.push('Verify inspection authority.');
      }
      records.push(record);
    }
  }

  return records;
}

function inspectAddendumBHousingCheckboxes_(pages) {
  for (const page of pages) {
    if (!/Form\s+ETA-790A\s+Addendum\s+B/i.test(page.text)) continue;

    const header = housingLabel_(page, /2\.\s*Physical Location/i);
    if (!header) continue;

    console.group(`Addendum B Housing Checkboxes — PDF Page ${page.pageNumber}`);

    // Show the table headings and their coordinates.
    console.table(
      getPdfTextRows_(page, 3)
        .filter(row => row.y < header.y + 25 && row.y > 80)
        .map(row => ({ y: row.y, text: row.text }))
    );

    // Show individual text items, including checkbox glyphs and checkmarks.
    console.table(
      (page.items || [])
        .filter(item => item.y < header.y - 8 && item.y > 80)
        .filter(item =>
          /[□☐✓✔☑\u0001-\u001F]/.test(item.text) ||
          item.text.trim() === '4' ||
          /Employer|Rental|public|Local|SWA|State|Federal|Other|authority/i.test(item.text)
        )
        .sort((a, b) => b.y - a.y || a.x - b.x)
        .map(item => ({
          x: item.x,
          y: item.y,
          text: JSON.stringify(item.text)
        }))
    );

    console.groupEnd();
  }
}

function parseJobOrderHousing_(pages) {
  return [
    ...parseMainHousing_(pages),
    ...parseAddendumBHousing_(pages)
  ];
}

function renderJobOrderHousing_(housing) {
  const container = document.getElementById('modalExtractedContent');
  container.replaceChildren();

  const heading = document.createElement('h4');
  heading.textContent = `Housing Locations (${housing.length})`;
  container.appendChild(heading);

  if (!housing.length) {
    const message = document.createElement('p');
    message.textContent = 'No housing records were identified.';
    container.appendChild(message);
    return;
  }

  housing.forEach((record, index) => {
    const card = document.createElement('div');
    card.className = 'modal-info-card';

    const title = document.createElement('div');
    title.className = 'joItemHeading';
    title.textContent = `Housing ${index + 1}`;

    const address = jobOrderAddressLine_(record);
    const addressRow = document.createElement('div');
    addressRow.className = 'jo-address-row';

    const addressText = document.createElement('span');
    addressText.className = 'jo-address-text';
    addressText.textContent = address;

    addressRow.append(addressText, makeJobOrderCopyAddressButton_(address));

    const details = document.createElement('div');
    details.className = 'jo-worksite-details';

    const fields = [
      ['Housing Type', record.type === 1 ? 'Employer-Owned' : record.type === 2 ? 'Rented' : 'Needs review'],
      ['Units', record.num_units],
      ['Total Occupancy', record.total_occupancy],
    ];

    fields.forEach(([label, value]) => {
      if (value === null || value === undefined || value === '') return;

      const line = document.createElement('div');
      line.className = 'jo-worksite-field';

      const strong = document.createElement('strong');
      strong.textContent = `${label}:`;

      const span = document.createElement('span');
      span.textContent = String(value);

      line.append(strong, span);
      details.appendChild(line);
    });

    if (record.reviewWarnings.length) {
      const warning = document.createElement('p');
      warning.className = 'jo-housing-warning';
      warning.textContent = `Review needed: ${record.reviewWarnings.join(' ')}`;
      details.appendChild(warning);
    }

    card.append(title, addressRow, details);
    container.appendChild(card);
  });
}

function getAddendumCPages_(pages) {
  return pages.filter(page =>
    /(?:Form\s+)?ETA-790A\s+Addendum\s+C/i.test(page.text)
  );
}

function getAddendumCBodyLines_(page) {
  const rows = getPdfTextRows_(page, 3);

  return rows
    .filter(row => row.y > 70 && row.y < 520)
    .filter(row => !/^(?:Form ETA-790A Addendum C|U\.S\. Department of Labor|H-2A Agricultural Clearance Order)/i.test(row.text))
    .filter(row => !/^Page C\.\d+ of C\.\d+/i.test(row.text))
    .map(row => row.text.trim())
    .filter(Boolean);
}

function parseAddendumCTerms_(pages) {
  const terms = [];

  const clean = text => String(text || '').replace(/\s+/g, ' ').trim();
  const isEntryHeading = text => /^[a-z]\.\s*Job Offer Information\s+\d+\b/i.test(text);
  const isFieldHeading = text => /(?:Section\/Item Number|Name of Section or Category of Material Term or Condition|Details of Material Term or Condition)/i.test(text);
  const isBoilerplate = text => /^(?:H\.\s*Additional Material Terms|For Public Burden Statement|OMB Approval:|Expiration Date:|H-2A Case Number:|Case Status:|Determination Date:|FOR DEPARTMENT OF LABOR USE ONLY|Page C\.\d+)/i.test(text);

  for (const page of getAddendumCPages_(pages)) {
    const rows = getPdfTextRows_(page, 3)
      .filter(row => row.y > 70 && row.y < 520)
      .sort((a, b) => b.y - a.y);

    const headings = rows.filter(row => isEntryHeading(clean(row.text)));

    for (let i = 0; i < headings.length; i++) {
      const heading = headings[i];
      const nextHeading = headings[i + 1];
      const bottom = nextHeading ? nextHeading.y : 70;

      const entryRows = rows.filter(row => row.y < heading.y && row.y > bottom);
      const detailsHeadingIndex = entryRows.findIndex(row =>
        /3\.\s*Details of Material Term or Condition/i.test(clean(row.text))
      );

      if (detailsHeadingIndex === -1) continue;

      const headerRows = entryRows.slice(0, detailsHeadingIndex);
      const detailRows = entryRows.slice(detailsHeadingIndex + 1);

      // Find the section and category using their positions in the form.
      // Values can share a row with the field labels or appear above them.
      const headerItems = (page.items || [])
        .filter(item => item.y < heading.y && item.y > entryRows[detailsHeadingIndex].y)
        .filter(item => !isFieldHeading(clean(item.text)));

      const section = clean(headerItems
        .filter(item => item.x >= 120 && item.x < 190)
        .map(item => item.text)
        .join(' '))
        .match(/\b[A-Z]\.\d+[a-z]?\b/i)?.[0] || '';

      const category = clean(headerItems
        .filter(item => item.x >= 350 && item.x < 650)
        .map(item => item.text)
        .join(' '));

      const details = clean(detailRows
        .filter(row => !isBoilerplate(clean(row.text)))
        .filter(row => !isFieldHeading(clean(row.text)))
        .map(row => row.text)
        .join(' '));

      if (!details) continue;

      terms.push({
        id: '',
        section,
        summary: category,
        details,
      });
    }
  }

  return terms;
}

function renderAddendumCTerms_(terms) {
  const container = document.getElementById('modalExtractedContent');
  container.replaceChildren();

  const heading = document.createElement('h4');
  heading.textContent = `Addendum C (${terms.length})`;
  container.appendChild(heading);

  if (!terms.length) {
    const message = document.createElement('p');
    message.textContent = 'No Addendum C material terms were identified.';
    container.appendChild(message);
    return;
  }

  terms.forEach((term, index) => {
    const card = document.createElement('div');
    card.className = 'modal-info-card';

    const title = document.createElement('div');
    title.className = 'joItemHeading';
    title.textContent = `Term ${index + 1} — Section ${term.section}`;

    const details = document.createElement('div');
    details.className = 'jo-worksite-details';

    const sectionName = document.createElement('div');
    sectionName.className = 'jo-term-section-name';
    sectionName.textContent = term.summary || 'Section name unavailable';

    const body = document.createElement('p');
    body.className = 'jo-term-details';
    body.textContent = term.details;

    details.append(sectionName, body);
    card.append(title, details);
    container.appendChild(card);
  });
}

function renderAddendumARates_(rates) {
  const container = document.getElementById('modalExtractedContent');
  container.replaceChildren();

  const heading = document.createElement('h4');
  heading.textContent = `Addendum A — Wage Rates (${rates.length})`;
  container.appendChild(heading);

  if (!rates.length) {
    const message = document.createElement('p');
    message.textContent = 'No Addendum A wage rates were found.';
    container.appendChild(message);
    return;
  }

  rates.forEach((rate, index) => {
    const card = document.createElement('div');
    card.className = 'modal-info-card';

    const title = document.createElement('div');
    title.className = 'joItemHeading';
    title.textContent = `Rate ${index + 1}: ${rate.crop_or_ag_activity}`;

    const details = document.createElement('div');
    details.className = 'jo-worksite-details';

    const fields = [
      ['Crop ID', rate.crop_id],
      ['Wage Offer', rate.wage_offer],
      ['Per', rate.per],
      ['Units / Rate Info', rate.units_rate_info]
    ];

    fields.forEach(([label, value]) => {
      if (value === null || value === undefined || value === '') return;

      const line = document.createElement('div');
      line.className = 'jo-worksite-field';

      const strong = document.createElement('strong');
      strong.textContent = `${label}:`;

      const span = document.createElement('span');
      span.textContent = String(value);

      line.append(strong, span);
      details.appendChild(line);
    });

    card.append(title, details);
    container.appendChild(card);
  });
}

function inspectAddendumALayout_(pages) {
  const addendumPages = getAddendumAPages_(pages);

  console.log(`Found ${addendumPages.length} Addendum A page(s).`);

  addendumPages.slice(0, 2).forEach(page => {
    const rows = getPdfTextRows_(page);

    console.group(`Addendum A — PDF page ${page.pageNumber}`);

    console.table(rows.map(row => ({
      y: row.y,
      text: row.text
    })));

    console.table(
      rows.flatMap(row => row.items.map(item => ({
        x: item.x,
        y: item.y,
        text: item.text
      })))
    );

    console.groupEnd();
  });

  return addendumPages;
}

function renderAddendumBWorksites_(worksites) {
  const container = document.getElementById('modalExtractedContent');
  container.replaceChildren();

  const heading = document.createElement('h4');
  heading.textContent = `Additional Worksites (${worksites.length})`;
  container.appendChild(heading);

  if (!worksites.length) {
    const message = document.createElement('p');
    message.textContent = 'No Addendum B worksites were found.';
    container.appendChild(message);
    return;
  }

  worksites.forEach((site, index) => {
    const card = document.createElement('div');
    card.className = 'modal-info-card';

    const title = document.createElement('div');
    title.className = 'joItemHeading';
    title.textContent = `Worksite ${index + 1}`;

    const details = document.createElement('div');

    const fields = [
      ['Business', site.business],
      ['Additional Information', site.additionalInfo],
      ['Begin Date', site.beginDate],
      ['End Date', site.endDate],
      ['Workers', site.workers]
    ];

    details.className = 'jo-worksite-details';

    fields.forEach(([label, value]) => {
      if (value === null || value === undefined || value === '') return;

      const line = document.createElement('div');
      line.className = 'jo-worksite-field';

      const strong = document.createElement('strong');
      strong.textContent = `${label}:`;

      const span = document.createElement('span');
      span.textContent = String(value);

      line.append(strong, span);
      details.appendChild(line);
    });

    const address = jobOrderAddressLine_(site);
    const addressRow = document.createElement('div');
    addressRow.className = 'jo-address-row';

    const addressText = document.createElement('span');
    addressText.className = 'jo-address-text';
    addressText.textContent = address;

    addressRow.append(addressText, makeJobOrderCopyAddressButton_(address));
    card.append(title, addressRow, details);
    container.appendChild(card);
  });
}

function caseListSelect_() {
  return `
    case_num,
    employer_name,
    fein,
    start_date,
    end_date,
    case_agencies(
      agencies(
        normalized_name,
        display_name
      )
    )
  `;
}

function mapCaseListRow_(row) {
  const agencyRows = Array.isArray(row.case_agencies) ? row.case_agencies : [];
  const agencies = agencyRows.map(item => item?.agencies).filter(Boolean);

  return {
    caseNum: row.case_num || '',
    employer: row.employer_name || '',
    fein: row.fein || '',
    start: row.start_date || '',
    end: row.end_date || '',
    agency: agencies.map(item => item.normalized_name).filter(Boolean).join(' | '),
    displayAgency: agencies.map(item => item.display_name || item.normalized_name).filter(Boolean).join(' | ')
  };
}

async function loadInitialCases_() {
  const requestId = ++caseSearchRequest;
  const startedAt = performance.now();

  setCasesLoading_(true);

  try {
    const rowsPromise = window.withSupabaseRetry_(() =>
      window.globalQuerySupabase
        .from('cases_with_occupation')
        .select(caseListSelect_())
        .order('case_num', { ascending: false })
        .limit(25)
    );

    const countPromise = window.withSupabaseRetry_(() =>
      window.globalQuerySupabase
        .from('cases_with_occupation')
        .select('case_num', {
          count: 'exact',
          head: true
        })
    );

    const rowsResult = await rowsPromise;

    if (requestId !== caseSearchRequest) return;
    if (rowsResult.error) throw rowsResult.error;

    cases = (rowsResult.data || []).map(mapCaseListRow_);
    renderCases(cases);

    document.getElementById('rowCountLabel').textContent =
      `Showing ${cases.length.toLocaleString()} most recent cases`;

    console.log('Initial case rows:', {
      roundTripMs: Math.round(performance.now() - startedAt),
      returned: cases.length
    });

    // Exact count can finish independently.
    const countResult = await countPromise;

    if (requestId !== caseSearchRequest) return;
    if (countResult.error) throw countResult.error;

    const total = Number(countResult.count) || 0;

    document.getElementById('rowCountLabel').textContent =
      `Showing ${cases.length.toLocaleString()} of ${total.toLocaleString()} cases`;

    console.log('Initial case count:', {
      total,
      totalMs: Math.round(performance.now() - startedAt)
    });

  } catch (error) {
    if (requestId !== caseSearchRequest) return;

    console.error('Initial case load failed:', error);

    cases = [];
    document.querySelector('#casesTable tbody').innerHTML =
      `<tr><td colspan="4" class="error-cell">${GlobalQueryUI.escapeHtml_(GlobalQueryUI.getErrorMessage_(error))}</td></tr>`;

    document.getElementById('rowCountLabel').textContent =
      'Unable to load cases';

  } finally {
    if (requestId === caseSearchRequest) {
      setCasesLoading_(false);
    }
  }
}

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
    naics_code,
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
    naicsCode: row.naics_code || '',
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

async function loadCaseDetail_(caseNum) {
  if (!caseNum) {
    throw new Error('No case number was provided.');
  }

  const { data, error } = await window.withSupabaseRetry_(() =>
    window.globalQuerySupabase
      .from('cases_with_occupation')
      .select(caseSelect_(false))
      .eq('case_num', caseNum)
      .maybeSingle()
  );

  if (error) throw error;
  if (!data) {
    throw new Error(`Case ${caseNum} could not be found.`);
  }

  return mapCaseRow_(data);
}

async function openCaseDetailByNumber_(caseNum) {
  if (!caseNum) return;

  const modal = document.getElementById('detailModalOverlay');

  try {
    clearCaseModal_();

    document.getElementById('detailModalTitle').textContent = caseNum;
    document.getElementById('detailModalEmployer').textContent = 'Loading case details…';

    modal.classList.remove('hidden');
    GlobalQueryUI.updateModalScrollLock_();

    const fullCase = await loadCaseDetail_(caseNum);
    openCaseModal(fullCase);

  } catch (error) {
    console.error('Could not load case detail:', error);

    modal.classList.add('hidden');
    GlobalQueryUI.updateModalScrollLock_();

    alert('GlobalQuery could not load this case right now. Please try again.');
  }
}

function clearCaseModal_() {
  document.getElementById('detailModalTitle').textContent = 'Loading…';
  document.getElementById('detailModalEmployer').textContent = '';

  document.getElementById('modalBusinessInfo').innerHTML = '';
  document.getElementById('modalJobInfo').innerHTML = '';
  document.getElementById('modalJobDesc').textContent = '';
  document.getElementById('modalAdditionalRequirements').textContent = '';

  document.getElementById('modalChurnInfo').innerHTML = '';

  const churnBanner = document.getElementById('churnBanner');
  churnBanner.className = 'churn-banner hidden';
  churnBanner.innerHTML = '';

  jobOrderExtractRequest++;
  activeJobOrderData = null;
  activeJobOrderTab = 'worksites';
  activeCaseModalRow = null;
  setCaseModalView_('details');
  document.getElementById('modalExtractedContent').textContent = 'No job order loaded.';
}

async function searchGlobalQueryCases(filters) {
  const client = window.globalQuerySupabase;
  const agencyFiltered = Boolean(filters.agency);

  const { data, error, count } = await withSupabaseRetry_(() => {
    let query = client
      .from('cases_with_occupation')
      .select(caseSelect_(agencyFiltered), { count: 'exact' });

    if (filters.caseNum) query = query.ilike('case_num', `%${filters.caseNum}%`);
    if (filters.employer) query = query.ilike('employer_name', `%${filters.employer}%`);
    if (filters.state) query = query.eq('employer_state', filters.state);
    if (filters.start) query = query.gte('start_date', filters.start);
    if (filters.end) query = query.lte('start_date', filters.end);
    if (filters.agency) query = query.eq('case_agencies.agencies.normalized_name', filters.agency);
    if (filters.status) query = query.eq('case_status', filters.status);

    if (filters.jobType) {
      query = query.or(
        `soc_code.eq.${filters.jobType},soc_code.like.${filters.jobType}.%`
      );
    }

    return query
      .order('case_num', { ascending: false })
      .limit(filters.limit);
  });

  if (error) throw error;

  return {
    rows: (data || []).map(mapCaseRow_),
    matched: count ?? 0,
    returned: data?.length || 0
  };
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
      <td class="ellipsis" title="${GlobalQueryUI.escapeHtml_(row.caseNum || '')}">${GlobalQueryUI.escapeHtml_(row.caseNum || '—')}</td>
      <td class="ellipsis" title="${GlobalQueryUI.escapeHtml_(row.employer || '')}"> ${row.fein 
        ? `<button type="button" class="case-employer-link" data-employer-fein="${GlobalQueryUI.escapeHtml_(row.fein)}" title="View employer details" >
          ${GlobalQueryUI.escapeHtml_(row.employer || '—')}
          </button>`
        : GlobalQueryUI.escapeHtml_(row.employer || '—')
        }
      </td>
      <td>${GlobalQueryUI.formatShortDate(row.start)} – ${GlobalQueryUI.formatShortDate(row.end)}</td>
      <td class="ellipsis" title="${GlobalQueryUI.escapeHtml_(row.displayAgency || row.agency || '')}">${GlobalQueryUI.escapeHtml_(row.displayAgency || row.agency || '—')}</td>
    </tr>
  `).join('') || '<tr><td colspan="4" class="muted">No matching cases.</td></tr>';
}

async function loadAgencyDropdown() {
  const select = document.getElementById('filterAgent');
  select.disabled = true;
  select.innerHTML = '<option value="">Loading agencies…</option>';

  try {
    const { data, error } = await window.withSupabaseRetry_(() =>
      window.globalQuerySupabase
        .from('agencies')
        .select('normalized_name,display_name').order('display_name')
    );
    
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
    const { data, error } = await window.withSupabaseRetry_(() =>
      window.globalQuerySupabase
        .from('case_job_types')
        .select('soc_code,job_title')
        .order('job_title')
    );

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
    const { data, error } = await window.withSupabaseRetry_(() =>
      window.globalQuerySupabase
        .from('case_statuses')
        .select('case_status')
        .order('case_status')
    );

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
  const isCase = mode === 'case';
  const is790 = mode === '790';
  const isChurn = mode === 'churn';
  const isEmployer = mode === 'employer';

  document.getElementById('modalBusinessJobSection')?.classList.toggle('hidden', !(isCase || is790));
  document.getElementById('modalJobDescriptionSection')?.classList.toggle('hidden', !(isCase || is790));
  document.getElementById('modalAdditionalRequirementsSection')?.classList.toggle('hidden', !is790);
  document.getElementById('modalActionRow')?.classList.toggle('hidden', !isCase);
  document.getElementById('modalChurnInfoPanel')?.classList.toggle('hidden', !isChurn);
  document.getElementById('modalEmployerPanel')?.classList.toggle('hidden', !isEmployer);
}

function openCaseModal(caseRow, mode = 'case') {
  if (!caseRow) return;

  activeCaseModalRow = caseRow;
  setCaseModalMode_(mode);
  setCaseModalView_('details');

  const modal = document.getElementById('detailModalOverlay');
  const churnPanel = document.getElementById('modalChurnInfoPanel');
  const churnBanner = document.getElementById('churnBanner');

  document.getElementById('modalChurnInfo').innerHTML = '';
  churnPanel.classList.add('hidden');
  churnBanner.className = 'churn-banner hidden';
  churnBanner.innerHTML = '';
  document.getElementById('detailModalTitle').textContent = caseRow.caseNum || 'Case';
  const employerSubtitle = document.getElementById('detailModalEmployer');

  if (mode === 'case' && caseRow.fein) {
    employerSubtitle.innerHTML = `
      <button type="button" class="modal-employer-link" data-employer-fein="${GlobalQueryUI.escapeHtml_(caseRow.fein)}" title="View employer details">
        ${GlobalQueryUI.escapeHtml_(caseRow.employer || '—')}
      </button>
    `;
  } else {
    employerSubtitle.textContent = caseRow.employer || '—';
  }

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
      ['NAICS Code', GlobalQueryUI.escapeHtml_(caseRow.naicsCode || '—')],
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
  GlobalQueryUI.updateModalScrollLock_();
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
  clearCaseModal_();
  GlobalQueryUI.updateModalScrollLock_();
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
        naics_code,
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
          naics_code,
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

    const { data, error, count } = await withSupabaseRetry_(() => query);

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

  document.querySelector('#casesTable tbody').addEventListener('click', async event => {
    const employerLink = event.target.closest('[data-employer-fein]');

    if (employerLink) {
      event.stopPropagation();

      if (typeof window.openEmployerDetail === 'function') {
        window.openEmployerDetail(employerLink.dataset.employerFein);
      }

      return;
    }

    const row = event.target.closest('tr[data-case]');
    if (!row) return;

    await openCaseDetailByNumber_(row.dataset.case);
  });

  document.getElementById('detailModalEmployer')
    .addEventListener('click', event => {
      const employerLink = event.target.closest('[data-employer-fein]');
      if (!employerLink) return;

      if (typeof window.openEmployerDetail === 'function') {
        window.openEmployerDetail(employerLink.dataset.employerFein);
      }
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

  document.getElementById('jobScanBtn').addEventListener('click', openExtractedCaseView_);

  document.getElementById('backToCaseBtn').addEventListener('click', () => {
    setCaseModalView_('details');
  });

  initializeJobOrderTabs_();

  document.getElementById('downloadCsvButton').addEventListener('click', downloadFilteredGlobalQueryCases);
}

async function initializeCases() {
  if (casesInitialized) return;
  casesInitialized = true;

  GlobalQueryUI.populateStateDropdown();
  bindCaseEvents_();

  loadInitialCases_();

  Promise.all([
    loadAgencyDropdown(),
    loadJobTypeDropdown(),
    loadStatusDropdown()
  ]).catch(error => {
    console.error('Could not finish loading case filters:', error);
  });
}

window.initializeCases = initializeCases;
window.applyCaseFilters = applyCaseFilters;
window.openCaseModal = openCaseModal;
