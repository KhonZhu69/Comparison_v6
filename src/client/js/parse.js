// src/client/js/parse.js
// Parses uploaded DOCX and CSV files entirely in the browser.
// Exposes: window.Parse.docx(arrayBuffer) → rows[]
//          window.Parse.csv(text)          → rows[]

window.Parse = (() => {

  // ── DOCX ──────────────────────────────────────────────────────────────────
  // DOCX files are ZIP archives; we unzip them in JS to read word/document.xml.

  async function readZip(ab) {
    const bytes = new Uint8Array(ab);
    const files = {};
    let i = 0;
    while (i < bytes.length - 4) {
      if (bytes[i]!==0x50||bytes[i+1]!==0x4B||bytes[i+2]!==0x03||bytes[i+3]!==0x04) { i++; continue; }
      const flags         = bytes[i+6]  | (bytes[i+7]  << 8);
      const compression   = bytes[i+8]  | (bytes[i+9]  << 8);
      const fnLen         = bytes[i+26] | (bytes[i+27] << 8);
      const extraLen      = bytes[i+28] | (bytes[i+29] << 8);
      const compressedSize= bytes[i+18] | (bytes[i+19]<<8) | (bytes[i+20]<<16) | (bytes[i+21]<<24);
      const headerEnd     = i + 30 + fnLen + extraLen;
      const fnBytes       = bytes.slice(i+30, i+30+fnLen);
      const filename      = new TextDecoder().decode(fnBytes);
      const dataEnd       = headerEnd + compressedSize;
      if (compression === 0) {
        files[filename] = new TextDecoder('utf-8').decode(bytes.slice(headerEnd, dataEnd));
      } else if (compression === 8) {
        try {
          const raw = bytes.slice(headerEnd, dataEnd);
          const ds  = new DecompressionStream('deflate-raw');
          const writer = ds.writable.getWriter(); writer.write(raw); writer.close();
          const out = await new Response(ds.readable).arrayBuffer();
          files[filename] = new TextDecoder('utf-8').decode(out);
        } catch { /* skip unreadable entries */ }
      }
      i = dataEnd || i + 1;
    }
    return { get: name => files[name] };
  }

  function parseDocxXML(xmlStr) {
    const parser = new DOMParser();
    const doc    = parser.parseFromString(xmlStr, 'application/xml');
    if (doc.querySelector('parsererror')) {
      throw new Error('DOCX XML could not be parsed.');
    }
    const rows   = [];
    const trs    = [...doc.getElementsByTagName('*')].filter(n => n.localName === 'tr');
    let isFirst  = true;
    trs.forEach(tr => {
      const tcs = [...tr.getElementsByTagName('*')].filter(n => n.localName === 'tc');
      const cells = tcs.map(tc =>
        [...tc.getElementsByTagName('*')].filter(n => n.localName === 't').map(t => t.textContent).join('').trim()
      );
      if (!cells.length) return;
      if (isFirst) { isFirst = false; return; }   // skip header row
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
  function parseCsvLine(line, delim = ',') {
    const cells = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
        continue;
      }
      if (ch === delim && !inQuotes) {
        cells.push(cur.trim());
        cur = '';
        continue;
      }
      cur += ch;
    }
    cells.push(cur.trim());
    return cells;
  }

  function countDelimiter(line, delim) {
    let count = 0;
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') i++;
        else inQuotes = !inQuotes;
      } else if (ch === delim && !inQuotes) {
        count++;
      }
    }
    return count;
  }

  function detectDelimiter(line) {
    const candidates = [',', ';', '\t', '|'];
    let best = ',';
    let bestCount = -1;
    for (const d of candidates) {
      const c = countDelimiter(line, d);
      if (c > bestCount) {
        best = d;
        bestCount = c;
      }
    }
    return best;
  }

  function pick(obj, keys) {
    for (const k of keys) {
      if (obj[k]) return obj[k];
    }
    return '';
  }

  function csv(text) {
    const cleaned = text.replace(/^\uFEFF/, '').trim();
    const lines  = cleaned.split(/\r?\n/);
    if (lines.length < 2) return [];
    const delim = detectDelimiter(lines[0]);
    const header = parseCsvLine(lines[0], delim).map(h => h.trim().toLowerCase().replace(/\s+/g,'_'));
    return lines.slice(1).map(line => {
      const vals = parseCsvLine(line, delim);
      const obj  = {};
      header.forEach((h, i) => { obj[h] = (vals[i] || '').trim().replace(/^"|"$/g,''); });
      return {
        ...obj,
        source: pick(obj, ['source', 'from', 'subject', 'start', 'start_node', 'source_node']),
        relation: pick(obj, ['relation', 'relationship', 'predicate', 'type', 'edge', 'rel', 'relation_type']),
        target: pick(obj, ['target', 'to', 'object', 'end', 'end_node', 'target_node'])
      };
    }).filter(r => r.source || r.relation || r.target);
  }

  return { docx, csv };
})();
