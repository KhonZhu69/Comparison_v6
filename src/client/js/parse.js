// src/client/js/parse.js
// Parses uploaded DOCX and CSV files entirely in the browser.
// Exposes: window.Parse.docx(arrayBuffer)      -> manual rows[]
//          window.Parse.csv(text)              -> LLM rows[]
//          window.Parse.manualCsv(text)        -> manual rows[]

window.Parse = (() => {

  // ── DOCX ──────────────────────────────────────────────────────────────────
  async function readZip(ab) {
    const bytes = new Uint8Array(ab);
    const files = {};
    let i = 0;
    while (i < bytes.length - 4) {
      if (bytes[i]!==0x50||bytes[i+1]!==0x4B||bytes[i+2]!==0x03||bytes[i+3]!==0x04) { i++; continue; }
      const fnLen          = bytes[i+26] | (bytes[i+27] << 8);
      const extraLen       = bytes[i+28] | (bytes[i+29] << 8);
      const compression    = bytes[i+8]  | (bytes[i+9]  << 8);
      const compressedSize = bytes[i+18] | (bytes[i+19]<<8) | (bytes[i+20]<<16) | (bytes[i+21]<<24);
      const headerEnd      = i + 30 + fnLen + extraLen;
      const filename       = new TextDecoder().decode(bytes.slice(i+30, i+30+fnLen));
      const dataEnd        = headerEnd + compressedSize;
      if (compression === 0) {
        files[filename] = new TextDecoder('utf-8').decode(bytes.slice(headerEnd, dataEnd));
      } else if (compression === 8) {
        try {
          const ds = new DecompressionStream('deflate-raw');
          const writer = ds.writable.getWriter(); writer.write(bytes.slice(headerEnd, dataEnd)); writer.close();
          const out = await new Response(ds.readable).arrayBuffer();
          files[filename] = new TextDecoder('utf-8').decode(out);
        } catch { /* skip */ }
      }
      i = dataEnd || i + 1;
    }
    return { get: name => files[name] };
  }

  function parseDocxXML(xmlStr) {
    const doc   = new DOMParser().parseFromString(xmlStr, 'application/xml');
    const rows  = [];
    let isFirst = true;
    doc.querySelectorAll('tr').forEach(tr => {
      const cells = [...tr.querySelectorAll('tc')].map(tc =>
        [...tc.querySelectorAll('t')].map(t => t.textContent).join('').trim()
      );
      if (!cells.length) return;
      if (isFirst) { isFirst = false; return; }
      const [id='', fact='', relId='', relRep='', relType=''] = cells;
      rows.push({ id, fact, relId, relRep, relType });
    });
    return rows;
  }

  async function docx(ab) {
    const zip    = await readZip(ab);
    const xmlStr = zip.get('word/document.xml');
    if (xmlStr) return parseDocxXML(xmlStr);

    const text = new TextDecoder('utf-8').decode(ab);
    const rows = manualCsv(text);
    if (rows.length) return rows;
    throw new Error('Could not read manual extraction file. Use a DOCX table or CSV graph export.');
  }

  // ── CSV ───────────────────────────────────────────────────────────────────
  // Detects graph CSVs with source/relation/target columns, Neo4j path columns,
  // and Neo4j Browser triples such as n,r,m or start,relationship,end.

  function parseCsvRows(text) {
    const rows = [];
    let row = [];
    let cur = '';
    let inQ = false;
    const input = (text || '').replace(/^\uFEFF/, '');

    for (let i = 0; i < input.length; i++) {
      const ch = input[i];
      const next = input[i + 1];
      if (ch === '"' && inQ && next === '"') { cur += '"'; i++; }
      else if (ch === '"') { inQ = !inQ; }
      else if (ch === ',' && !inQ) { row.push(cur.trim()); cur = ''; }
      else if ((ch === '\n' || ch === '\r') && !inQ) {
        if (ch === '\r' && next === '\n') i++;
        row.push(cur.trim());
        if (row.some(v => v.trim())) rows.push(row);
        row = []; cur = '';
      } else { cur += ch; }
    }
    row.push(cur.trim());
    if (row.some(v => v.trim())) rows.push(row);
    return rows;
  }

  function headerKey(value) {
    return (value || '').toString().trim().replace(/^"|"$/g, '').toLowerCase();
  }

  function compactKey(value) {
    return headerKey(value).replace(/[^a-z0-9]/g, '');
  }

  function cleanGraphValue(value) {
    return (value || '').toString().trim().replace(/^"|"$/g, '').replace(/^['"]|['"]$/g, '').trim();
  }

  function pick(obj, aliases) {
    for (const alias of aliases) {
      if (obj[alias]) return obj[alias];
    }
    return '';
  }

  function parseNeo4jNode(block) {
    const raw = cleanGraphValue(block);
    const name = raw.match(/(?:name|title|id|value):\s*['"]?([^,'"}]+)['"]?/i);
    const type = raw.match(/\b(?:type|label|category):\s*['"]?([^,'"}]+)['"]?/i);
    const label = raw.match(/^\s*:?([A-Za-z][\w]*)\s*\{/);
    return {
      name: name ? cleanGraphValue(name[1]) : raw.replace(/^\([^{}]*\{?|\}\)?$/g, '').trim(),
      type: type ? cleanGraphValue(type[1]) : (label ? cleanGraphValue(label[1]) : ''),
    };
  }

  function parseNeo4jRel(block) {
    const raw = cleanGraphValue(block);
    const kind = raw.match(/(?:kind|name|type|label):\s*['"]?([^,'"}]+)['"]?/i);
    const relType = raw.match(/\[:?([A-Za-z][\w-]*)/);
    return kind ? cleanGraphValue(kind[1]) : (relType ? cleanGraphValue(relType[1]) : raw);
  }

  function parseNeo4jPath(line) {
    const nodeBlocks = [...line.matchAll(/\(([^)]+)\)/g)].map(m => m[1]);
    const relBlocks  = [...line.matchAll(/\[([^\]]+)\]/g)].map(m => m[1]);
    if (nodeBlocks.length < 2 || relBlocks.length < 1) return null;
    const src = parseNeo4jNode(nodeBlocks[0]);
    const tgt = parseNeo4jNode(nodeBlocks[nodeBlocks.length - 1]);
    const rel = parseNeo4jRel(relBlocks[0]);
    if (!src.name && !tgt.name) return null;
    return { source: src.name, source_type: src.type, relation: rel, target: tgt.name, target_type: tgt.type };
  }

  function parseGraphCellTriple(values, header) {
    const obj = {};
    header.forEach((h, i) => { obj[compactKey(h)] = cleanGraphValue(values[i] || ''); });

    const path = pick(obj, ['p', 'path', 'paths']);
    if (path) {
      const parsed = parseNeo4jPath(path);
      if (parsed) return parsed;
    }

    let source = pick(obj, ['source', 'sourcename', 'sourcenode', 'start', 'startnode', 'from', 'subject', 'head', 'n', 'node1']);
    let target = pick(obj, ['target', 'targetname', 'targetnode', 'end', 'endnode', 'to', 'object', 'tail', 'm', 'node2']);
    let relation = pick(obj, ['relation', 'relationship', 'relationshiptype', 'rel', 'predicate', 'edge', 'kind', 'r']);
    let sourceType = pick(obj, ['sourcetype', 'sourcelabel', 'sourcelabels', 'starttype', 'fromtype', 'subjecttype']);
    let targetType = pick(obj, ['targettype', 'targetlabel', 'targetlabels', 'endtype', 'totype', 'objecttype']);

    if (!source && values.length >= 3) source = cleanGraphValue(values[0]);
    if (!relation && values.length >= 3) relation = cleanGraphValue(values[1]);
    if (!target && values.length >= 3) target = cleanGraphValue(values[2]);

    if (/^\(?\s*:?[A-Za-z][\w]*\s*\{/.test(source)) {
      const node = parseNeo4jNode(source);
      source = node.name;
      sourceType = sourceType || node.type;
    }
    if (/^\(?\s*:?[A-Za-z][\w]*\s*\{/.test(target)) {
      const node = parseNeo4jNode(target);
      target = node.name;
      targetType = targetType || node.type;
    }
    if (/^\[/.test(relation)) relation = parseNeo4jRel(relation);

    if (!source && !relation && !target) return null;
    return { source, source_type: sourceType, relation, target, target_type: targetType };
  }

  function graphRowsFromCsv(text) {
    const rows = parseCsvRows(text);
    if (rows.length < 2) return [];
    const header = rows[0].map(headerKey);
    return rows.slice(1)
      .map(values => parseGraphCellTriple(values, header))
      .filter(r => r && (r.source || r.relation || r.target));
  }

  function csv(text) {
    return graphRowsFromCsv(text);
  }

  function manualCsv(text) {
    const rows = parseCsvRows(text);
    if (rows.length < 2) return [];
    const header = rows[0].map(headerKey);

    const directManual = header.some(h => ['relrep', 'representation', 'relationship representation'].includes(h));
    if (directManual) {
      return rows.slice(1).map((values, i) => {
        const obj = {};
        header.forEach((h, idx) => { obj[compactKey(h)] = cleanGraphValue(values[idx] || ''); });
        return {
          id: obj.id || obj.factid || String(i + 1),
          fact: obj.fact || obj.factidentification || obj.sentence || '',
          relId: obj.relid || obj.relationshipid || '',
          relRep: obj.relrep || obj.representation || obj.relationshiprepresentation || '',
          relType: obj.reltype || obj.type || obj.relationtype || '',
        };
      }).filter(r => r.fact || r.relRep);
    }

    return graphRowsFromCsv(text).map((r, i) => {
      const source = r.source || '';
      const relation = r.relation || '';
      const target = r.target || '';
      return {
        id: String(i + 1),
        fact: [source, relation, target].filter(Boolean).join(' '),
        relId: relation,
        relRep: `${source} → [${relation}] → ${target}`,
        relType: r.target_type || r.source_type || relation,
      };
    }).filter(r => r.relRep.replace(/[\s→\[\]]/g, ''));
  }

  return { docx, csv, manualCsv };
})();
