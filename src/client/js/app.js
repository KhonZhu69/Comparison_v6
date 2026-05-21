// src/client/js/app.js
// Main controller — wires UI events, calls Api.*, Parse.*, Compare.*, Render.*

window.App = (() => {

  // ── State ─────────────────────────────────────────────────────────────────
  let manualData   = [];
  let llmData      = [];
  let compResults  = [];
  let savedResults = [];
  let metrics      = null;
  let activeFilter = 'all';
  let searchQuery  = '';

  // ── Bootstrap ─────────────────────────────────────────────────────────────
  async function init() {
    // Check DB health
    try {
      const h = await Api.health();
      Render.dbStatus(h.db === 'connected' ? 'ok' : 'err');
    } catch {
      Render.dbStatus('err');
    }

    // Load saved results from DB
    try {
      savedResults = await Api.getResults();
      Render.savedResultsList(savedResults);
      Render.resultDropdown(savedResults);
    } catch (err) {
      Render.toast('Could not load saved results: ' + err.message, 'error');
    }

    // Wire up threshold slider
    const slider = document.getElementById('threshold');
    slider.addEventListener('input', () => {
      document.getElementById('thresholdVal').textContent = slider.value + '%';
      if (compResults.length) {
        const { results, metrics: m } = Compare.reclassify(compResults, +slider.value, llmData.length);
        compResults = results;
        metrics     = m;
        Render.metricCards(m);
        renderCompTable();
        Render.renderCharts(m);
      }
    });

    // Wire tabs
    document.querySelectorAll('.tab').forEach(tab =>
      tab.addEventListener('click', () => Render.activateTab(tab.dataset.tab))
    );

    // Wire filter buttons
    document.querySelectorAll('.filter-btn').forEach(btn =>
      btn.addEventListener('click', () => {
        document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active-f'));
        btn.classList.add('active-f');
        activeFilter = btn.dataset.filter;
        renderCompTable();
      })
    );

    // Wire search
    document.getElementById('searchInput').addEventListener('input', e => {
      searchQuery = e.target.value.trim();
      renderCompTable();
    });

    // Wire result dropdown
    document.getElementById('resultSelect').addEventListener('change', e => {
      if (e.target.value) showSavedComparison(e.target.value);
    });

    // Wire buttons
    document.getElementById('runBtn').addEventListener('click',     runComparison);
    document.getElementById('saveBtn').addEventListener('click',    saveResult);
    document.getElementById('resetBtn').addEventListener('click',   resetCurrent);
    document.getElementById('clearDbBtn').addEventListener('click', clearDatabase);
    document.getElementById('exportBtn').addEventListener('click',  exportJSON);

    // Wire file uploads
    document.getElementById('docxInput').addEventListener('change', onDocxChange);
    document.getElementById('csvInput').addEventListener('change',  onCsvChange);
  }

  // ── File upload handlers ───────────────────────────────────────────────────
  async function onDocxChange(e) {
    const file = e.target.files[0];
    if (!file) return;
    document.getElementById('docxName').textContent = file.name;
    document.getElementById('docxZone').classList.add('loaded');
    try {
      const ab  = await file.arrayBuffer();
      manualData = await Parse.docx(ab);
      document.getElementById('badgeManual').textContent = manualData.length;
      Render.manualTable(manualData);
    } catch (err) {
      Render.toast('Could not read DOCX: ' + err.message, 'error');
    }
    checkReady();
  }

  async function onCsvChange(e) {
    const file = e.target.files[0];
    if (!file) return;
    document.getElementById('csvName').textContent = file.name;
    document.getElementById('csvZone').classList.add('loaded');
    const text = await file.text();
    llmData = Parse.csv(text);
    document.getElementById('badgeLLM').textContent = llmData.length;
    Render.llmTable(llmData);
    checkReady();
  }

  function checkReady() {
    document.getElementById('runBtn').disabled = !(manualData.length && llmData.length);
  }

  // ── Run comparison ────────────────────────────────────────────────────────
  function runComparison() {
    const thresh = +document.getElementById('threshold').value;
    const btn    = document.getElementById('runBtn');
    btn.disabled = true;
    btn.textContent = 'Running…';

    // Use setTimeout so the browser can repaint before the heavy loop
    setTimeout(() => {
      const { results, metrics: m } = Compare.run(manualData, llmData, thresh);
      compResults = results;
      metrics     = m;
      Render.metricCards(m);
      document.getElementById('badgeComp').textContent = compResults.length;
      renderCompTable();
      Render.renderCharts(m);
      document.getElementById('saveBtn').disabled = false;
      btn.textContent = 'Run Comparison';
      btn.disabled    = false;
    }, 20);
  }

  // ── Filter & render comparison table ─────────────────────────────────────
  function renderCompTable() {
    const filtered = compResults.filter(r => {
      if (activeFilter !== 'all' && r.status !== activeFilter) return false;
      if (searchQuery) {
        const q   = searchQuery.toLowerCase();
        const hay = [r.manual.fact, r.manual.relRep, r.llm?.source, r.llm?.relation, r.llm?.target].join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    Render.compTable(filtered);
  }

  // ── Save result to database ───────────────────────────────────────────────
  async function saveResult() {
    if (!compResults.length || !metrics) return;
    const prompt = document.getElementById('promptText').value.trim();
    if (!prompt) { Render.toast('Please paste the prompt before saving.', 'error'); return; }

    const newResult = {
      id:           'result_' + Date.now(),
      promptNumber: savedResults.length + 1,
      title:        `Prompt ${savedResults.length + 1}`,
      createdAt:    new Date().toISOString(),
      prompt,
      threshold: +document.getElementById('threshold').value,
      metrics,
      comparison: compResults,
    };

    try {
      const saved = await Api.saveResult(newResult);
      savedResults.push(saved);
      Render.savedResultsList(savedResults);
      Render.resultDropdown(savedResults);
      Render.toast(`Saved Prompt ${saved.promptNumber}!`);
      Render.activateTab('results');
    } catch (err) {
      Render.toast('Save failed: ' + err.message, 'error');
    }
  }

  // ── Delete a single saved result ──────────────────────────────────────────
  async function deleteSavedResult(id) {
    if (!confirm('Delete this saved prompt result?')) return;
    try {
      await Api.deleteResult(id);
      savedResults = await Api.getResults();   // re-fetch to get updated numbering
      Render.savedResultsList(savedResults);
      Render.resultDropdown(savedResults);
      document.getElementById('selectedResultInfo').innerHTML = '<div class="empty">Choose a saved result to view its actual comparison.</div>';
      document.getElementById('selectedComparisonWrap').innerHTML = '';
      Render.toast('Result deleted.');
    } catch (err) {
      Render.toast('Delete failed: ' + err.message, 'error');
    }
  }

  // ── Open saved result ─────────────────────────────────────────────────────
  function openSavedResult(id) {
    Render.activateTab('details');
    document.getElementById('resultSelect').value = id;
    showSavedComparison(id);
  }

  function showSavedComparison(id) {
    const r = savedResults.find(x => x.id === id);
    if (!r) return;
    Render.savedResultDetail(r);
  }

  // ── Clear all results ─────────────────────────────────────────────────────
  async function clearDatabase() {
    if (!confirm('Delete ALL saved prompt results from the database?')) return;
    try {
      await Api.clearAll();
      savedResults = [];
      Render.savedResultsList([]);
      Render.resultDropdown([]);
      document.getElementById('selectedResultInfo').innerHTML = '<div class="empty">Choose a saved result to view its actual comparison.</div>';
      document.getElementById('selectedComparisonWrap').innerHTML = '';
      Render.toast('Database cleared.');
    } catch (err) {
      Render.toast('Clear failed: ' + err.message, 'error');
    }
  }

  // ── Reset current test ────────────────────────────────────────────────────
  function resetCurrent() {
    manualData = []; llmData = []; compResults = []; metrics = null;
    searchQuery = '';
    document.getElementById('docxInput').value = '';
    document.getElementById('csvInput').value  = '';
    document.getElementById('docxName').textContent = 'No file selected — click to browse';
    document.getElementById('csvName').textContent  = 'No file selected — click to browse';
    document.getElementById('docxZone').classList.remove('loaded');
    document.getElementById('csvZone').classList.remove('loaded');
    document.getElementById('runBtn').disabled  = true;
    document.getElementById('saveBtn').disabled = true;
    document.getElementById('runBtn').textContent = 'Run Comparison';
    document.getElementById('compTableWrap').innerHTML   = '<div class="empty">Upload both files, paste the prompt, then run comparison.</div>';
    document.getElementById('manualTableWrap').innerHTML = '<div class="empty">Upload a DOCX file to preview manual extraction.</div>';
    document.getElementById('llmTableWrap').innerHTML    = '<div class="empty">Upload a CSV file to preview LLM output.</div>';
    document.getElementById('statusBar').innerHTML = '';
    ['mPrec','mRec','mF1','mAcc'].forEach(id => {
      document.getElementById(id).textContent = '—';
      document.getElementById(id).className   = 'metric-val';
    });
    ['bPrec','bRec','bF1','bAcc'].forEach(id => document.getElementById(id).style.width = '0');
    ['badgeComp','badgeManual','badgeLLM'].forEach(id => document.getElementById(id).textContent = '0');
    Render.destroyChart('chartDist');
    Render.destroyChart('chartMetrics');
  }

  // ── Export JSON ───────────────────────────────────────────────────────────
  function exportJSON() {
    const blob = new Blob([JSON.stringify(savedResults, null, 2)], { type:'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = 'saved_prompt_results.json'; a.click();
    URL.revokeObjectURL(url);
  }

  // ── Kick off ──────────────────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', init);

  // Expose functions referenced from HTML onclick attributes
  return { openSavedResult, deleteSavedResult };

})();
