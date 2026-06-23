// src/client/js/app.js
// File listeners are wired IMMEDIATELY on DOMContentLoaded.
// API calls (DB) are loaded separately and never block the core UI.

window.App = (() => {

  let manualData          = [];
  let llmData             = [];
  let compResults         = [];
  let hallucinatedTriples = [];
  let savedResults        = [];
  let metrics             = null;
  let activeFilter        = 'all';
  let searchQuery         = '';

  // ── Helpers ───────────────────────────────────────────────────────────────
  function $(id) { return document.getElementById(id); }

  function checkReady() {
    $('runBtn').disabled = !(manualData.length && llmData.length);
  }

  function normalizeSavedResults(results) {
    return Compare.normalizeSavedResults(results);
  }

  function filePart(value) {
    return (value || 'result').toString().trim().toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'result';
  }

  function downloadBlob(blob, filename) {
    const href = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement('a'), { href, download: filename });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(href), 0);
  }

  function downloadJSON(data, filename) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type:'application/json' });
    downloadBlob(blob, filename);
  }

  function textForPdf(value) {
    return (value ?? '').toString()
      .replace(/[‘’]/g, "'")
      .replace(/[“”]/g, '"')
      .replace(/[–—]/g, '-')
      .replace(/→/g, '->')
      .replace(/✓/g, 'match')
      .replace(/✗/g, 'miss')
      .replace(/…/g, '...')
      .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, ' ')
      .replace(/[\t ]+/g, ' ');
  }

  function pdfEscape(value) {
    return textForPdf(value).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  }

  function wrapPdfText(value, maxChars = 92) {
    const paragraphs = textForPdf(value).split(/\r?\n/);
    const lines = [];
    paragraphs.forEach(paragraph => {
      const words = paragraph.trim().split(/\s+/).filter(Boolean);
      if (!words.length) { lines.push(''); return; }
      let line = '';
      words.forEach(word => {
        if (word.length > maxChars) {
          if (line) { lines.push(line); line = ''; }
          for (let i = 0; i < word.length; i += maxChars) lines.push(word.slice(i, i + maxChars));
          return;
        }
        const next = line ? line + ' ' + word : word;
        if (next.length > maxChars) { lines.push(line); line = word; }
        else line = next;
      });
      if (line) lines.push(line);
    });
    return lines;
  }

  function pctForPdf(value) {
    const n = Number(value);
    return Number.isFinite(n) ? (n * 100).toFixed(1) + '%' : '0.0%';
  }

  function dateForPdf(value) {
    const d = value ? new Date(value) : null;
    return d && !Number.isNaN(d.getTime()) ? d.toLocaleString() : 'Not recorded';
  }

  function addWrappedPdfLine(lines, label, value, maxChars = 86) {
    const wrapped = wrapPdfText(value || '-', maxChars);
    if (!wrapped.length) { lines.push(label + ' -'); return; }
    lines.push(label + ' ' + wrapped[0]);
    wrapped.slice(1).forEach(line => lines.push('  ' + line));
  }

  function savedResultPdfLines(result) {
    const m = result.metrics || {};
    const lines = [];
    lines.push('Extraction Comparator Saved Result');
    lines.push('');
    lines.push('Prompt: ' + (result.promptNumber || '-'));
    lines.push('Paper: ' + (result.paperName || '-'));
    lines.push('Model: ' + (result.modelName || '-'));
    lines.push('Threshold: ' + (result.threshold ?? '-') + '%');
    lines.push('Created: ' + dateForPdf(result.createdAt));
    lines.push('');
    lines.push('Metrics');
    lines.push('Accuracy: ' + pctForPdf(m.accuracy) + ' | F1: ' + pctForPdf(m.f1) + ' | Recall: ' + pctForPdf(m.recall) + ' | Precision: ' + pctForPdf(m.precision));
    lines.push('Matches: ' + (m.matches ?? 0) + ' | Partials: ' + (m.partials ?? 0) + ' | Misses: ' + (m.misses ?? 0));
    lines.push('Manual triples: ' + (m.manualCount ?? 0) + ' | LLM triples: ' + (m.llmCount ?? 0));
    lines.push('Hallucinations: ' + (m.hallucinations ?? 0) + ' (' + pctForPdf(m.hallucinationRate) + ')');
    lines.push('');
    lines.push('Prompt Text');
    wrapPdfText(result.prompt || '-', 92).forEach(line => lines.push(line));
    lines.push('');
    lines.push('Manual vs LLM Output');

    (result.comparison || []).forEach((row, index) => {
      const isHallucination = typeof row.hallucination === 'boolean'
        ? row.hallucination
        : row.status === 'miss' && Boolean(row.llm);
      const score = Number(row.score);
      const llmTriple = row.llm
        ? [row.llm.source, row.llm.relation, row.llm.target].filter(Boolean).join(' -> ')
        : 'No match found';
      lines.push('');
      lines.push('#' + (index + 1) + ' | Manual ID: ' + (row.manual?.id || '-') + ' | Status: ' + (row.status || '-') + ' | Score: ' + (Number.isFinite(score) ? (score * 100).toFixed(0) + '%' : '0%') + ' | Hallucination: ' + (isHallucination ? 'Yes' : 'No'));
      addWrappedPdfLine(lines, 'Manual:', row.manual?.relRep || row.manual?.fact || '-');
      addWrappedPdfLine(lines, 'Fact:', row.manual?.fact || '-');
      addWrappedPdfLine(lines, 'LLM:', llmTriple);
      if (row.manual?.relType) addWrappedPdfLine(lines, 'Relation type:', row.manual.relType);
    });

    return lines;
  }

  function buildPdfDocument(lines) {
    const pageWidth = 595.28;
    const pageHeight = 841.89;
    const marginX = 42;
    const startY = 800;
    const lineGap = 13;
    const linesPerPage = Math.floor((startY - 42) / lineGap);
    const pages = [];
    for (let i = 0; i < lines.length; i += linesPerPage) pages.push(lines.slice(i, i + linesPerPage));
    if (!pages.length) pages.push(['No saved result content.']);

    const objects = [];
    const addObject = body => { objects.push(body); return objects.length; };
    const catalogId = addObject('');
    const pagesId = addObject('');
    const fontId = addObject('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
    const pageIds = [];

    pages.forEach((pageLines, pageIndex) => {
      const commands = ['BT', '/F1 10 Tf', lineGap + ' TL', marginX + ' ' + startY + ' Td'];
      pageLines.forEach((line, lineIndex) => {
        if (lineIndex) commands.push('T*');
        commands.push('(' + pdfEscape(line) + ') Tj');
      });
      commands.push('ET');
      const stream = commands.join('\n');
      const contentId = addObject('<< /Length ' + stream.length + ' >>\nstream\n' + stream + '\nendstream');
      const footer = 'Page ' + (pageIndex + 1) + ' of ' + pages.length;
      const footerStream = 'BT\n/F1 9 Tf\n' + marginX + ' 24 Td\n(' + pdfEscape(footer) + ') Tj\nET';
      const footerId = addObject('<< /Length ' + footerStream.length + ' >>\nstream\n' + footerStream + '\nendstream');
      const pageId = addObject('<< /Type /Page /Parent ' + pagesId + ' 0 R /MediaBox [0 0 ' + pageWidth + ' ' + pageHeight + '] /Resources << /Font << /F1 ' + fontId + ' 0 R >> >> /Contents [' + contentId + ' 0 R ' + footerId + ' 0 R] >>');
      pageIds.push(pageId);
    });

    objects[catalogId - 1] = '<< /Type /Catalog /Pages ' + pagesId + ' 0 R >>';
    objects[pagesId - 1] = '<< /Type /Pages /Kids [' + pageIds.map(id => id + ' 0 R').join(' ') + '] /Count ' + pageIds.length + ' >>';

    let pdf = '%PDF-1.4\n';
    const offsets = [0];
    objects.forEach((body, index) => {
      offsets.push(pdf.length);
      pdf += (index + 1) + ' 0 obj\n' + body + '\nendobj\n';
    });
    const xrefOffset = pdf.length;
    pdf += 'xref\n0 ' + (objects.length + 1) + '\n';
    pdf += '0000000000 65535 f \n';
    offsets.slice(1).forEach(offset => { pdf += String(offset).padStart(10, '0') + ' 00000 n \n'; });
    pdf += 'trailer\n<< /Size ' + (objects.length + 1) + ' /Root ' + catalogId + ' 0 R >>\n';
    pdf += 'startxref\n' + xrefOffset + '\n%%EOF';
    return new Blob([pdf], { type: 'application/pdf' });
  }

  function buildSavedResultPdf(result) {
    return buildPdfDocument(savedResultPdfLines(result));
  }

  // ── File upload handlers — wired first, no API dependency ─────────────────
  async function onDocxChange(e) {
    const file = e.target.files[0];
    if (!file) return;
    $('docxName').textContent = file.name;
    $('docxZone').classList.add('loaded');
    try {
      manualData = await Parse.docx(await file.arrayBuffer());
      $('badgeManual').textContent = manualData.length;
      Render.manualTable(manualData);
      if (manualData.length === 0) Render.toast('DOCX parsed but 0 rows found — check table format.', 'error');
    } catch (err) {
      Render.toast('Could not read DOCX: ' + err.message, 'error');
      manualData = [];
    }
    checkReady();
  }

  async function onCsvChange(e) {
    const file = e.target.files[0];
    if (!file) return;
    $('csvName').textContent = file.name;
    $('csvZone').classList.add('loaded');
    try {
      const text = await file.text();
      llmData = Parse.csv(text);
      $('badgeLLM').textContent = llmData.length;
      Render.llmTable(llmData);
      if (llmData.length === 0) Render.toast('CSV parsed but 0 rows found — check column format.', 'error');
    } catch (err) {
      Render.toast('Could not read CSV: ' + err.message, 'error');
      llmData = [];
    }
    checkReady();
  }

  // ── Comparison ────────────────────────────────────────────────────────────
  function runComparison() {
    const btn = $('runBtn');
    btn.disabled = true; btn.textContent = 'Running…';
    setTimeout(() => {
      try {
        const thresh = +$('threshold').value;
        const { results, metrics: m, hallucinatedTriples: ht } = Compare.run(manualData, llmData, thresh);
        compResults = results; metrics = m; hallucinatedTriples = ht;
        Render.metricCards(m);
        $('badgeComp').textContent = compResults.length;
        renderCompTable();
        Render.renderCharts(m);
        $('saveBtn').disabled = false;
      } catch (err) {
        Render.toast('Comparison failed: ' + err.message, 'error');
      }
      btn.textContent = 'Run Comparison'; btn.disabled = false;
    }, 20);
  }

  function renderCompTable() {
    const q = searchQuery.toLowerCase();
    const filtered = compResults.filter(r => {
      if (activeFilter !== 'all' && r.status !== activeFilter) return false;
      if (q) {
        const hay = [r.manual.fact, r.manual.relRep, r.llm?.source, r.llm?.relation, r.llm?.target]
          .join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    Render.compTable(filtered);
  }

  // ── Save / delete / clear ─────────────────────────────────────────────────
  async function saveResult() {
    if (!compResults.length || !metrics) return;
    const prompt    = $('promptText').value.trim();
    const promptNum = $('inputPromptNumber').value.trim();
    const paperName = $('inputPaperName').value.trim();
    const modelName = $('inputModelName').value.trim();
    if (!promptNum) { Render.toast('Enter a prompt number first.', 'error'); return; }
    if (!paperName) { Render.toast('Enter the research paper name.', 'error'); return; }
    if (!modelName) { Render.toast('Enter the model used.', 'error'); return; }
    if (!prompt)    { Render.toast('Paste the prompt text first.', 'error'); return; }

    const newResult = {
      id: 'result_' + Date.now(),
      promptNumber: promptNum,
      title: `Prompt ${promptNum}`,
      paperName, modelName, prompt,
      threshold: +$('threshold').value,
      metrics, comparison: compResults,
    };
    try {
      const saved = Compare.normalizeSavedResult(await Api.saveResult(newResult));
      savedResults.push(saved);
      Render.savedResultsList(savedResults);
      Render.resultDropdown(savedResults);
      Render.toast(`Saved Prompt ${saved.promptNumber}!`);
      Render.activateTab('results');
    } catch (err) { Render.toast('Save failed: ' + err.message, 'error'); }
  }

  function downloadSavedResult(id) {
    const current = savedResults.find(r => r.id === id);
    if (!current) { Render.toast('Saved result not found.', 'error'); return; }

    const normalized = Compare.normalizeSavedResult(current);
    const filename = [
      'saved-result',
      'prompt-' + filePart(normalized.promptNumber),
      filePart(normalized.paperName),
      filePart(normalized.modelName),
    ].filter(Boolean).join('_') + '.pdf';
    downloadBlob(buildSavedResultPdf(normalized), filename);
    Render.toast(`Downloaded PDF for Prompt ${normalized.promptNumber}.`);
  }

  async function deleteSavedResult(id) {
    if (!confirm('Delete this saved result?')) return;
    try {
      await Api.deleteResult(id);
      savedResults = normalizeSavedResults(await Api.getResults());
      Render.savedResultsList(savedResults);
      Render.resultDropdown(savedResults);
      $('selectedResultInfo').innerHTML = '<div class="empty">Choose a saved result to view its comparison.</div>';
      $('selectedComparisonWrap').innerHTML = '';
      Render.toast('Result deleted.');
    } catch (err) { Render.toast('Delete failed: ' + err.message, 'error'); }
  }

  function openSavedResult(id) {
    Render.activateTab('details');
    $('resultSelect').value = id;
    const r = savedResults.find(x => x.id === id);
    if (r) Render.savedResultDetail(r);
  }

  async function clearDatabase() {
    if (!confirm('Delete ALL saved results?')) return;
    try {
      await Api.clearAll();
      savedResults = [];
      Render.savedResultsList([]);
      Render.resultDropdown([]);
      $('selectedResultInfo').innerHTML = '<div class="empty">Choose a saved result to view its comparison.</div>';
      $('selectedComparisonWrap').innerHTML = '';
      Render.toast('Database cleared.');
    } catch (err) { Render.toast('Clear failed: ' + err.message, 'error'); }
  }

  function resetCurrent() {
    manualData = []; llmData = []; compResults = []; hallucinatedTriples = []; metrics = null; searchQuery = '';
    ['docxInput','csvInput'].forEach(id => $(id).value = '');
    $('docxName').textContent = 'No file selected — click to browse';
    $('csvName').textContent  = 'No file selected — click to browse';
    $('docxZone').classList.remove('loaded');
    $('csvZone').classList.remove('loaded');
    $('inputPromptNumber').value = '';
    $('inputPaperName').value    = '';
    $('inputModelName').value    = '';
    $('promptText').value        = '';
    $('runBtn').disabled  = true;
    $('saveBtn').disabled = true;
    $('runBtn').textContent = 'Run Comparison';
    $('compTableWrap').innerHTML   = '<div class="empty">Upload both files, fill in the test info, then run comparison.</div>';
    $('manualTableWrap').innerHTML = '<div class="empty">Upload a DOCX file to preview manual extraction.</div>';
    $('llmTableWrap').innerHTML    = '<div class="empty">Upload a CSV file to preview LLM output.</div>';
    $('statusBar').innerHTML = '';
    ['mPrec','mRec','mF1','mAcc','mHall'].forEach(id => { $(id).textContent = '—'; $(id).className = 'metric-val'; });
    ['bPrec','bRec','bF1','bAcc','bHall'].forEach(id => $(id).style.width = '0');
    ['badgeComp','badgeManual','badgeLLM'].forEach(id => $(id).textContent = '0');
    Render.destroyChart('chartDist'); Render.destroyChart('chartMetrics');
  }

  function exportJSON() {
    downloadJSON(savedResults, 'prompt_results.json');
  }

  // ── DB load (async, never blocks UI) ──────────────────────────────────────
  async function loadFromDb() {
    try {
      const h = await Api.health();
      Render.dbStatus(h.db === 'connected' ? 'ok' : 'err');
    } catch { Render.dbStatus('err'); }

    try {
      savedResults = normalizeSavedResults(await Api.getResults());
      Render.savedResultsList(savedResults);
      Render.resultDropdown(savedResults);
    } catch (err) {
      Render.toast('DB load failed: ' + err.message, 'error');
    }
  }

  // ── Bootstrap — file listeners set up FIRST ───────────────────────────────
  document.addEventListener('DOMContentLoaded', () => {

    // 1. Wire file inputs immediately — no API dependency
    $('docxInput').addEventListener('change', onDocxChange);
    $('csvInput').addEventListener('change',  onCsvChange);

    // 2. Wire buttons
    $('runBtn').addEventListener('click',     runComparison);
    $('saveBtn').addEventListener('click',    saveResult);
    $('resetBtn').addEventListener('click',   resetCurrent);
    // $('clearDbBtn').addEventListener('click', clearDatabase);
    $('exportBtn').addEventListener('click',  exportJSON);

    // 3. Threshold slider
    $('threshold').addEventListener('input', () => {
      $('thresholdVal').textContent = $('threshold').value + '%';
      if (compResults.length) {
        const { results, metrics: m, hallucinatedTriples: ht } = Compare.reclassify(compResults, +$('threshold').value, llmData);
        hallucinatedTriples = ht;
        compResults = results; metrics = m;
        Render.metricCards(m); renderCompTable(); Render.renderCharts(m);
      }
    });

    // 4. Tabs
    document.querySelectorAll('.tab').forEach(tab =>
      tab.addEventListener('click', () => Render.activateTab(tab.dataset.tab))
    );

    // 5. Filters
    document.querySelectorAll('.filter-btn').forEach(btn =>
      btn.addEventListener('click', () => {
        document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active-f'));
        btn.classList.add('active-f');
        activeFilter = btn.dataset.filter;
        renderCompTable();
      })
    );

    // 6. Search
    $('searchInput').addEventListener('input', e => { searchQuery = e.target.value.trim(); renderCompTable(); });

    // 7. Dropdown
    $('resultSelect').addEventListener('change', e => { if (e.target.value) openSavedResult(e.target.value); });

    // 8. Load DB data in background — won't block any of the above
    loadFromDb();
  });

  return { openSavedResult, deleteSavedResult, downloadSavedResult };
})();
