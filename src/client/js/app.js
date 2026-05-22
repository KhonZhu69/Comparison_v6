// src/client/js/app.js

window.App = (() => {

  let manualData   = [];
  let llmData      = [];
  let compResults  = [];
  let savedResults = [];
  let metrics      = null;
  let activeFilter = 'all';
  let searchQuery  = '';

  async function init() {
    try {
      const h = await Api.health();
      Render.dbStatus(h.db === 'connected' ? 'ok' : 'err');
    } catch { Render.dbStatus('err'); }

    try {
      savedResults = await Api.getResults();
      Render.savedResultsList(savedResults);
      Render.resultDropdown(savedResults);
    } catch (err) {
      Render.toast('Could not load saved results: ' + err.message, 'error');
    }

    const slider = document.getElementById('threshold');
    slider.addEventListener('input', () => {
      document.getElementById('thresholdVal').textContent = slider.value + '%';
      if (compResults.length) {
        const { results, metrics: m } = Compare.reclassify(compResults, +slider.value, llmData.length);
        compResults = results; metrics = m;
        Render.metricCards(m); renderCompTable(); Render.renderCharts(m);
      }
    });

    document.querySelectorAll('.tab').forEach(tab =>
      tab.addEventListener('click', () => Render.activateTab(tab.dataset.tab))
    );
    document.querySelectorAll('.filter-btn').forEach(btn =>
      btn.addEventListener('click', () => {
        document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active-f'));
        btn.classList.add('active-f');
        activeFilter = btn.dataset.filter;
        renderCompTable();
      })
    );
    document.getElementById('searchInput').addEventListener('input', e => {
      searchQuery = e.target.value.trim(); renderCompTable();
    });
    document.getElementById('resultSelect').addEventListener('change', e => {
      if (e.target.value) showSavedComparison(e.target.value);
    });
    document.getElementById('runBtn').addEventListener('click',     runComparison);
    document.getElementById('saveBtn').addEventListener('click',    saveResult);
    document.getElementById('resetBtn').addEventListener('click',   resetCurrent);
    document.getElementById('clearDbBtn').addEventListener('click', clearDatabase);
    document.getElementById('exportBtn').addEventListener('click',  exportJSON);
    document.getElementById('docxInput').addEventListener('change', onDocxChange);
    document.getElementById('csvInput').addEventListener('change',  onCsvChange);
  }

  async function onDocxChange(e) {
    const file = e.target.files[0]; if (!file) return;
    document.getElementById('docxName').textContent = file.name;
    document.getElementById('docxZone').classList.add('loaded');
    try {
      const ab = await file.arrayBuffer();
      manualData = await Parse.docx(ab);
      document.getElementById('badgeManual').textContent = manualData.length;
      Render.manualTable(manualData);
    } catch (err) { Render.toast('Could not read DOCX: ' + err.message, 'error'); }
    checkReady();
  }

  async function onCsvChange(e) {
    const file = e.target.files[0]; if (!file) return;
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

  function runComparison() {
    const thresh = +document.getElementById('threshold').value;
    const btn = document.getElementById('runBtn');
    btn.disabled = true; btn.textContent = 'Running…';
    setTimeout(() => {
      const { results, metrics: m } = Compare.run(manualData, llmData, thresh);
      compResults = results; metrics = m;
      Render.metricCards(m);
      document.getElementById('badgeComp').textContent = compResults.length;
      renderCompTable(); Render.renderCharts(m);
      document.getElementById('saveBtn').disabled = false;
      btn.textContent = 'Run Comparison'; btn.disabled = false;
    }, 20);
  }

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

  async function saveResult() {
    if (!compResults.length || !metrics) return;
    const prompt     = document.getElementById('promptText').value.trim();
    const promptNum  = document.getElementById('inputPromptNumber').value.trim();
    const paperName  = document.getElementById('inputPaperName').value.trim();
    const modelName  = document.getElementById('inputModelName').value.trim();

    if (!prompt)    { Render.toast('Please paste the prompt before saving.', 'error'); return; }
    if (!promptNum) { Render.toast('Please enter a prompt number.', 'error'); return; }
    if (!paperName) { Render.toast('Please enter the research paper name.', 'error'); return; }
    if (!modelName) { Render.toast('Please enter the model used.', 'error'); return; }

    const newResult = {
      id:           'result_' + Date.now(),
      promptNumber: promptNum,
      title:        `Prompt ${promptNum}`,
      paperName,
      modelName,
      createdAt:    new Date().toISOString(),
      prompt,
      threshold:    +document.getElementById('threshold').value,
      metrics,
      comparison:   compResults,
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

  async function deleteSavedResult(id) {
    if (!confirm('Delete this saved prompt result?')) return;
    try {
      await Api.deleteResult(id);
      savedResults = await Api.getResults();
      Render.savedResultsList(savedResults);
      Render.resultDropdown(savedResults);
      document.getElementById('selectedResultInfo').innerHTML = '<div class="empty">Choose a saved result to view its actual comparison.</div>';
      document.getElementById('selectedComparisonWrap').innerHTML = '';
      Render.toast('Result deleted.');
    } catch (err) { Render.toast('Delete failed: ' + err.message, 'error'); }
  }

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
    } catch (err) { Render.toast('Clear failed: ' + err.message, 'error'); }
  }

  function resetCurrent() {
    manualData = []; llmData = []; compResults = []; metrics = null; searchQuery = '';
    ['docxInput','csvInput'].forEach(id => document.getElementById(id).value = '');
    document.getElementById('docxName').textContent = 'No file selected — click to browse';
    document.getElementById('csvName').textContent  = 'No file selected — click to browse';
    document.getElementById('docxZone').classList.remove('loaded');
    document.getElementById('csvZone').classList.remove('loaded');
    document.getElementById('inputPromptNumber').value = '';
    document.getElementById('inputPaperName').value    = '';
    document.getElementById('inputModelName').value    = '';
    document.getElementById('promptText').value        = '';
    document.getElementById('runBtn').disabled  = true;
    document.getElementById('saveBtn').disabled = true;
    document.getElementById('runBtn').textContent = 'Run Comparison';
    document.getElementById('compTableWrap').innerHTML   = '<div class="empty">Upload both files, fill in the test info above, then run comparison.</div>';
    document.getElementById('manualTableWrap').innerHTML = '<div class="empty">Upload a DOCX file to preview manual extraction.</div>';
    document.getElementById('llmTableWrap').innerHTML    = '<div class="empty">Upload a CSV file to preview LLM output.</div>';
    document.getElementById('statusBar').innerHTML = '';
    ['mPrec','mRec','mF1','mAcc'].forEach(id => {
      document.getElementById(id).textContent = '—';
      document.getElementById(id).className   = 'metric-val';
    });
    ['bPrec','bRec','bF1','bAcc'].forEach(id => document.getElementById(id).style.width = '0');
    ['badgeComp','badgeManual','badgeLLM'].forEach(id => document.getElementById(id).textContent = '0');
    Render.destroyChart('chartDist'); Render.destroyChart('chartMetrics');
  }

  function exportJSON() {
    const blob = new Blob([JSON.stringify(savedResults, null, 2)], { type:'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = 'saved_prompt_results.json'; a.click();
    URL.revokeObjectURL(url);
  }

  document.addEventListener('DOMContentLoaded', init);
  return { openSavedResult, deleteSavedResult };

})();