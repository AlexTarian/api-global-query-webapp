pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
let currentNod = null;
let nodInitialized = false;
let nodRagCache = null;
let nodRagLoadingPromise = null;
let pendingNodDraftMode = null;


// ==================== STATE ====================

function createEmptyNodState_() {
  return {
    file: null,
    fileName: '',
    documentType: '',
    title: '',
    noticeDate: '',
    dueDate: '',
    caseNumber: '',
    caseKey: '',
    employerName: '',
    caseSource: '',
    caseData: null,
    parseMetadata: null,
    activeDeficiencyIndex: 0,
    deficiencies: []
  };
}


function setCurrentNod_(nod) {
  currentNod = nod || createEmptyNodState_();
  renderNodWorkspace_();
}


function clearCurrentNod_() {
  setCurrentNod_(createEmptyNodState_());

  const input = document.getElementById('nodFileInput');
  if (input) input.value = '';

  document.getElementById('nodUploadStatus').textContent = 'No NOD loaded.';
}


// ==================== FILE HANDLING ====================

async function parseNodPdf_(file) {
  const status = document.getElementById('nodUploadStatus');
  const startedAt = performance.now();

  status.textContent = `Reading ${file.name}...`;

  const bytes = new Uint8Array(await file.arrayBuffer());

  if (!looksLikePdf_(bytes)) {
    throw new Error('The selected file does not appear to be a valid PDF.');
  }

  const loadingTask = pdfjsLib.getDocument({ data: bytes });
  const pdf = await loadingTask.promise;

  const pages = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
    status.textContent = `Reading ${file.name}... page ${pageNumber} of ${pdf.numPages}`;

    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();

    const text = extractPdfPageText_(content.items);

    pages.push(text);

    page.cleanup();
  }

  await pdf.destroy();

  const text = pages.join('\n\n');
  const extractionMs = Math.round(performance.now() - startedAt);

  const result = {
    fileName: file.name,
    fileSizeBytes: file.size,
    pageCount: pages.length,
    textLength: text.length,
    extractionMs,
    text
  };

  console.log('NOD PDF extraction result:', {
    fileName: result.fileName,
    fileSizeBytes: result.fileSizeBytes,
    pageCount: result.pageCount,
    textLength: result.textLength,
    extractionMs: result.extractionMs
  });

  return result;
}


function looksLikePdf_(bytes) {
  if (!bytes || bytes.length < 5) return false;

  return (
    bytes[0] === 0x25 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x44 &&
    bytes[3] === 0x46 &&
    bytes[4] === 0x2D
  );
}

function extractPdfPageText_(items) {
  const lines = [];
  let currentLine = '';
  let lastY = null;
  let lastXEnd = null;

  for (const item of items || []) {
    const text = String(item?.str || '');
    if (!text) continue;

    const x = item?.transform?.[4];
    const y = item?.transform?.[5];
    const width = Number(item?.width) || 0;

    const isNewLine =
      lastY !== null &&
      Number.isFinite(y) &&
      Math.abs(y - lastY) > 2;

    if (isNewLine) {
      if (currentLine.trim()) {
        lines.push(currentLine.trim());
      }

      currentLine = '';
      lastXEnd = null;
    }

    if (!currentLine) {
      currentLine = text;
    } else {
      const gap =
        Number.isFinite(x) && Number.isFinite(lastXEnd)
          ? x - lastXEnd
          : null;

      const fragmentsTouch =
        gap !== null &&
        gap <= 1.5;

      if (
        fragmentsTouch ||
        currentLine.endsWith(' ') ||
        text.startsWith(' ')
      ) {
        currentLine += text;
      } else {
        currentLine += ` ${text}`;
      }
    }

    if (Number.isFinite(x)) {
      lastXEnd = x + width;
    }

    if (Number.isFinite(y)) {
      lastY = y;
    }

    if (item.hasEOL) {
      if (currentLine.trim()) {
        lines.push(currentLine.trim());
      }

      currentLine = '';
      lastXEnd = null;
      lastY = null;
    }
  }

  if (currentLine.trim()) {
    lines.push(currentLine.trim());
  }

  return lines.join('\n');
}

async function handleNodFile_(file) {
  if (!file) return;

  const status = document.getElementById('nodUploadStatus');

  if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
    status.textContent = 'Please choose a PDF file.';
    return;
  }

  const nod = createEmptyNodState_();

  nod.file = file;
  nod.fileName = file.name;

  try {
    const result = await parseNodPdf_(file);
    const parsed = parseNodText(result.text);

    const caseKey = normalizeNodCaseKey_(parsed.caseNumber);
    const caseMatch = await matchNodCase_(parsed.caseNumber, caseKey);

    console.log('Parsed NOD:', parsed);

    setCurrentNod_({
      ...nod,
      documentType: parsed.documentType || '',
      title: parsed.title || '',
      noticeDate: parsed.date || '',
      dueDate: calculateNodDueDate_(parsed.date),
      caseNumber: parsed.caseNumber || '',
      caseKey,
      employerName: caseMatch.data?.employer || parsed.employerName || '',
      caseSource: caseMatch.source,
      caseData: caseMatch.data,
      parseMetadata: parsed.parseMetadata || null,
      activeDeficiencyIndex: 0,
      deficiencies: prepareNodDeficiencies_(parsed.deficiencies || [])
    });

    await loadRagForAllDeficiencies_();

    const matchText = caseMatch.source
      ? ` Matched case data from ${caseMatch.source}.`
      : ' No matching GlobalQuery case data was found.';

    status.textContent =
      `${file.name}: parsed ${parsed.deficiencyCount.toLocaleString()} ` +
      `deficienc${parsed.deficiencyCount === 1 ? 'y' : 'ies'} from ` +
      `${result.pageCount.toLocaleString()} page${result.pageCount === 1 ? '' : 's'}.` +
      matchText;

  } catch (error) {
    status.textContent = `Could not read ${file.name}.`;
    console.error('Could not parse NOD PDF:', error);
  }
}

function parseNodText(text, subjectCaseNumber = null) {
  text = normalizeNodPdfText_(text);

  const documentType = detectDocumentType(text);
  const title = extractTitle(text);
  const date = extractDate(text);
  const employerName = extractEmployerName(text);

  const allCaseNumbers = extractCaseNumbers(text);
  const pdfCaseNumber = allCaseNumbers.length ? allCaseNumbers[0] : null;
  const caseNumber = subjectCaseNumber || pdfCaseNumber;

  const enclosure = extractEnclosureSection(text);
  const searchRegion = enclosure || text;
  const deficiencyBlocks = splitDeficiencyBlocks(searchRegion);
  const parsedDeficiencies = deficiencyBlocks.map(parseDeficiencyBlock);

  const enclosureExact = enclosure != null;
  const deficiencyHeadingExact = deficiencyBlocks.length
    ? deficiencyBlocks.every(block => !!block.headingExact)
    : false;
  const documentStructureExact = enclosureExact && deficiencyHeadingExact;

  return {
    documentType,
    title,
    date,
    caseNumber,
    pdfCaseNumbersFound: allCaseNumbers,
    employerName,
    parseMetadata: {
      enclosureExact,
      deficiencyHeadingExact,
      documentStructureExact,
    },
    deficiencyCount: parsedDeficiencies.length,
    deficiencies: parsedDeficiencies,
  };
}

function normalizeNodPdfText_(text = '') {
  if (!text) return '';

  text = String(text)
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')

    // Normalize non-breaking / unusual spaces.
    .replace(/[\u00A0\u1680\u2000-\u200B\u202F\u205F\u3000]/g, ' ')

    // Normalize spaced case numbers.
    .replace(
      /\b([A-Z])\s*-\s*(\d{3})\s*-\s*(\d{5})\s*-\s*(\d{6})\b/g,
      '$1-$2-$3-$4'
    )

    // Fix common PDF.js split-letter artifacts.
    .replace(/\bA pplication\b/g, 'Application')
    .replace(/\bT emporary\b/g, 'Temporary')
    .replace(/\bE mployment\b/g, 'Employment')
    .replace(/\bC ertification\b/g, 'Certification')

    // Collapse horizontal whitespace but preserve line breaks.
    .replace(/[ \t]+/g, ' ')

    // Remove spaces around line breaks.
    .replace(/ *\n */g, '\n')

    // Collapse excessive blank lines.
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return text;
}

function normalizeNodCaseKey_(caseNumber) {
  return String(caseNumber || '')
    .trim()
    .toUpperCase()
    .replace(/^H-300-/, '')
    .replace(/^JO-A-300-/, '');
}

function detectDocumentType(text = '') {
  const firstChunk = text.slice(0, 3000).toLowerCase();

  if (firstChunk.includes('notice of deficiency')) return 'NOD';
  if (firstChunk.includes('notice of acceptance')) return 'NOA';
  if (firstChunk.includes('final determination')) return 'FINAL_DETERMINATION';
  return 'UNKNOWN';
}

function extractTitle(text = '') {
  const lines = text
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);

  for (const line of lines.slice(0, 15)) {
    const low = line.toLowerCase();
    if (low.includes('notice of deficiency')) return line;
    if (low.includes('notice of acceptance')) return line;
    if (low.includes('final determination')) return line;
  }

  return null;
}

function extractDate(text = '') {
  const match = text.match(
    /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+\d{4}\b/i
  );
  return match ? match[0] : null;
}

function calculateNodDueDate_(noticeDate) {
  if (!noticeDate) return '';

  const date = new Date(noticeDate);

  if (Number.isNaN(date.getTime())) return '';

  let remaining = 5;

  while (remaining > 0) {
    date.setDate(date.getDate() + 1);

    const day = date.getDay();

    if (day !== 0 && day !== 6) {
      remaining--;
    }
  }

  return date.toISOString().slice(0, 10);
}

function extractEmployerName(text = '') {
  let match = text.match(/^\s*RE:\s*(.+?)\s*$/mi);
  if (match) return match[1].trim();

  match = text.match(/^\s*Re:\s*(.+?)\s*$/mi);
  if (match) return match[1].trim();

  return null;
}

function extractCaseNumbers(text = '') {
  if (!text) return [];

  const matches = text.match(/H-\d{3}-\d{5}-\d{6}/g) || [];
  const seen = new Set();
  const ordered = [];

  for (const m of matches) {
    if (!seen.has(m)) {
      seen.add(m);
      ordered.push(m);
    }
  }

  return ordered;
}

function extractEnclosureSection(text = '') {
  if (!text) return null;

  // Best case: exact heading
  let match = text.match(/ENCLOSURE\s+FOR\s+UNACCEPTABLE\s+APPLICATIONS(.*)$/is);
  if (match) return match[1].trim();

  // Last resort: start at the first deficiency block anywhere in the doc
  match = text.match(/\bDeficiency(?:\s+#?\s*\d+)?\s*:\s*.*/i);
  if (match && match.index != null) {
    return text.slice(match.index).trim();
  }

  return null;
}

function splitDeficiencyBlocks(enclosureText = '') {
  if (!enclosureText) return [];

  const pattern =
  /\bDeficiency(?:\s+#?\s*(\d+))?\s*:\s*(.*?)(?=\s*Applicable Regulatory Citations?\s*:|\s*In accordance with|\n|$)/gi;
  const matches = [...enclosureText.matchAll(pattern)];
  const blocks = [];

  for (let i = 0; i < matches.length; i++) {
    const match = matches[i];
    const deficiencyNumber = match[1] ? Number(match[1]) : blocks.length + 1;
    let deficiencyType = (match[2] || '').trim() || null;

    if (deficiencyType) {
      deficiencyType = deficiencyType
        .replace(/\s*Applicable Regulatory Citations?\s*:.*$/i, '')
        .replace(/\s*Modification Required\s*:.*$/i, '')
        .replace(/\s*In accordance with Departmental regulations.*$/i, '')
        .trim() || null;
    }

    const headingExact = match[1] != null;

    const start = match.index + match[0].length;
    const end = i + 1 < matches.length ? matches[i + 1].index : enclosureText.length;
    const body = enclosureText.slice(start, end).trim();

    blocks.push({
      number: deficiencyNumber,
      type: deficiencyType,
      rawBody: body,
      headingText: match[0].trim(),
      headingExact,
    });
  }

  return blocks;
}

function extractCitations(text = '') {
  if (!text) return [];

  const matches = text.match(
    /(?:20\s*CFR\s*)?§?\s*\d{3}\.\d+(?:\([a-zA-Z0-9]+\))*/g
  ) || [];

  const seen = new Set();
  const citations = [];

  for (const match of matches) {
    const cleaned = match
      .replace(/\s+/g, ' ')
      .replace(/^§\s*/, '')
      .trim();

    const normalized = cleaned.startsWith('20 CFR')
      ? cleaned
      : `20 CFR § ${cleaned}`;

    if (!seen.has(normalized)) {
      seen.add(normalized);
      citations.push(normalized);
    }
  }

  return citations;
}

function parseDeficiencyBlock(block) {
  const rawBody = block.rawBody || '';
  const parseSignals = [];

  let citations = extractCitations(rawBody);
  let citationSection = '';
  let context = '';
  let modificationRequired = '';

  const modMatch = rawBody.match(/Modification Required\s*:?\s*/i);
  let preModText = rawBody.trim();
  let postModText = '';

  if (modMatch && modMatch.index != null) {
    preModText = rawBody.slice(0, modMatch.index).trim();
    postModText = rawBody.slice(modMatch.index + modMatch[0].length).trim();
    modificationRequired = postModText;
    parseSignals.push('modification_label_exact');
  } else {
    const employerMustMatch = rawBody.match(/\bThe employer must\b.*/is);
    if (employerMustMatch && employerMustMatch.index != null) {
      modificationRequired = employerMustMatch[0].trim();
      preModText = rawBody.slice(0, employerMustMatch.index).trim();
      parseSignals.push('modification_label_missing_employer_must_fallback');
    } else {
      parseSignals.push('modification_section_missing');
    }
  }

  const citationLabelMatch = rawBody.match(/Applicable Regulatory Citations?\s*:\s*(.*)/is);

  if (citationLabelMatch) {
    const remainder = citationLabelMatch[1] || '';

    if (modMatch) {
      const relativeMod = remainder.match(/Modification Required\s*:?\s*/i);
      if (relativeMod && relativeMod.index != null) {
        citationSection = remainder.slice(0, relativeMod.index).trim();
      } else {
        citationSection = remainder.slice(0, 1000).trim();
      }
    } else {
      citationSection = remainder.slice(0, 1000).trim();
    }

    const labeledCitations = extractCitations(citationSection);

    if (labeledCitations.length) {
      citations = labeledCitations;
      parseSignals.push('citation_label_exact');
    } else if (citations.length) {
      parseSignals.push('citation_label_exact_full_block_fallback');
    } else {
      parseSignals.push('citation_section_missing');
    }
  } else {
    if (citations.length) {
      parseSignals.push('citation_label_missing_full_block_fallback');
    } else {
      parseSignals.push('citation_section_missing');
    }
  }

  const contextStart = preModText.match(/In accordance with Departmental regulations.*/is);

  if (contextStart) {
    context = contextStart[0].trim();
    parseSignals.push('context_phrase_exact');
  } else {
    if (citationLabelMatch) {
      const citationLabelInPreMod = preModText.match(/Applicable Regulatory Citations?\s*:.*$/is);
      if (citationLabelInPreMod && citationLabelInPreMod.index != null) {
        context = preModText
          .slice(citationLabelInPreMod.index + citationLabelInPreMod[0].length)
          .trim();
      } else {
        context = preModText.trim();
      }
    } else {
      context = preModText.trim();
    }

    if (context) {
      parseSignals.push('context_phrase_missing_structural_fallback');
    } else {
      parseSignals.push('context_section_missing');
    }
  }

  if (modificationRequired && context && context.includes(modificationRequired)) {
    context = context.replace(modificationRequired, '').trim();
  }

  let score = 0;
  if (parseSignals.includes('citation_label_exact')) score += 2;
else if (
  parseSignals.includes('citation_label_missing_full_block_fallback') ||
  parseSignals.includes('citation_label_exact_full_block_fallback')
) score += 1;

  if (parseSignals.includes('modification_label_exact')) score += 2;
  else if (parseSignals.includes('modification_label_missing_employer_must_fallback')) score += 1;

  if (parseSignals.includes('context_phrase_exact')) score += 2;
  else if (parseSignals.includes('context_phrase_missing_structural_fallback')) score += 1;

  if (citations.length) score += 1;
  if (modificationRequired) score += 1;
  if (context) score += 1;

  let parseConfidence = 'low';
  if (score >= 7) parseConfidence = 'high';
  else if (score >= 4) parseConfidence = 'medium';

  const citationExact = parseSignals.includes('citation_label_exact');
  const contextExact = parseSignals.includes('context_phrase_exact');
  const modificationExact = parseSignals.includes('modification_label_exact');
  const allExact = citationExact && contextExact && modificationExact;

  return {
    number: block.number,
    type: block.type,
    citations,
    context,
    modificationRequired,
    parseSignals,
    parseConfidence,
    exactMatch: {
      citations: citationExact,
      context: contextExact,
      modificationRequired: modificationExact,
      all: allExact,
    },
  };
}


// ==================== ENRICH ====================

function prepareNodDeficiencies_(deficiencies = []) {
  return deficiencies.map(deficiency => ({
    ...deficiency,

    rag: {
      employerData: null,
      cfrResults: [],
      similarDeficiencies: [],
      interpretationResults: [],
      caseLawResults: []
    },

    draftResponse: '',
    customInstructions: ''
  }));
}


// ==================== MATCH ====================

async function matchNodCase_(caseNumber, caseKey) {
  const jobOrder = await findNod790Case_(caseKey);

  if (jobOrder) {
    return {
      source: '790 Snapshot',
      data: jobOrder
    };
  }

  const mainCase = await findNodMainCase_(caseNumber);

  if (mainCase) {
    return {
      source: 'GlobalQuery',
      data: mainCase
    };
  }

  return {
    source: '',
    data: null
  };
}


async function findNod790Case_(caseKey) {
  if (!caseKey) return null;

  const { data, error } = await window.globalQuerySupabase
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
    `)
    .eq('case_key', caseKey)
    .maybeSingle();

  if (error) throw error;

  if (!data) return null;

  return {
    caseNum: data.joa_case_number || '',
    caseKey: data.case_key || '',
    employer: data.employer_name || '',
    fein: data.fein || '',
    state: data.employer_state || '',
    address: data.address || '',
    contact: data.contact || '',
    phone: data.phone || '',
    contactEmail: data.contact_email || '',
    additionalEmail: data.additional_email || '',
    jobTitle: data.job_title || '',
    start: data.start_date || '',
    end: data.end_date || '',
    workers: data.workers ?? '',
    cert: data.cert_required || '',
    drive: data.drive_required || '',
    desc: data.job_description || ''
  };
}


async function findNodMainCase_(caseNumber) {
  if (!caseNumber) return null;

  const { data, error } = await window.globalQuerySupabase
    .from('cases_with_occupation')
    .select(caseSelect_(false))
    .eq('case_num', caseNumber)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  return mapCaseRow_(data);
}


// ==================== RAG ====================

async function loadNodRagCache_() {
  if (nodRagCache) return nodRagCache;
  if (nodRagLoadingPromise) return nodRagLoadingPromise;

  nodRagLoadingPromise = (async () => {
    const client = window.globalQuerySupabase;

    const [
      deficienciesResult,
      cfrResult,
      interpretationsResult,
      caseLawResult,
      promptConfigResult
    ] = await Promise.all([
      client
        .from('nod_rag_deficiencies')
        .select(`
          id,
          case_number,
          employer,
          job_type,
          deficiency_number,
          deficiency_category,
          deficiency_type,
          applicable_regulatory_citations,
          context,
          modification_required,
          response_paragraph,
          attachments_needed,
          outcome_reviewer_note
        `),

      client
        .from('nod_rag_cfr')
        .select(`
          id,
          regulation_number,
          text,
          summary
        `),

      client
        .from('nod_rag_interpretations')
        .select(`
          id,
          regulation,
          topic,
          summary,
          dol_misreading,
          response_strategy,
          when_to_use,
          related_case_law,
          notes
        `),

      client
        .from('nod_rag_case_law')
        .select(`
          id,
          case_name,
          keywords,
          takeaway
        `),

      client
        .from('nod_prompt_config')
        .select(`
          key,
          value,
          enabled,
          notes
        `)
        .eq('enabled', true)
    ]);

    const results = [
      ['deficiencies', deficienciesResult],
      ['cfr', cfrResult],
      ['interpretations', interpretationsResult],
      ['case law', caseLawResult],
      ['prompt config', promptConfigResult]
    ];

    for (const [label, result] of results) {
      if (result.error) {
        throw new Error(`Could not load NOD ${label}: ${result.error.message}`);
      }
    }

    const promptConfig = {};

    for (const row of promptConfigResult.data || []) {
      if (row.key) {
        promptConfig[row.key] = row.value ?? '';
      }
    }

    nodRagCache = {
      deficiencies: deficienciesResult.data || [],
      cfr: cfrResult.data || [],
      interpretations: interpretationsResult.data || [],
      caseLaw: caseLawResult.data || [],
      promptConfig
    };

    console.log('NOD RAG cache loaded:', {
      deficiencies: nodRagCache.deficiencies.length,
      cfr: nodRagCache.cfr.length,
      interpretations: nodRagCache.interpretations.length,
      caseLaw: nodRagCache.caseLaw.length,
      promptConfig: Object.keys(promptConfig).length
    });

    return nodRagCache;
  })();

  try {
    return await nodRagLoadingPromise;
  } finally {
    nodRagLoadingPromise = null;
  }
}

function normalizeRagText_(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/§/g, '')
    .replace(/[^a-z0-9.()]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}


function normalizeRagDeficiencyType_(value) {
  return normalizeRagText_(value)
    .replace(/\bnotice of deficiency\b/g, '')
    .replace(/\bdeficiency\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseRagKeywords_(value) {
  return String(value || '')
    .split(/[,;|\n]+/)
    .map(keyword => normalizeRagText_(keyword))
    .filter(Boolean);
}

function matchesRagKeyword_(sourceText, keyword) {
  const source = normalizeRagText_(sourceText);
  const target = normalizeRagText_(keyword);

  if (!source || !target) return false;

  return (
    source === target ||
    source.includes(target) ||
    target.includes(source)
  );
}

function tokenizeRagText_(value) {
  const stopWords = new Set([
    'the', 'and', 'for', 'that', 'with', 'this', 'from',
    'must', 'will', 'shall', 'into', 'your', 'their',
    'employer', 'application', 'job', 'order', 'provide',
    'required', 'requirement', 'requirements'
  ]);

  return new Set(
    normalizeRagText_(value)
      .split(' ')
      .filter(word => word.length >= 4 && !stopWords.has(word))
  );
}


function countRagOverlap_(a, b) {
  const left = tokenizeRagText_(a);
  const right = tokenizeRagText_(b);

  let score = 0;

  for (const word of left) {
    if (right.has(word)) score++;
  }

  return score;
}

function findNodCfrResults_(deficiency, cache) {
  const citations = Array.isArray(deficiency.citations)
    ? deficiency.citations
    : [];

  const normalizedCitations = citations
    .map(normalizeRagCitation_)
    .filter(Boolean);

  if (!normalizedCitations.length) return [];

  return cache.cfr
    .filter(row => {
      const regulation = normalizeRagCitation_(row.regulation_number);

      if (!regulation) return false;

      return normalizedCitations.some(citation => {
        if (!citation) return false;

        return (
          regulation === citation ||
          regulation.startsWith(citation) ||
          citation.startsWith(regulation)
        );
      });
    })
    .slice(0, 3)
    .map(row => ({
      ...row,
      title: row.regulation_number || 'CFR Result'
    }));
}

function normalizeRagCitation_(value) {
  return String(value || '')
    .toUpperCase()
    .replace(/20\s*CFR/g, '')
    .replace(/[^0-9A-Z().-]/g, '')
    .trim();
}

function findSimilarNodDeficiencies_(deficiency, cache) {
  const targetType = normalizeRagDeficiencyType_(deficiency.type);
  const targetModification = deficiency.modificationRequired || '';
  const targetContext = deficiency.context || '';

  const scored = cache.deficiencies.map(row => {
    const rowType = normalizeRagDeficiencyType_(
      row.deficiency_type || row.deficiency_category
    );

    const typeExact =
      targetType &&
      rowType &&
      targetType === rowType;

    const typeRelated =
      targetType &&
      rowType &&
      (
        targetType.includes(rowType) ||
        rowType.includes(targetType)
      );

    const modificationScore = countRagOverlap_(
      targetModification,
      row.modification_required
    );

    const contextScore = countRagOverlap_(
      targetContext,
      row.context
    );

    const score =
      (typeExact ? 100 : typeRelated ? 50 : 0) +
      (modificationScore * 4) +
      contextScore;

    return {
      ...row,
      _score: score,
      _typeExact: typeExact,
      _typeRelated: typeRelated
    };
  });

  return scored
    .filter(row => row._score > 0)
    .sort((a, b) => {
      if (a._typeExact !== b._typeExact) {
        return Number(b._typeExact) - Number(a._typeExact);
      }

      if (a._typeRelated !== b._typeRelated) {
        return Number(b._typeRelated) - Number(a._typeRelated);
      }

      return b._score - a._score;
    })
    .slice(0, 3)
    .map(row => ({
      ...row,
      title:
        row.deficiency_type ||
        row.deficiency_category ||
        `Case ${row.case_number || ''}`.trim()
    }));
}

function findNodInterpretations_(deficiency, cache) {
  const citations = (deficiency.citations || [])
    .map(normalizeRagCitation_)
    .filter(Boolean);

  // Primary: regulatory citation -> Regulation column.
  const citationMatches = cache.interpretations.filter(row => {
    const regulation = normalizeRagCitation_(row.regulation);
    if (!regulation) return false;

    return citations.some(citation =>
      citation === regulation ||
      citation.startsWith(regulation) ||
      regulation.startsWith(citation)
    );
  });

  if (citationMatches.length) {
    return citationMatches
      .slice(0, 2)
      .map(row => ({
        ...row,
        title: row.topic || row.regulation || 'Interpretation Note',
        _matchReason: 'citation'
      }));
  }

  // Fallback: Deficiency Type -> Topic column.
  const deficiencyType = normalizeRagDeficiencyType_(deficiency.type);
  if (!deficiencyType) return [];

  const topicMatches = cache.interpretations.filter(row => {
    const topic = normalizeRagDeficiencyType_(row.topic);
    if (!topic) return false;

    return (
      topic === deficiencyType ||
      topic.includes(deficiencyType) ||
      deficiencyType.includes(topic)
    );
  });

  return topicMatches
    .slice(0, 2)
    .map(row => ({
      ...row,
      title: row.topic || row.regulation || 'Interpretation Note',
      _matchReason: 'topic'
    }));
}

function findNodCaseLaw_(deficiency, cache) {
  const deficiencyType = deficiency.type || '';

  // Primary: Deficiency Type -> Keywords.
  const typeMatches = cache.caseLaw.filter(row => {
    const keywords = parseRagKeywords_(row.keywords);

    return keywords.some(keyword =>
      matchesRagKeyword_(deficiencyType, keyword)
    );
  });

  if (typeMatches.length) {
    return typeMatches
      .slice(0, 2)
      .map(row => ({
        ...row,
        title: row.case_name || 'Case Law',
        _matchReason: 'deficiency_type'
      }));
  }

  // Fallback: Modification Required -> Keywords.
  const modificationRequired = deficiency.modificationRequired || '';
  if (!modificationRequired) return [];

  const modificationMatches = cache.caseLaw.filter(row => {
    const keywords = parseRagKeywords_(row.keywords);

    return keywords.some(keyword =>
      matchesRagKeyword_(modificationRequired, keyword)
    );
  });

  return modificationMatches
    .slice(0, 2)
    .map(row => ({
      ...row,
      title: row.case_name || 'Case Law',
      _matchReason: 'modification_required'
    }));
}

async function loadRagForDeficiency_(index) {
  const deficiency = currentNod?.deficiencies?.[index];
  if (!deficiency) return;

  const cache = await loadNodRagCache_();

  deficiency.rag = {
    employerData: currentNod.caseData || null,
    cfrResults: findNodCfrResults_(deficiency, cache),
    similarDeficiencies: findSimilarNodDeficiencies_(deficiency, cache),
    interpretationResults: findNodInterpretations_(deficiency, cache),
    caseLawResults: findNodCaseLaw_(deficiency, cache)
  };

  console.log(`RAG loaded for deficiency ${deficiency.number}:`, {
    cfr: deficiency.rag.cfrResults.length,
    similarDeficiencies: deficiency.rag.similarDeficiencies.length,
    interpretations: deficiency.rag.interpretationResults.length,
    caseLaw: deficiency.rag.caseLawResults.length
  });

  if (index === currentNod.activeDeficiencyIndex) {
    renderNodRagInfo_();
  }
}

async function loadRagForAllDeficiencies_() {
  if (!currentNod?.deficiencies?.length) return;

  await loadNodRagCache_();

  for (let index = 0; index < currentNod.deficiencies.length; index++) {
    await loadRagForDeficiency_(index);
  }
}


// ==================== DRAFT CONTEXT ====================

function normalizeDraftText_(value) {
  if (value == null) return '';
  return String(value).replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
}

function removeEmptyDraftFields_(obj) {
  return Object.fromEntries(
    Object.entries(obj).filter(([, value]) => {
      if (value == null) return false;
      if (typeof value === 'string' && !value.trim()) return false;
      return true;
    })
  );
}

function getLastDraftContextParagraph_(context = '') {
  const normalized = normalizeDraftText_(context);
  if (!normalized) return '';

  const paragraphs = normalized
    .split(/\n\s*\n/)
    .map(paragraph => paragraph.trim())
    .filter(Boolean);

  return paragraphs.length
    ? paragraphs[paragraphs.length - 1]
    : normalized;
}

function buildCaseIssueText_(deficiencyType = '', context = '', modificationRequired = '') {
  return [
    normalizeDraftText_(deficiencyType),
    getLastDraftContextParagraph_(context),
    normalizeDraftText_(modificationRequired)
  ].filter(Boolean).join('\n\n');
}

const DRAFT_FEIN_TERMS = new Set(['fein']);
const DRAFT_MEAL_TERMS = new Set(['meal', 'meals']);
const DRAFT_HOUSING_TERMS = new Set(['housing', 'lodging']);

const DRAFT_REQUIREMENT_TERMS = new Set([
  'requirement', 'requirements',
  'qualification', 'qualifications',
  'driving', 'driver', 'drive', 'cdl'
]);

const DRAFT_WAGE_TERMS = new Set([
  'wage', 'wages', 'aewr',
  'piece rate', 'hourly', 'salary', 'pay rate'
]);

const DRAFT_TRANSPORTATION_TERMS = new Set([
  'transportation', 'subsistence', 'inbound', 'outbound'
]);

const DRAFT_WORKSITE_TERMS = new Set([
  'worksite', 'worksites', 'work sites',
  'place of employment', 'county'
]);

const DRAFT_JOB_SUPPORT_TERMS = new Set([
  'temporary need', 'seasonality',
  'temporary or seasonal need',
  'temporary', 'seasonal',
  'agricultural', 'nature of the job'
]);

const DRAFT_JOB_DUTIES_TERMS = new Set([
  'job duties', 'job duty', 'job description'
]);

function hasAnyDraftTerm_(searchable, terms) {
  for (const term of terms) {
    if (searchable.includes(term)) return true;
  }

  return false;
}

function getDraftDeficiencyFlags_(deficiencyType = '', issueText = '') {
  const searchable =
    `${normalizeDraftText_(deficiencyType)} ${normalizeDraftText_(issueText)}`
      .toLowerCase();

  return {
    includeJobSupport: hasAnyDraftTerm_(searchable, DRAFT_JOB_SUPPORT_TERMS),
    includeJobDuties: hasAnyDraftTerm_(searchable, DRAFT_JOB_DUTIES_TERMS),
    includeFein: hasAnyDraftTerm_(searchable, DRAFT_FEIN_TERMS),
    includeWage: hasAnyDraftTerm_(searchable, DRAFT_WAGE_TERMS),
    includeRequirements: hasAnyDraftTerm_(searchable, DRAFT_REQUIREMENT_TERMS),
    includeWorksite: hasAnyDraftTerm_(searchable, DRAFT_WORKSITE_TERMS),
    includeHousing: hasAnyDraftTerm_(searchable, DRAFT_HOUSING_TERMS),
    includeMeals: hasAnyDraftTerm_(searchable, DRAFT_MEAL_TERMS),
    includeTransportation: hasAnyDraftTerm_(searchable, DRAFT_TRANSPORTATION_TERMS)
  };
}

function normalizeNodEmployerDataForDraft_(caseData = {}) {
  if (!caseData) return {};

  const start = caseData.start || '';
  const end = caseData.end || '';

  return removeEmptyDraftFields_({
    caseNumber: currentNod?.caseNumber || caseData.caseNum || '',
    businessName: caseData.employer || currentNod?.employerName || '',
    fein: caseData.fein || '',

    jobTitle: caseData.jobTitle || caseData.jobType || '',
    jobDescription: caseData.desc || '',
    workersRequested: caseData.workers ?? '',

    periodOfNeedStart: start,
    periodOfNeedEnd: end,
    periodOfNeedLabel:
      start || end
        ? `${GlobalQueryUI.formatDate(start)} – ${GlobalQueryUI.formatDate(end)}`
        : '',

    certificationRequired: normalizeDraftBoolean_(caseData.cert),
    drivingRequired: normalizeDraftBoolean_(caseData.drive),

    worksiteAddress: caseData.address || '',

    isH2ALC: normalizeDraftBoolean_(caseData.h2alc)
  });
}

function normalizeDraftBoolean_(value) {
  if (value === true || value === 1 || value === '1') return true;
  if (value === false || value === 0 || value === '0') return false;
  return undefined;
}

function buildEmployerContextForNodDeficiency_(caseData = {}, deficiencyType = '', issueText = '') {
  const employerData = normalizeNodEmployerDataForDraft_(caseData);
  const flags = getDraftDeficiencyFlags_(deficiencyType, issueText);

  const context = {
    caseNumber: employerData.caseNumber,
    businessName: employerData.businessName,
    isH2ALC: employerData.isH2ALC
  };

  if (flags.includeJobSupport) {
    Object.assign(context, {
      jobTitle: employerData.jobTitle,
      workersRequested: employerData.workersRequested,
      periodOfNeedStart: employerData.periodOfNeedStart,
      periodOfNeedEnd: employerData.periodOfNeedEnd,
      periodOfNeedLabel: employerData.periodOfNeedLabel
    });

    if (flags.includeJobDuties) {
      context.jobDescription = employerData.jobDescription;
    }
  }

  if (flags.includeFein) {
    context.fein = employerData.fein;
  }

  if (flags.includeRequirements) {
    Object.assign(context, {
      certificationRequired: employerData.certificationRequired,
      drivingRequired: employerData.drivingRequired
    });
  }

  if (flags.includeWorksite) {
    context.worksiteAddress = employerData.worksiteAddress;
  }

  return removeEmptyDraftFields_(context);
}


// ==================== DRAFT PAYLOAD ====================

function cleanRagText_(value) {
  return String(value || '')
    .replace(/�/g, '§')
    .trim();
}

function trimDraftText_(text, maxChars = 1800) {
  const normalized = normalizeDraftText_(text);

  if (normalized.length <= maxChars) return normalized;

  return `${normalized.slice(0, maxChars - 3).trimEnd()}...`;
}

function getLastDraftParagraphs_(text, maxParagraphs = 2) {
  const normalized = normalizeDraftText_(text);
  if (!normalized) return '';

  const paragraphs = normalized
    .split(/\n\s*\n/)
    .map(paragraph => paragraph.trim())
    .filter(Boolean);

  return paragraphs.slice(-maxParagraphs).join('\n\n');
}

function compressNodCfrResult_(item) {
  return {
    citation: cleanRagText_(item?.regulation_number || ''),
    summary: cleanRagText_(item?.summary || ''),
    text: trimDraftText_(cleanRagText_(item?.text || ''), 1500)
  };
}

function compressNodHistoricalExample_(item) {
  return {
    caseNumber: item?.case_number || '',
    employer: item?.employer || '',
    deficiencyType:
      item?.deficiency_type ||
      item?.deficiency_category ||
      '',
    citations: cleanRagText_(item?.applicable_regulatory_citations || ''),
    context: getLastDraftParagraphs_(cleanRagText_(item?.context || ''), 2),
    responseParagraph: cleanRagText_(item?.response_paragraph || ''),
    attachmentsNeeded: cleanRagText_(item?.attachments_needed || ''),
    outcome: cleanRagText_(item?.outcome_reviewer_note || '')
  };
}

function compressNodInterpretation_(item) {
  return {
    topic: cleanRagText_(item?.topic || ''),
    citation: cleanRagText_(item?.regulation || ''),
    plainEnglish: cleanRagText_(item?.summary || ''),
    dolMisreading: cleanRagText_(item?.dol_misreading || ''),
    strategy: cleanRagText_(item?.response_strategy || ''),
    whenToUse: cleanRagText_(item?.when_to_use || ''),
    relatedCaseLaw: cleanRagText_(item?.related_case_law || ''),
    notes: cleanRagText_(item?.notes || '')
  };
}

function compressNodCaseLaw_(item) {
  return {
    caseName: cleanRagText_(item?.case_name || ''),
    keywords: cleanRagText_(item?.keywords || ''),
    takeaway: cleanRagText_(item?.takeaway || '')
  };
}

function buildNodDraftPromptPayload_(record, deficiencyIndex) {
  const deficiency = record?.deficiencies?.[deficiencyIndex];

  if (!deficiency) {
    throw new Error(`Deficiency index not found: ${deficiencyIndex}`);
  }

  const rag = deficiency.rag || {};

  const issueText = buildCaseIssueText_(
    deficiency.type || '',
    deficiency.context || '',
    deficiency.modificationRequired || ''
  );

  const employerData = buildEmployerContextForNodDeficiency_(
    record.caseData || {},
    deficiency.type || '',
    issueText
  );

  return {
    notice: {
      caseNumber: record.caseNumber || '',
      employerName: record.employerName || ''
    },

    deficiency: {
      number: deficiency.number ?? '',
      type: deficiency.type || '',
      citations: Array.isArray(deficiency.citations)
        ? deficiency.citations
        : [],
      context: normalizeDraftText_(deficiency.context || ''),
      modificationRequired: normalizeDraftText_(
        deficiency.modificationRequired || ''
      )
    },

    employerData,

    supportingRag: {
      cfrResults: (rag.cfrResults || [])
        .slice(0, 3)
        .map(compressNodCfrResult_),

      historicalExamples: (rag.similarDeficiencies || [])
        .slice(0, 2)
        .map(compressNodHistoricalExample_),

      interpretationNotes: (rag.interpretationResults || [])
        .slice(0, 2)
        .map(compressNodInterpretation_),

      caseLaw: (rag.caseLawResults || [])
        .slice(0, 3)
        .map(compressNodCaseLaw_)
    }
  };
}

const DEFAULT_NOD_SYSTEM_MESSAGE = `
You are assisting with drafting a response to a single H-2A Notice of Deficiency item.

Your job is to draft one polished response section for one deficiency using the provided materials.

Rules:
- Write in a polished, professional tone suitable for correspondence with the Department of Labor.
- Refer to the employer by either "Employer" or by its business name.
- When referring to the Notice of Deficiency, abbreviate it to "NOD".
- Address only the single deficiency provided.
- Use the deficiency context as the starting point, but verify it against any employer data and supporting RAG materials.
- Treat CFR, interpretation notes, and case law as support, not as text to copy mechanically.
- Treat historical examples as substance/examples, not style templates.
- Do not invent employer facts, documents, or legal arguments.
- If support is limited, write carefully and conservatively.
- If an attachment is needed, mention it in a complete sentence and explain why it addresses the issue.
- Do not write a greeting, closing, signature block, or a full multi-deficiency letter.
- Return only the response text for this one deficiency.
`.trim();

function buildNodDraftMessages_(payload, promptConfig = {}) {
  const systemMessage =
    normalizeDraftText_(promptConfig.nodSystemMessage) ||
    DEFAULT_NOD_SYSTEM_MESSAGE;

  const customInstructions =
    normalizeDraftText_(payload?.customInstructions);

  const previousDraft =
    normalizeDraftText_(payload?.previousDraft);

  const {
    customInstructions: _customInstructions,
    previousDraft: _previousDraft,
    ...packetPayload
  } = payload || {};

  const previousDraftBlock = previousDraft
    ? `

PREVIOUS DRAFT TO REVISE:
${previousDraft}

If analyst guidance is provided, revise the previous draft according to that guidance while preserving useful language.`
    : '';

  const customBlock = customInstructions
    ? `

CASE-SPECIFIC USER GUIDANCE:
${customInstructions}

Use this guidance if relevant, but do not follow it if it conflicts with the system rules or provided facts.`
    : '';

  const userMessage = `Draft a response for the following H-2A deficiency.

PACKET:
${JSON.stringify(packetPayload, null, 2)}${previousDraftBlock}${customBlock}`;

  return [
    {
      role: 'system',
      content: systemMessage
    },
    {
      role: 'user',
      content: userMessage
    }
  ];
}

async function previewActiveNodDraft_() {
  if (!currentNod) {
    console.warn('No NOD is currently loaded.');
    return null;
  }

  const deficiencyIndex = currentNod.activeDeficiencyIndex;

  if (!currentNod.deficiencies?.[deficiencyIndex]) {
    console.warn('No active deficiency is selected.');
    return null;
  }

  const cache = await loadNodRagCache_();

  const payload = buildNodDraftPromptPayload_(
    currentNod,
    deficiencyIndex
  );

  const messages = buildNodDraftMessages_(
    payload,
    cache.promptConfig || {}
  );

  console.log('NOD draft payload:', payload);
  console.log('NOD draft messages:', messages);

  return {
    deficiencyIndex,
    payload,
    messages
  };
}

async function requestNodDraft_(messages) {
  const { data, error } = await window.globalQuerySupabase.functions.invoke('generate-nod-draft', {
    body: { messages }
  });

  if (error) {
    console.error('NOD draft generation failed:', error);
    throw error;
  }

  if (!data?.draftResponse) {
    throw new Error('Draft generation returned no response text.');
  }

  return data;
}

async function generateActiveNodDraft_() {
  if (!currentNod) {
    throw new Error('No NOD is loaded.');
  }

  const deficiencyIndex = currentNod.activeDeficiencyIndex;
  const deficiency = currentNod.deficiencies?.[deficiencyIndex];

  if (!deficiency) {
    throw new Error('No deficiency is selected.');
  }

  const cache = await loadNodRagCache_();

  const payload = buildNodDraftPromptPayload_(currentNod, deficiencyIndex);

  payload.customInstructions = deficiency.customInstructions || '';
  payload.previousDraft = deficiency.draftResponse || '';

  const messages = buildNodDraftMessages_(payload, cache.promptConfig || {});
  const result = await requestNodDraft_(messages);

  deficiency.draftResponse = result.draftResponse;

  console.log('Generated NOD draft:', {
    deficiencyIndex,
    model: result.model,
    responseId: result.responseId,
    draftResponse: result.draftResponse
  });

  return result;
}


// ==================== DRAFT CREATOR ============

function openNodDraftInstructions_(mode = 'single') {
  pendingNodDraftMode = mode;

  const deficiency = currentNod?.deficiencies?.[currentNod.activeDeficiencyIndex];
  if (!deficiency) return;

  document.getElementById('nodDraftInstructions').value =
    deficiency.customInstructions || '';

  document.getElementById('nodDraftInstructionsTitle').textContent =
    mode === 'all'
      ? 'Generate All NOD Drafts'
      : `Generate Draft — Deficiency ${deficiency.number ?? currentNod.activeDeficiencyIndex + 1}`;

  document.getElementById('nodDraftInstructionsModalOverlay').classList.remove('hidden');
}

function closeNodDraftInstructions_() {
  pendingNodDraftMode = null;
  document.getElementById('nodDraftInstructionsModalOverlay').classList.add('hidden');
}

function openNodDraftResult_(deficiency) {
  if (!deficiency) return;

  document.getElementById('nodDraftResultSubtitle').textContent =
    `Deficiency ${deficiency.number ?? currentNod.activeDeficiencyIndex + 1}: ${deficiency.type || 'Unclassified'}`;

  document.getElementById('nodDraftResultText').value = deficiency.draftResponse || '';
  document.getElementById('nodDraftFeedback').value = '';

  document.getElementById('nodDraftResultModalOverlay').classList.remove('hidden');
}

function closeNodDraftResult_() {
  const deficiency = currentNod?.deficiencies?.[currentNod.activeDeficiencyIndex];

  if (deficiency) {
    deficiency.draftResponse = document.getElementById('nodDraftResultText').value;
  }

  document.getElementById('nodDraftResultModalOverlay').classList.add('hidden');
}

function closeNodDraftResult_() {
  const deficiency =
    currentNod?.deficiencies?.[currentNod.activeDeficiencyIndex];

  if (deficiency) {
    deficiency.draftResponse =
      document.getElementById('nodDraftResultText').value;
  }

  GlobalQueryUI.closeModal_(
    document.getElementById('nodDraftResultModalOverlay')
  );
}


// ==================== RENDER ====================

function renderNodWorkspace_() {
  const workspace = document.getElementById('nodWorkspace');
  const hasNod = !!currentNod?.file;
  const hasDeficiencies = !!currentNod?.deficiencies?.length;

  if (!hasNod) {
    workspace.hidden = true;
    return;
  }

  workspace.hidden = false;
  document.getElementById('draftSingleNodBtn').disabled = !hasDeficiencies;
  document.getElementById('draftAllNodBtn').disabled = !hasDeficiencies;
  document.getElementById('refreshNodRagBtn').disabled = !hasDeficiencies;

  renderNodNoticeInfo_();
  renderNodDeficiencySelector_();
  renderSelectedNodDeficiency_();
  renderNodRagInfo_();
}

function renderNodNoticeInfo_() {
  GlobalQueryUI.appendKv(
    document.getElementById('nodNoticeInfo'),
    [
      ['Case Number', GlobalQueryUI.escapeHtml_(currentNod.caseNumber || '—')],
      ['Employer', GlobalQueryUI.escapeHtml_(currentNod.employerName || '—')],
      ['Received', currentNod.noticeDate ? GlobalQueryUI.formatDate(currentNod.noticeDate) : '—'],
      ['Due', currentNod.dueDate ? GlobalQueryUI.formatDate(currentNod.dueDate) : '—'],
      ['Case Data', GlobalQueryUI.escapeHtml_(currentNod.caseSource || 'Not Found')]
    ]
  );
}

function renderNodDeficiencySelector_() {
  const container = document.getElementById('nodDeficiencySelector');
  const deficiencies = currentNod.deficiencies || [];

  container.innerHTML = deficiencies.map((deficiency, index) => `
    <button
      type="button"
      class="nod-deficiency-select ${index === currentNod.activeDeficiencyIndex ? 'active' : ''}"
      data-deficiency-index="${index}"
    >
      ${GlobalQueryUI.escapeHtml_(
        `${deficiency.number ?? index + 1}. ${deficiency.type || 'Unclassified'}`
      )}
    </button>
  `).join('') || '<div class="muted">No deficiencies detected.</div>';
}

function renderSelectedNodDeficiency_() {
  const container = document.getElementById('nodSelectedDeficiencyInfo');
  const deficiency = currentNod.deficiencies?.[currentNod.activeDeficiencyIndex];

  if (!deficiency) {
    container.innerHTML = '<div class="muted">Select a deficiency.</div>';
    return;
  }

  container.innerHTML = `
    <div class="nod-detail-field">
      <span class="label">Deficiency Type</span>
      <div>${GlobalQueryUI.escapeHtml_(deficiency.type || '—')}</div>
    </div>

    <div class="nod-detail-field">
      <span class="label">Citations</span>
      <div class="nod-deficiency-text">${GlobalQueryUI.escapeHtml_(formatNodCitations_(deficiency.citations))}</div>
    </div>

    <div class="nod-detail-field">
      <span class="label">Context</span>
      <div class="nod-deficiency-text">${GlobalQueryUI.escapeHtml_(deficiency.context || '—')}</div>
    </div>

    <div class="nod-detail-field">
      <span class="label">Modification Required</span>
      <div class="nod-deficiency-text">${GlobalQueryUI.escapeHtml_(deficiency.modificationRequired || '—')}</div>
    </div>
  `;
}

function renderNodRagInfo_() {
  const container = document.getElementById('nodRagInfo');
  const deficiency = currentNod.deficiencies?.[currentNod.activeDeficiencyIndex];

  if (!deficiency) {
    container.innerHTML = '<div class="muted">No deficiency selected.</div>';
    return;
  }

  container.innerHTML = `
    ${renderNodRagSection_(
      'Employer Data',
      'employer',
      currentNod.caseData
        ? [currentNod.caseData]
        : []
    )}

    ${renderNodRagSection_('CFR Results', 'cfr', deficiency.rag?.cfrResults)}
    ${renderNodRagSection_('Similar Deficiencies', 'deficiency', deficiency.rag?.similarDeficiencies)}
    ${renderNodRagSection_('Interpretation Notes', 'interpretation', deficiency.rag?.interpretationResults)}
    ${renderNodRagSection_('Case Law', 'caseLaw', deficiency.rag?.caseLawResults)}
  `;
}

function renderNodRagSection_(title, type, items = []) {
  const values = Array.isArray(items) ? items : [];

  return `
    <div class="nod-rag-section">
      <div class="nod-rag-label">${GlobalQueryUI.escapeHtml_(title)}</div>

      ${values.length
        ? values.map((item, index) => `
            <button
              type="button"
              class="nod-rag-item"
              data-rag-type="${GlobalQueryUI.escapeHtml_(type)}"
              data-rag-index="${index}"
            >
              ${GlobalQueryUI.escapeHtml_(getNodRagItemLabel_(type, item, index))}
            </button>
          `).join('')
        : '<div class="muted small">No results loaded.</div>'
      }
    </div>
  `;
}

function getNodRagItemLabel_(type, item, index) {
  if (type === 'employer') {
    return item?.employer || 'Matched Case Data';
  }

  if (type === 'cfr') {
    return item?.regulation_number || `Regulation ${index + 1}`;
  }

  if (type === 'deficiency') {
    return item?.case_number || `Case ${index + 1}`;
  }
    
  if (type === 'interpretation') {
    return item?.topic || `Interpretation ${index + 1}`;
  }

  if (type === 'caseLaw') {
    return item?.case_name || `Case ${index + 1}`;
  }

  return `Result ${index + 1}`;
}

function renderNodDeficiencies_() {
  const container = document.getElementById('nodDeficiencyList');
  const deficiencies = Array.isArray(currentNod?.deficiencies)
    ? currentNod.deficiencies
    : [];

  document.getElementById('nodDeficiencyCount').textContent =
    `${deficiencies.length.toLocaleString()} deficienc${deficiencies.length === 1 ? 'y' : 'ies'} detected.`;

  if (!deficiencies.length) {
    container.innerHTML = `
      <div class="muted">
        No deficiencies have been parsed yet.
      </div>
    `;

    return;
  }

  container.innerHTML = deficiencies.map((deficiency, index) => `
    <section class="nod-deficiency-card" data-deficiency-index="${index}">
      <div class="nod-deficiency-header">
        <strong>Deficiency ${GlobalQueryUI.escapeHtml_(deficiency.number ?? index + 1)}</strong>
        <span class="muted small">${GlobalQueryUI.escapeHtml_(deficiency.type || 'Unclassified')}</span>
      </div>

      <div class="nod-deficiency-body">

        <div class="nod-deficiency-field">
          <span class="label">Regulatory Citation</span>
          <div class="nod-deficiency-text">
            ${GlobalQueryUI.escapeHtml_(formatNodCitations_(deficiency.citations))}
          </div>
        </div>

        <div class="nod-deficiency-field">
          <span class="label">Context</span>
          <div class="nod-deficiency-text">
            ${GlobalQueryUI.escapeHtml_(deficiency.context || '—')}
          </div>
        </div>

        <div class="nod-deficiency-field">
          <span class="label">Modification Required</span>
          <div class="nod-deficiency-text">
            ${GlobalQueryUI.escapeHtml_(deficiency.modificationRequired || '—')}
          </div>
        </div>

      </div>
    </section>
  `).join('');
}


function formatNodCitations_(citations) {
  if (Array.isArray(citations)) {
    return citations.filter(Boolean).join(', ') || '—';
  }

  return String(citations || '—');
}


// ==================== RAG =======================

function cleanRagCitationText_(value) {
  return String(value || '')
    .replace(/�/g, '§')
    .trim();
}

function getNodRagItems_(type) {
  const deficiency = currentNod?.deficiencies?.[currentNod.activeDeficiencyIndex];

  if (!deficiency) return [];

  switch (type) {
    case 'cfr':
      return deficiency.rag?.cfrResults || [];

    case 'deficiency':
      return deficiency.rag?.similarDeficiencies || [];

    case 'interpretation':
      return deficiency.rag?.interpretationResults || [];

    case 'caseLaw':
      return deficiency.rag?.caseLawResults || [];

    default:
      return [];
  }
}


function openNodRagDetail_(type, index) {
  const items = getNodRagItems_(type);
  const item = items[index];

  if (!item) return;

  const overlay = document.getElementById('nodRagModalOverlay');
  const title = document.getElementById('nodRagModalTitle');
  const subtitle = document.getElementById('nodRagModalSubtitle');
  const content = document.getElementById('nodRagModalContent');

  title.textContent = getNodRagItemLabel_(type, item, index);
  subtitle.textContent = getNodRagTypeLabel_(type);

  content.innerHTML = '';

  if (type === 'cfr') {
    renderNodCfrDetail_(item, content);
  } else if (type === 'deficiency') {
    renderNodSimilarDeficiencyDetail_(item, content);
  } else if (type === 'interpretation') {
    renderNodInterpretationDetail_(item, content);
  } else if (type === 'caseLaw') {
    renderNodCaseLawDetail_(item, content);
  }

  overlay.classList.remove('hidden');
}


function getNodRagTypeLabel_(type) {
  const labels = {
    cfr: 'CFR Result',
    deficiency: 'Similar Deficiency',
    interpretation: 'Interpretation Note',
    caseLaw: 'Case Law'
  };

  return labels[type] || 'RAG Result';
}

function renderNodCfrDetail_(item, container) {

  if (item.text) {
    container.insertAdjacentHTML('beforeend', `
      <div class="modal-panel" style="margin-top:16px">
        <h4>Summary</h4>
        <div class="nod-deficiency-summary">${GlobalQueryUI.escapeHtml_(item.summary)}</div>
      </div>
      <div class="modal-panel" style="margin-top:16px">
        <h4>Regulation Text</h4>
        <div class="nod-deficiency-text">${GlobalQueryUI.escapeHtml_(item.text)}</div>
      </div>
    `);
  }
}

function renderNodSimilarDeficiencyDetail_(item, container) {
  const employer = GlobalQueryUI.escapeHtml_(item.employer || '—');
  const deficiency = GlobalQueryUI.escapeHtml_(item.deficiency_type || item.deficiency_category || '—');
  const citation = GlobalQueryUI.escapeHtml_(cleanRagCitationText_(item.applicable_regulatory_citations) || '—');

  container.insertAdjacentHTML('beforeend', `
    <div class="modal-panel" style="margin-top:16px">
      <h4>Notice of Deficiency</h4>
      <div class="nod-deficiency-text">${employer} • ${deficiency} • ${citation}</div>
    </div>
  
    <div class="modal-panel" style="margin-top:16px">
      <h4>Context</h4>
      <div class="nod-deficiency-text">${GlobalQueryUI.escapeHtml_(item.context || '—')}</div>
    </div>

    <div class="modal-panel" style="margin-top:16px">
      <h4>Modification Required</h4>
      <div class="nod-deficiency-text">${GlobalQueryUI.escapeHtml_(item.modification_required || '—')}</div>
    </div>

    <div class="modal-panel" style="margin-top:16px">
      <h4>Response Paragraph</h4>
      <div class="nod-deficiency-text">${GlobalQueryUI.escapeHtml_(item.response_paragraph || '—')}</div>
    </div>
  `);
}

function renderNodInterpretationDetail_(item, container) {
  const regulation = GlobalQueryUI.escapeHtml_(item.regulation || '—');
  const topic = GlobalQueryUI.escapeHtml_(item.topic || '—');
  const summary = GlobalQueryUI.escapeHtml_(item.summary || '—');

  container.insertAdjacentHTML('beforeend', `
    <div class="modal-panel" style="margin-top:16px">
      <h4>Summary</h4>
      <div class="nod-deficiency-text">${regulation} • ${topic}: ${summary}</div>
    </div>
  
    <div class="modal-panel" style="margin-top:16px">
      <h4>DOL Misreading</h4>
      <div class="nod-deficiency-text">${GlobalQueryUI.escapeHtml_(item.dol_misreading || '—')}</div>
    </div>

    <div class="modal-panel" style="margin-top:16px">
      <h4>Response Strategy</h4>
      <div class="nod-deficiency-text">${GlobalQueryUI.escapeHtml_(item.response_strategy || '—')}</div>
    </div>

    <div class="modal-panel" style="margin-top:16px">
      <h4>When to Use</h4>
      <div class="nod-deficiency-text">${GlobalQueryUI.escapeHtml_(item.when_to_use || '—')}</div>
    </div>

    <div class="modal-panel" style="margin-top:16px">
      <h4>Related Case Law</h4>
      <div class="nod-deficiency-text">${GlobalQueryUI.escapeHtml_(item.related_case_law || '—')}</div>
    </div>

    <div class="modal-panel" style="margin-top:16px">
      <h4>Notes</h4>
      <div class="nod-deficiency-text">${GlobalQueryUI.escapeHtml_(item.notes || '—')}</div>
    </div>
  `);
}

function renderNodCaseLawDetail_(item, container) {
  container.insertAdjacentHTML('beforeend', `
    <div class="modal-panel" style="margin-top:16px">
      <h4>Case Name</h4>
      <div class="nod-deficiency-text">${GlobalQueryUI.escapeHtml_(item.case_name || '—')}</div>
    </div>

    <div class="modal-panel" style="margin-top:16px">
      <h4>Keywords</h4>
      <div class="nod-deficiency-text">${GlobalQueryUI.escapeHtml_(item.keywords || '—')}</div>
    </div>

    <div class="modal-panel" style="margin-top:16px">
      <h4>Takeaway</h4>
      <div class="nod-deficiency-text">${GlobalQueryUI.escapeHtml_(item.takeaway || '—')}</div>
    </div>
  `);
}


// ==================== EVENTS ====================

function bindNodEvents_() {
  const input = document.getElementById('nodFileInput');
  const chooseButton = document.getElementById('chooseNodFileBtn');
  const uploadCard = document.getElementById('nodUploadCard');

  chooseButton.addEventListener('click', () => {
    input.click();
  });

  input.addEventListener('change', () => {
    handleNodFile_(input.files?.[0]);
  });

  document.getElementById('clearNodBtn').addEventListener('click', clearCurrentNod_);

  uploadCard.addEventListener('dragover', event => {
    event.preventDefault();
    uploadCard.classList.add('dragover');
  });

  uploadCard.addEventListener('dragleave', () => {
    uploadCard.classList.remove('dragover');
  });

  uploadCard.addEventListener('drop', event => {
    event.preventDefault();
    uploadCard.classList.remove('dragover');

    handleNodFile_(event.dataTransfer?.files?.[0]);
  });

  document.getElementById('nodDeficiencySelector').addEventListener('click', event => {
    const button = event.target.closest('[data-deficiency-index]');
    if (!button) return;

    const index = Number(button.dataset.deficiencyIndex);

    if (!Number.isInteger(index)) return;
    if (!currentNod?.deficiencies?.[index]) return;

    currentNod.activeDeficiencyIndex = index;

    renderNodDeficiencySelector_();
    renderSelectedNodDeficiency_();
    renderNodRagInfo_();
  });

  document.getElementById('nodRagInfo').addEventListener('click', event => {
    const item = event.target.closest('[data-rag-type][data-rag-index]');
    if (!item) return;

    const type = item.dataset.ragType;
    const index = Number(item.dataset.ragIndex);

    if (!Number.isInteger(index)) return;

    if (type === 'employer') {
      if (currentNod.caseData && typeof window.open790Modal === 'function') {
        window.open790Modal(currentNod.caseData);
      }

      return;
    }

    openNodRagDetail_(type, index);
  });

  document.getElementById('closeNodRagModalBtn').addEventListener('click', () => {
    document.getElementById('nodRagModalOverlay').classList.add('hidden');
  });

  document.getElementById('nodRagModalOverlay').addEventListener('click', event => {
    if (event.target === event.currentTarget) {
      event.currentTarget.classList.add('hidden');
    }
  });

  document.getElementById('draftSingleNodBtn').addEventListener('click', () => {
    openNodDraftInstructions_('single');
  });

  document.getElementById('draftAllNodBtn').addEventListener('click', () => {
    openNodDraftInstructions_('all');
  });

  document.getElementById('cancelNodDraftBtn').addEventListener('click', closeNodDraftInstructions_);
  document.getElementById('closeNodDraftInstructionsBtn').addEventListener('click', closeNodDraftInstructions_);

  document.getElementById('closeNodDraftResultBtn').addEventListener('click', closeNodDraftResult_);

  document.getElementById('confirmNodDraftBtn').addEventListener('click', async () => {
    if (pendingNodDraftMode !== 'single') return;

    const deficiency =
      currentNod?.deficiencies?.[currentNod.activeDeficiencyIndex];

    if (!deficiency) return;

    const button = document.getElementById('confirmNodDraftBtn');
    const instructions = document.getElementById('nodDraftInstructions').value.trim();

    deficiency.customInstructions = instructions;

    button.disabled = true;
    button.textContent = 'Generating…';

    try {
      closeNodDraftInstructions_();

      await generateActiveNodDraft_();

      openNodDraftResult_(deficiency);

    } catch (error) {
      console.error('Could not generate NOD draft:', error);
      alert('GlobalQuery could not generate the draft. Please try again.');

    } finally {
      button.disabled = false;
      button.textContent = 'Generate Draft';
    }
  });

  document.getElementById('copyNodDraftBtn').addEventListener('click', async () => {
    const textarea = document.getElementById('nodDraftResultText');
    const button = document.getElementById('copyNodDraftBtn');

    try {
      await navigator.clipboard.writeText(textarea.value);

      const originalText = button.textContent;
      button.textContent = 'Copied';

      setTimeout(() => {
        button.textContent = originalText;
      }, 1200);

    } catch (error) {
      console.error('Could not copy NOD draft:', error);
      textarea.select();
    }
  });

  document.getElementById('nodDraftResultText').addEventListener('input', event => {
    const deficiency =
      currentNod?.deficiencies?.[currentNod.activeDeficiencyIndex];

    if (!deficiency) return;

    deficiency.draftResponse = event.target.value;
  });

  document.getElementById('resubmitNodDraftBtn').addEventListener('click', async () => {
    const deficiency = currentNod?.deficiencies?.[currentNod.activeDeficiencyIndex];

    if (!deficiency) return;

    const button = document.getElementById('resubmitNodDraftBtn');
    const draftText = document.getElementById('nodDraftResultText').value.trim();
    const feedback = document.getElementById('nodDraftFeedback').value.trim();

    if (!feedback) {
      alert('Enter revision instructions before resubmitting.');
      return;
    }

    deficiency.draftResponse = draftText;
    deficiency.customInstructions = feedback;

    button.disabled = true;
    button.textContent = 'Revising…';

    try {
      await generateActiveNodDraft_();

      document.getElementById('nodDraftResultText').value = deficiency.draftResponse || '';

      document.getElementById('nodDraftFeedback').value = '';

    } catch (error) {
      console.error('Could not revise NOD draft:', error);
      alert('GlobalQuery could not revise the draft. Please try again.');

    } finally {
      button.disabled = false;
      button.textContent = 'Resubmit';
    }
  });
  
}


// ==================== TEST HELPER ====================

async function loadTestNod_() {
  setCurrentNod_({
    ...createEmptyNodState_(),
    file: new File(['test'], 'test-nod.pdf', { type: 'application/pdf' }),
    fileName: 'test-nod.pdf',
    documentType: 'NOD',
    noticeDate: '2026-09-02',
    dueDate: '2026-09-07',
    caseNumber: 'H-300-25305-355491',
    caseKey: '25305-355491',
    employerName: 'Test Employer',
    caseSource: '790 Snapshot',
    deficiencies: [
      {
        number: 1,
        type: 'Job Requirements',
        citations: ['20 CFR 655.122'],
        context: 'Example deficiency context for testing the workspace.',
        modificationRequired: 'The employer must revise the job order.'
      },
      {
        number: 2,
        type: 'Wages',
        citations: ['20 CFR 655.120'],
        context: 'Example wage deficiency context.',
        modificationRequired: 'The employer must update the offered wage.'
      }
    ]
  });

  await loadRagForAllDeficiencies_();

  document.getElementById('nodUploadStatus').textContent =
    'Test NOD loaded.';
}


// ==================== INITIALIZATION ====================

function initializeNod() {
  if (nodInitialized) return;
  nodInitialized = true;

  currentNod = createEmptyNodState_();
  bindNodEvents_();
  renderNodWorkspace_();
}


document
  .querySelector('.tab-btn[data-tab="nodTab"]')
  ?.addEventListener('click', initializeNod);


window.initializeNod = initializeNod;
window.loadTestNod = loadTestNod_;
window.previewActiveNodDraft = previewActiveNodDraft_;
window.generateActiveNodDraft = generateActiveNodDraft_;
