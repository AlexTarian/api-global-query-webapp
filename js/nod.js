pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
let currentNod = null;
let nodInitialized = false;
let nodRagCache = null;
let nodRagLoadingPromise = null;


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
  let currentLine = [];
  let lastY = null;

  for (const item of items || []) {
    const text = String(item?.str || '');
    if (!text) continue;

    const y = item?.transform?.[5];

    if (
      lastY !== null &&
      Number.isFinite(y) &&
      Math.abs(y - lastY) > 2
    ) {
      if (currentLine.length) {
        lines.push(currentLine.join(' '));
        currentLine = [];
      }
    }

    currentLine.push(text);

    if (Number.isFinite(y)) {
      lastY = y;
    }
  }

  if (currentLine.length) {
    lines.push(currentLine.join(' '));
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

  setCurrentNod_(nod);

  try {
    const result = await parseNodPdf_(file);
    const parsed = parseNodText(result.text);

    const caseKey = normalizeNodCaseKey_(parsed.caseNumber);
    const caseMatch = await matchNodCase_(parsed.caseNumber, caseKey);

    console.log('Parsed NOD:', parsed);

    setCurrentNod_({
      ...currentNod,
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

  if (!citations.length) return [];

  const normalizedCitations = citations.map(normalizeRagCitation_);

  return cache.cfr
    .filter(row => {
      const regulation = normalizeRagCitation_(row.regulation_number);

      return normalizedCitations.some(citation =>
        regulation === citation ||
        regulation.startsWith(citation) ||
        citation.startsWith(regulation)
      );
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
    .replace(/§/g, '')
    .replace(/\s+/g, '')
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
  const queryText = [
    deficiency.type,
    deficiency.context,
    deficiency.modificationRequired,
    ...(deficiency.citations || [])
  ].join(' ');

  return cache.interpretations
    .map(row => {
      const interpretationText = [
        row.regulation,
        row.topic,
        row.summary,
        row.dol_misreading,
        row.response_strategy,
        row.when_to_use,
        row.related_case_law,
        row.notes
      ].join(' ');

      const score = countRagOverlap_(queryText, interpretationText);

      return {
        ...row,
        _score: score
      };
    })
    .filter(row => row._score >= 2)
    .sort((a, b) => b._score - a._score)
    .slice(0, 2)
    .map(row => ({
      ...row,
      title: row.topic || row.regulation || 'Interpretation Note'
    }));
}

function findNodCaseLaw_(deficiency, cache) {
  const queryText = [
    deficiency.type,
    deficiency.context,
    deficiency.modificationRequired,
    ...(deficiency.citations || [])
  ].join(' ');

  return cache.caseLaw
    .map(row => {
      const searchableText = [
        row.case_name,
        row.keywords,
        row.takeaway
      ].join(' ');

      const score = countRagOverlap_(queryText, searchableText);

      return {
        ...row,
        _score: score
      };
    })
    .filter(row => row._score >= 2)
    .sort((a, b) => b._score - a._score)
    .slice(0, 2)
    .map(row => ({
      ...row,
      title: row.case_name || 'Case Law'
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

// ==================== RENDER ====================

function renderNodWorkspace_() {
  const workspace = document.getElementById('nodWorkspace');

  if (!currentNod?.file) {
    workspace.hidden = true;
    return;
  }

  workspace.hidden = false;

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
              ${GlobalQueryUI.escapeHtml_(
                item?.title ||
                item?.case_number ||
                item?.regulation_number ||
                item?.case_name ||
                `Result ${index + 1}`
              )}
            </button>
          `).join('')
        : '<div class="muted small">No results loaded.</div>'
      }
    </div>
  `;
}

function getNodRagItemLabel_(type, item, index) {
  if (type === 'employer') {
    return item?.employer || currentNod.employerName || 'Matched Case Data';
  }

  if (typeof item === 'string') return item;

  return (
    item?.title ||
    item?.caseNumber ||
    item?.case_number ||
    item?.citation ||
    item?.name ||
    `Result ${index + 1}`
  );
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
  
}


// ==================== TEST HELPER ====================

function loadTestNod_() {
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
