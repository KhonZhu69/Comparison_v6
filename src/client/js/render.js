// src/client/js/render.js
window.Render = (() => {

  const charts = {};

  function esc(s) {
    return (s||'').toString()
      .replace(/&/g,'&amp;').replace(/</g,'&lt;')
      .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
  function formatDate(iso) { return new Date(iso).toLocaleString(); }
  function miniStat(label, val) {
    return `<div class="mini-stat">${label}<strong>${(val*100).toFixed(1)}%</strong></div>`;
  }
  function infoBadges(r) {
    return `
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px">
        <span class="info-tag">📄 ${esc(r.paperName||'—')}</span>
        <span class="info-tag">🤖 ${esc(r.modelName||'—')}</span>
        <span class="info-tag">📅 ${formatDate(r.createdAt)}</span>
        <span class="info-tag">Threshold ${r.threshold}%</span>
        <span class="info-tag">${r.metrics.manualCount} manual · ${r.metrics.llmCount} LLM</span>
      </div>`;
  }

  function toast(msg, type = 'success') {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.className   = `toast ${type} show`;
    clearTimeout(el._t);
    el._t = setTimeout(() => { el.className = 'toast'; }, 3000);
  }

  function dbStatus(state) {
    const el = document.getElementById('dbStatus');
    if (state === 'ok')   { el.className = 'db-status ok';   el.innerHTML = '<span class="db-dot"></span>DB connected'; }
    if (state === 'err')  { el.className = 'db-status err';  el.innerHTML = '<span class="db-dot"></span>DB error'; }
    if (state === 'wait') { el.className = 'db-status wait'; el.innerHTML = '<span class="db-dot"></span>Connecting…'; }
  }

  function metricCards(m) {
    setMetric('Prec', m.precision);
    setMetric('Rec',  m.recall);
    setMetric('F1',   m.f1);
    setMetric('Acc',  m.accuracy);
    const hallEl  = document.getElementById('mHall');
    const hallBar = document.getElementById('bHall');
    const hr = m.hallucinationRate || 0;
    hallEl.textContent = m.hallucinations + ' (' + (hr * 100).toFixed(1) + '%)';
    hallEl.className   = 'metric-val ' + (hr <= .25 ? 'c-green' : hr <= .5 ? 'c-warn' : 'c-red');
    hallBar.style.width      = (hr * 100).toFixed(1) + '%';
    hallBar.style.background = hr <= .25 ? 'var(--accent)' : hr <= .5 ? 'var(--warn)' : 'var(--danger)';
    document.getElementById('statusBar').innerHTML = `
      <div class="status-item"><span class="status-dot" style="background:var(--accent)"></span>${m.matches} Match</div>
      <div class="status-item"><span class="status-dot" style="background:var(--warn)"></span>${m.partials} Partial</div>
      <div class="status-item"><span class="status-dot" style="background:var(--danger)"></span>${m.misses} Miss</div>
      <div class="status-item"><span class="status-dot" style="background:#7c3aed"></span>${m.hallucinations} Hallucinated</div>
      <div class="status-item" style="margin-left:auto;color:var(--muted);font-size:12px">${m.manualCount} manual · ${m.llmCount} LLM triples</div>`;
  }
  function setMetric(id, val) {
    const el  = document.getElementById('m'+id);
    const bar = document.getElementById('b'+id);
    el.textContent = (val*100).toFixed(1)+'%';
    el.className   = 'metric-val ' + (val>=.75?'c-green':val>=.45?'c-warn':'c-red');
    bar.style.width      = (val*100).toFixed(1)+'%';
    bar.style.background = val>=.75?'var(--accent)':val>=.45?'var(--warn)':'var(--danger)';
  }

  function compTable(rows) {
    if (!rows.length) {
      document.getElementById('compTableWrap').innerHTML = '<div class="empty">No results match your filter.</div>';
      return;
    }
    document.getElementById('compTableWrap').innerHTML = buildCompTable(rows);
  }
  function buildCompTable(rows) {
    let html = `<div class="table-wrap"><table><thead><tr>
      <th>#</th><th>Manual extraction</th><th>LLM triple</th>
      <th>Score</th><th>Status</th><th>Relation type</th>
    </tr></thead><tbody>`;
    rows.forEach(r => {
      const mParts = (r.manual.relRep||'').match(/^(.+?)\s*→\s*\[([^\]]+)\]\s*→\s*(.+)$/);
      const pill   = r.status==='match'
        ? '<span class="pill pill-match">✓ Match</span>'
        : r.status==='partial'
          ? '<span class="pill pill-partial">~ Partial</span>'
          : '<span class="pill pill-miss">✗ Miss</span>';
      const mCell = mParts
        ? `<strong>${esc(mParts[1].trim())}</strong><span class="arrow">→</span><span class="rel-tag">${esc(mParts[2].trim())}</span><span class="arrow">→</span><strong>${esc(mParts[3].trim())}</strong><div class="triple-text">${esc((r.manual.fact||'').substring(0,120))}${(r.manual.fact||'').length>120?'…':''}</div>`
        : `<div class="triple-text">${esc(r.manual.fact)}</div>`;
      const lCell = r.llm
        ? `<strong>${esc(r.llm.source)}</strong><span class="arrow">→</span><span class="rel-tag">${esc(r.llm.relation)}</span><span class="arrow">→</span><strong>${esc(r.llm.target)}</strong><div><span class="entity-tag">${esc(r.llm.source_type)}</span></div>`
        : '<span style="color:var(--muted);font-size:12px">No match found</span>';
      html += `<tr>
        <td style="color:var(--muted);font-size:12px">${esc(r.manual.id)}</td>
        <td>${mCell}</td><td>${lCell}</td>
        <td><strong>${(r.score*100).toFixed(0)}%</strong></td>
        <td>${pill}</td>
        <td><span class="pill" style="background:var(--bg);color:var(--muted)">${esc(r.manual.relType||'—')}</span></td>
      </tr>`;
    });
    html += '</tbody></table></div>';
    return html;
  }

  function manualTable(data) {
    if (!data.length) return;
    let html = `<div class="table-wrap"><table><thead><tr>
      <th>#</th><th>Fact Identification</th><th>Relationship ID</th>
      <th>Representation</th><th>Type</th>
    </tr></thead><tbody>`;
    data.forEach(r => {
      html += `<tr>
        <td>${esc(r.id)}</td>
        <td>${esc((r.fact||'').substring(0,140))}${(r.fact||'').length>140?'…':''}</td>
        <td>${esc((r.relId||'').substring(0,100))}</td>
        <td style="font-size:12px;font-family:monospace">${esc(r.relRep)}</td>
        <td>${esc(r.relType)}</td>
      </tr>`;
    });
    html += '</tbody></table></div>';
    document.getElementById('manualTableWrap').innerHTML = html;
  }

  function llmTable(data) {
    if (!data.length) return;
    let html = `<div class="table-wrap"><table><thead><tr>
      <th>#</th><th>Source</th><th>Source Type</th>
      <th>Relation</th><th>Target</th><th>Target Type</th>
    </tr></thead><tbody>`;
    data.slice(0, 150).forEach((r, i) => {
      html += `<tr>
        <td>${i+1}</td>
        <td><strong>${esc(r.source)}</strong></td>
        <td><span class="entity-tag">${esc(r.source_type)}</span></td>
        <td><span class="rel-tag">${esc(r.relation)}</span></td>
        <td><strong>${esc(r.target)}</strong></td>
        <td><span class="entity-tag">${esc(r.target_type)}</span></td>
      </tr>`;
    });
    if (data.length > 150)
      html += `<tr><td colspan="6" style="text-align:center;color:var(--muted)">… and ${data.length-150} more rows</td></tr>`;
    html += '</tbody></table></div>';
    document.getElementById('llmTableWrap').innerHTML = html;
  }

  // ── Saved results list ────────────────────────────────────────────────────
  function savedResultsList(results) {
    document.getElementById('badgeSaved').textContent       = results.length;
    document.getElementById('headerSavedCount').textContent = results.length;
    const wrap = document.getElementById('savedResultsWrap');
    if (!results.length) {
      wrap.innerHTML = '<div class="empty">No prompt results saved yet.</div>';
      return;
    }
    wrap.innerHTML = results.map(r => `
      <div class="result-card">
        <div class="result-title">Prompt ${esc(r.promptNumber)}</div>
        ${infoBadges(r)}
        <div class="result-line">
          ${miniStat('Accuracy',  r.metrics.accuracy)}
          ${miniStat('F1 Score',  r.metrics.f1)}
          ${miniStat('Recall',    r.metrics.recall)}
          ${miniStat('Precision', r.metrics.precision)}
        </div>
        <div class="prompt-preview">${esc(r.prompt)}</div>
        <div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn-outline" onclick="App.openSavedResult('${r.id}')">View comparison</button>
          <button class="btn-danger"  onclick="App.deleteSavedResult('${r.id}')">Delete</button>
        </div>
      </div>`).join('');
  }

  // ── Dropdown ──────────────────────────────────────────────────────────────
  function resultDropdown(results) {
    const select = document.getElementById('resultSelect');
    if (!results.length) {
      select.innerHTML = '<option value="">No saved results yet</option>';
      return;
    }
    select.innerHTML = '<option value="">Select a prompt result</option>' +
      results.map(r =>
        `<option value="${r.id}">Prompt ${esc(r.promptNumber)} — ${esc(r.paperName||'?')} — ${esc(r.modelName||'?')} — Acc ${(r.metrics.accuracy*100).toFixed(1)}%</option>`
      ).join('');
  }

  // ── Saved result detail ───────────────────────────────────────────────────
  function savedResultDetail(r) {
    document.getElementById('selectedResultInfo').innerHTML = `
      <div class="result-card" style="margin-bottom:0">
        <div class="result-title">Prompt ${esc(r.promptNumber)}</div>
        ${infoBadges(r)}
        <div class="result-meta" style="margin-bottom:8px">Acc ${(r.metrics.accuracy*100).toFixed(1)}% · F1 ${(r.metrics.f1*100).toFixed(1)}% · Recall ${(r.metrics.recall*100).toFixed(1)}% · Precision ${(r.metrics.precision*100).toFixed(1)}%</div>
        <div class="prompt-preview">${esc(r.prompt)}</div>
      </div>`;
    document.getElementById('selectedComparisonWrap').innerHTML = buildCompTable(r.comparison);
  }

  // ── Charts ────────────────────────────────────────────────────────────────
  function destroyChart(id) { const c = Chart.getChart(id); if (c) c.destroy(); }

  function renderCharts(metrics) {
    destroyChart('chartDist');
    charts.dist = new Chart(document.getElementById('chartDist'), {
      type: 'doughnut',
      data: {
        labels: ['Match','Partial','Miss'],
        datasets: [{ data:[metrics.matches,metrics.partials,metrics.misses], backgroundColor:['#2d6a4f','#b45309','#b91c1c'], borderWidth:2, borderColor:'#fff' }]
      },
      options: { responsive:true, maintainAspectRatio:false, plugins:{ legend:{ position:'bottom' } } }
    });
    destroyChart('chartMetrics');
    charts.metrics = new Chart(document.getElementById('chartMetrics'), {
      type: 'bar',
      data: {
        labels: ['Precision','Recall','F1 Score','Accuracy'],
        datasets: [{ label:'Score %', data:[metrics.precision*100,metrics.recall*100,metrics.f1*100,metrics.accuracy*100], backgroundColor:['#2d6a4f','#1e40af','#6d28d9','#b45309'], borderRadius:5 }]
      },
      options: { responsive:true, maintainAspectRatio:false, plugins:{ legend:{ display:false } }, scales:{ y:{ beginAtZero:true, max:100, ticks:{ callback:v=>v+'%' } }, x:{ grid:{ display:false } } } }
    });
  }

  function activateTab(name) {
    document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    document.getElementById('panel-'+name).classList.add('active');
  }

  return {
    toast, dbStatus, metricCards, compTable, buildCompTable,
    manualTable, llmTable, savedResultsList, resultDropdown,
    savedResultDetail, renderCharts, destroyChart, activateTab, esc,
  };
})();