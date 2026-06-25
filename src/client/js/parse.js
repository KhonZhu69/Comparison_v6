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
    if (!xmlStr) throw new Error('Could not find word/document.xml inside DOCX.');
    return parseDocxXML(xmlStr);
  }

  // ── CSV ───────────────────────────────────────────────────────────────────
  // Detects two graph formats:
  //   1. Standard tabular CSV with headers: source, source_type, relation, target, target_type
  //   2. Neo4j path export — single column "p" with rows like:
  //      (:Label {name: X, type: Y})-[:REL {kind: Z}]->(:Label {name: A, type: B})

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

  function parseNeo4jNode(block) {
    const name = block.match(/name:\s*([^,}]+)/);
    const type = block.match(/\btype:\s*([^,}]+)/);
    return {
      name: name ? name[1].trim().replace(/^['"]|['"]$/g, '') : '',
      type: type ? type[1].trim().replace(/^['"]|['"]$/g, '') : '',
    };
  }

  function parseNeo4jRel(block) {
    const kind    = block.match(/kind:\s*([^,}]+)/);
    const relType = block.match(/\[:(\w+)/);
    return kind ? kind[1].trim().replace(/^['"]|['"]$/g, '') : (relType ? relType[1].trim() : '');
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

  function graphRowsFromCsv(text) {
    const rows = parseCsvRows(text);
    if (rows.length < 2) return [];
    const header = rows[0].map(headerKey);

    if (header.length === 1 && header[0] === 'p') {
      return rows.slice(1)
        .map(row => parseNeo4jPath((row[0] || '').replace(/^"|"$/g, '')))
        .filter(Boolean);
    }

    return rows.slice(1).map(values => {
      const obj = {};
      header.forEach((h, i) => { obj[h] = (values[i] || '').replace(/^"|"$/g, '').trim(); });
      return obj;
    }).filter(r => r.source || r.relation || r.target);
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
        header.forEach((h, idx) => { obj[h] = (values[idx] || '').replace(/^"|"$/g, '').trim(); });
        return {
          id: obj.id || obj['fact id'] || String(i + 1),
          fact: obj.fact || obj['fact identification'] || obj.sentence || '',
          relId: obj.relid || obj['relationship id'] || '',
          relRep: obj.relrep || obj.representation || obj['relationship representation'] || '',
          relType: obj.reltype || obj.type || obj['relation type'] || '',
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
