// src/client/js/parse.js
// Parses uploaded DOCX and CSV files entirely in the browser.
// Exposes: window.Parse.docx(arrayBuffer) → rows[]
//          window.Parse.csv(text)          → rows[]

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
  // Detects two formats:
  //   1. Standard tabular CSV with headers: source, source_type, relation, target, target_type
  //   2. Neo4j path export — single column "p" with rows like:
  //      (:Label {name: X, type: Y})-[:REL {kind: Z}]->(:Label {name: A, type: B})

  function parseNeo4jNode(block) {
    const name = block.match(/name:\s*([^,}]+)/);
    const type = block.match(/\btype:\s*([^,}]+)/);
    return {
      name: name ? name[1].trim() : '',
      type: type ? type[1].trim() : '',
    };
  }

  function parseNeo4jRel(block) {
    const kind    = block.match(/kind:\s*([^,}]+)/);
    const relType = block.match(/\[:(\w+)/);
    return kind ? kind[1].trim() : (relType ? relType[1].trim() : '');
  }

  function parseNeo4jPath(line) {
    // Pull all node blocks (...) and relationship blocks [...]
    const nodeBlocks = [...line.matchAll(/\(([^)]+)\)/g)].map(m => m[1]);
    const relBlocks  = [...line.matchAll(/\[([^\]]+)\]/g)].map(m => m[1]);
    if (nodeBlocks.length < 2 || relBlocks.length < 1) return null;
    const src = parseNeo4jNode(nodeBlocks[0]);
    const tgt = parseNeo4jNode(nodeBlocks[nodeBlocks.length - 1]);
    const rel = parseNeo4jRel(relBlocks[0]);
    if (!src.name && !tgt.name) return null;
    return { source: src.name, source_type: src.type, relation: rel, target: tgt.name, target_type: tgt.type };
  }

  function csv(text) {
    const lines = text.trim().split(/\r?\n/).filter(l => l.trim());
    if (lines.length < 2) return [];

    const header = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, '').toLowerCase());

    // ── Neo4j path format (single column "p") ─────────────────────────────
    if (header.length === 1 && header[0] === 'p') {
      return lines.slice(1)
        .map(line => parseNeo4jPath(line.replace(/^"|"$/g, '')))
        .filter(Boolean);
    }

    // ── Standard tabular CSV ───────────────────────────────────────────────
    return lines.slice(1).map(line => {
      // Handle quoted fields that may contain commas
      const vals = [];
      let cur = '', inQ = false;
      for (const ch of line) {
        if (ch === '"') { inQ = !inQ; }
        else if (ch === ',' && !inQ) { vals.push(cur.trim()); cur = ''; }
        else { cur += ch; }
      }
      vals.push(cur.trim());

      const obj = {};
      header.forEach((h, i) => { obj[h] = (vals[i] || '').replace(/^"|"$/g, '').trim(); });
      return obj;
    }).filter(r => r.source || r.relation || r.target);
  }

  return { docx, csv };
})();