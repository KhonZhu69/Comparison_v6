// src/client/js/compare.js
// Triple-matching and metric calculation.
// Exposes: window.Compare.run(manualData, llmData, threshold) → { results, metrics }

window.Compare = (() => {

  function tokenise(s) {
    return (s || '').toLowerCase().replace(/[^a-z0-9\s]/g,'').split(/\s+/).filter(Boolean);
  }

  function num(val) {
    const n = Number(val);
    return Number.isFinite(n) ? n : 0;
  }

  function norm(s) {
    return (s || '').toString().trim().toLowerCase();
  }

  function llmKey(llm) {
    if (!llm) return '';
    return [
      llm.source,
      llm.source_type,
      llm.relation,
      llm.target,
      llm.target_type,
    ].map(norm).join('|');
  }

  function jaccard(a, b) {
    const sa = new Set(tokenise(a));
    const sb = new Set(tokenise(b));
    if (!sa.size && !sb.size) return 1;
    const inter = [...sa].filter(x => sb.has(x)).length;
    return inter / (sa.size + sb.size - inter);
  }

  function tripleScore(manual, llm) {
    const repParts = (manual.relRep || '').match(/^(.+?)\s*→\s*\[([^\]]+)\]\s*→\s*(.+)$/);
    const mSrc = repParts ? repParts[1].trim() : (manual.fact || '');
    const mRel = repParts ? repParts[2].trim() : (manual.relType || '');
    const mTgt = repParts ? repParts[3].trim() : '';
    const srcScore = jaccard(mSrc, llm.source);
    const relScore = jaccard(mRel, llm.relation);
    const tgtScore = jaccard(mTgt, llm.target);
    return (srcScore * 0.4) + (relScore * 0.2) + (tgtScore * 0.4);
  }

  function matchedLLMSet(results) {
    return new Set(
      results.filter(r => r.status !== 'miss' && r.llm).map(r => llmKey(r.llm))
    );
  }

  function findHallucinatedTriples(results, llmData) {
    const matchedLLM = matchedLLMSet(results);
    return llmData.filter(l => !matchedLLM.has(llmKey(l)));
  }

  function markHallucinations(results) {
    const matchedLLM = matchedLLMSet(results);
    return results.map(r => ({
      ...r,
      hallucination: Boolean(r.llm && (r.status === 'miss' || !matchedLLM.has(llmKey(r.llm)))),
    }));
  }

  function llmCountFromComparison(results) {
    return new Set(results.filter(r => r.llm).map(r => llmKey(r.llm))).size;
  }

  function normalizeSavedResult(result) {
    const comparison = markHallucinations(Array.isArray(result.comparison) ? result.comparison : []);
    const existingMetrics = result.metrics || {};
    const metricLLMCount = num(existingMetrics.llmCount);
    const llmCount = metricLLMCount || llmCountFromComparison(comparison);
    const metrics = comparison.length
      ? { ...existingMetrics, ...calcMetrics(comparison, llmCount) }
      : existingMetrics;
    return { ...result, metrics, comparison };
  }

  function normalizeSavedResults(results) {
    return Array.isArray(results) ? results.map(normalizeSavedResult) : [];
  }

  function run(manualData, llmData, thresholdPct) {
    const thresh        = thresholdPct / 100;
    const partialThresh = thresh * 0.5;

    const scored = manualData.map(m => {
      let bestScore = 0, bestLLM = null;
      for (const l of llmData) {
        const s = tripleScore(m, l);
        if (s > bestScore) { bestScore = s; bestLLM = l; }
      }
      const status = bestScore >= thresh
        ? 'match'
        : bestScore >= partialThresh ? 'partial' : 'miss';
      return { manual: m, llm: bestLLM, score: bestScore, status };
    });

    const results = markHallucinations(scored);
    const hallucinatedTriples = findHallucinatedTriples(results, llmData);
    const metrics = calcMetrics(results, llmData.length);
    return { results, metrics, hallucinatedTriples };
  }

  function reclassify(results, thresholdPct, llmData) {
    const thresh        = thresholdPct / 100;
    const partialThresh = thresh * 0.5;
    const rescored = results.map(r => ({
      ...r,
      status: r.score >= thresh ? 'match' : r.score >= partialThresh ? 'partial' : 'miss',
    }));
    const updated = markHallucinations(rescored);
    const hallucinatedTriples = findHallucinatedTriples(updated, llmData);
    return { results: updated, metrics: calcMetrics(updated, llmData.length), hallucinatedTriples };
  }

  function calcMetrics(results, llmCount) {
    const total    = results.length;
    const matches  = results.filter(r => r.status === 'match').length;
    const partials = results.filter(r => r.status === 'partial').length;
    const misses   = results.filter(r => r.status === 'miss').length;
    const tp  = matches + partials * 0.5;
    const fp  = Math.max(llmCount - tp, 0);
    const fn  = misses   + partials * 0.5;
    const precision = tp + fp ? tp / (tp + fp) : 0;
    const recall    = tp + fn ? tp / (tp + fn) : 0;
    const f1        = precision + recall ? 2 * precision * recall / (precision + recall) : 0;
    const accuracy  = total ? tp / total : 0;
    const hallucinations     = Math.round(fp);
    const hallucinationRate  = llmCount ? fp / llmCount : 0;
    return { precision, recall, f1, accuracy, matches, partials, misses, manualCount: total, llmCount, hallucinations, hallucinationRate };
  }

  return { run, reclassify, calcMetrics, normalizeSavedResult, normalizeSavedResults };
})();
