// src/client/js/app.js
// File listeners are wired IMMEDIATELY on DOMContentLoaded.
// API calls (DB) are loaded separately and never block the core UI.

window.App = (() => {

  let manualData   = [];
  let llmData      = [];
  let compResults  = [];
  let savedResults = [];
  let metrics      = null;
  let activeFilter = 'all';
  let searchQuery  = '';

  // ── Helpers ───────────────────────────────────────────────────────────────
  function $(id) { return document.getElementById(id); }

  function checkReady() {
    $('runBtn').disabled = !(manualData.length && llmData.length);
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
        const { results, metrics: m } = Compare.run(manualData, llmData, thresh);
        compResults = results; metrics = m;
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
      const saved = await Api.saveResult(newResult);
      savedResults.push(saved);
      Render.savedResultsList(savedResults);
      Render.resultDropdown(savedResults);
      Render.toast(`Saved Prompt ${saved.promptNumber}!`);
      Render.activateTab('results');
    } catch (err) { Render.toast('Save failed: ' + err.message, 'error'); }
  }

  async function deleteSavedResult(id) {
    if (!confirm('Delete this saved result?')) return;
    try {
      await Api.deleteResult(id);
      savedResults = await Api.getResults();
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
    manualData = []; llmData = []; compResults = []; metrics = null; searchQuery = '';
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
    ['mPrec','mRec','mF1','mAcc'].forEach(id => { $(id).textContent = '—'; $(id).className = 'metric-val'; });
    ['bPrec','bRec','bF1','bAcc'].forEach(id => $(id).style.width = '0');
    ['badgeComp','badgeManual','badgeLLM'].forEach(id => $(id).textContent = '0');
    Render.destroyChart('chartDist'); Render.destroyChart('chartMetrics');
  }

  function exportJSON() {
    const blob = new Blob([JSON.stringify(savedResults, null, 2)], { type:'application/json' });
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: 'prompt_results.json' });
    a.click(); URL.revokeObjectURL(a.href);
  }

  // ── DB load (async, never blocks UI) ──────────────────────────────────────
  async function loadFromDb() {
    try {
      const h = await Api.health();
      Render.dbStatus(h.db === 'connected' ? 'ok' : 'err');
    } catch { Render.dbStatus('err'); }

    try {
      savedResults = await Api.getResults();
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
        const { results, metrics: m } = Compare.reclassify(compResults, +$('threshold').value, llmData.length);
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

  return { openSavedResult, deleteSavedResult };
})();