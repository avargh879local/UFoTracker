const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 5001;
const BASE = __dirname;
const DATA_DIR = path.join(BASE, 'data');
const SUMMARIES_DIR = path.join(DATA_DIR, 'summaries');
const PUBLIC_DIR = path.join(BASE, 'public');

fs.mkdirSync(SUMMARIES_DIR, { recursive: true });

app.use(express.json());
app.use(express.static(PUBLIC_DIR));

// SSE clients registry
const sseClients = new Set();

app.get('/api/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.flushHeaders();
  sseClients.add(res);
  req.on('close', () => sseClients.delete(res));
  res.write('data: {"type":"connected"}\n\n');
});

function broadcast(data) {
  const msg = `data: ${JSON.stringify(data)}\n\n`;
  sseClients.forEach(c => c.write(msg));
}
global.broadcast = broadcast;

function cleanTitle(title, agency) {
  // Already clean (comma-separated DOW-UAP, NASA, State Dept format)
  if (title.includes(',')) return title;
  // FBI photos
  const photoM = title.match(/^FBI_Photo_B(\d+)$/);
  if (photoM) return `FBI Photo Evidence — Set B, Item ${photoM[1]}`;
  // FBI sighting files
  if (title.startsWith('FBI_September_2023_Sighting')) {
    return title.replace(/^FBI_September_2023_Sighting_-_/, 'FBI Sept 2023 UAP Sighting: ').replace(/_/g, ' ');
  }
  // FBI case file 62-HQ-83894
  const fbiHQ = title.match(/^65_HS1-\d+_(62-HQ-83894)_Section_(\d+)$/);
  if (fbiHQ) return `FBI Case 62-HQ-83894 — Section ${fbiHQ[2]}`;
  const fbiHQsub = title.match(/^65_HS1-\d+_(62-HQ-83894)_(SUB_.+)$/);
  if (fbiHQsub) return `FBI Case 62-HQ-83894 — ${fbiHQsub[2].replace(/_/g, ' ')}`;
  const fbiHQserial = title.match(/^65_HS1-\d+_(62-HQ-83894)_(Serial_\d+)$/);
  if (fbiHQserial) return `FBI Case 62-HQ-83894 — ${fbiHQserial[2].replace(/_/g, ' ')}`;
  // FBI case 100-DE
  const fbiDE = title.match(/^65_HS1-\d+_(100-DE-\d+)(?:_(Serial_\d+))?$/);
  if (fbiDE) return `FBI Case ${fbiDE[1]}${fbiDE[2] ? ' — ' + fbiDE[2].replace(/_/g, ' ') : ''}`;
  // Incident summaries
  const incM = title.match(/^38_\d+_box(?:\d+_)?Incident_Summaries_(\d+-\d+)$/);
  if (incM) return `War Dept: Incident Summaries ${incM[1]}`;
  // General records
  const genM = title.match(/^18_\d+_General_(.+)$/);
  if (genM) return `War Dept: General Records — ${genM[1].replace(/_/g, ' ')}`;
  // Flying discs 1949
  if (title.match(/^342_.*Flying_Discs/)) return 'War Dept: Flying Discs Investigation Records (1949)';
  // 341 intelligence records
  if (title.match(/^341_110448/)) return 'War Dept: Intelligence Collection Records 1948-1955';
  if (title.match(/^341_110677/)) return 'War Dept: Numerical File 5-2500';
  // 331 German armament
  if (title.match(/^331_/)) return 'War Dept: Numeric Files 1944-45 — German Armament Documents';
  // 59_ State Dept cables (old format)
  if (title.match(/^59_214434/)) return 'State Dept: SP 16 (July 18, 1963)';
  if (title.match(/^59_64634/)) return 'State Dept: File 711.5612 [7-2852]';
  // USPER
  if (title === 'USPER_Statement_about_UAP_Sighting') return 'USPER: Statement About UAP Sighting';
  // Western US
  if (title === 'Western_US_Event') return 'Western U.S. UAP Event';
  // 255 UFOs and defense
  if (title.match(/^255_/)) return 'UFOs & Defense: What Should We Prepare For?';
  // Fallback: clean underscores, strip leading digits
  return title.replace(/_/g, ' ').replace(/^\d+\s+/, '').replace(/\s{2,}/g, ' ').trim();
}

app.get('/api/manifest', (req, res) => {
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(BASE, 'war_ufo_pdf_manifest.json'), 'utf8'));
    const items = manifest.items.filter(i => !i.skip);
    const enriched = items.map(item => {
      const summaryPath = path.join(SUMMARIES_DIR, `${item.folder}.json`);
      const hasSummary = fs.existsSync(summaryPath);
      let summary = null;
      if (hasSummary) {
        try {
          const s = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
          summary = {
            tldr: s.tldr,
            overview: s.overview,
            significance: s.significance,
            totalHighlights: s.allHighlights?.length || 0,
            status: s.status
          };
        } catch {}
      }
      const folderPath = path.join(BASE, item.folder);
      let chunkCount = 0;
      let totalPages = 0;
      if (fs.existsSync(folderPath)) {
        const chunks = fs.readdirSync(folderPath).filter(f => f.endsWith('.pdf'));
        chunkCount = chunks.length;
        // Estimate pages from last chunk filename
        if (chunks.length > 0) {
          const last = chunks.sort().pop();
          const m = last.match(/_pages_\d+-(\d+)\.pdf$/);
          if (m) totalPages = parseInt(m[1]);
        }
      }
      return {
        id: item.folder,
        title: item.title,
        displayTitle: cleanTitle(item.title, item.agency),
        agency: item.agency,
        releaseDate: item.release_date,
        url: item.url,
        filename: item.filename,
        status: hasSummary && summary?.status === 'processed' ? 'processed' : hasSummary ? 'processing' : 'pending',
        chunkCount,
        totalPages,
        summary
      };
    });
    res.json({ documents: enriched, total: enriched.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/document/:id', (req, res) => {
  const summaryPath = path.join(SUMMARIES_DIR, `${req.params.id}.json`);
  if (!fs.existsSync(summaryPath)) {
    return res.status(404).json({ error: 'Not yet analyzed', status: 'pending' });
  }
  try {
    res.json(JSON.parse(fs.readFileSync(summaryPath, 'utf8')));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/timeline', (req, res) => {
  try {
    res.json(JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'timeline.json'), 'utf8')));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/quotes', (req, res) => {
  try {
    res.json(JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'quotes.json'), 'utf8')));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/stats', (req, res) => {
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(BASE, 'war_ufo_pdf_manifest.json'), 'utf8'));
    const items = manifest.items.filter(i => !i.skip);
    const processed = fs.readdirSync(SUMMARIES_DIR).filter(f => f.endsWith('.json')).length;
    let totalPages = 0;
    try {
      const splitLog = JSON.parse(fs.readFileSync(path.join(BASE, 'war_ufo_split_log.json'), 'utf8'));
      (splitLog.results || []).forEach(r => { if (r.pages) totalPages += r.pages; });
    } catch {}
    res.json({
      totalDocuments: items.length,
      processedDocuments: processed,
      pendingDocuments: items.length - processed,
      totalPages,
      lastRelease: '2026-05-08',
      agencies: { 'FBI': 48, 'Department of War': 55, 'NASA': 8, 'Department of State': 7 }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  const os = require('os');
  const nets = os.networkInterfaces();
  let localIP = 'localhost';
  for (const iface of Object.values(nets).flat()) {
    if (iface.family === 'IPv4' && !iface.internal) { localIP = iface.address; break; }
  }
  console.log(`\n╔══════════════════════════════════════════════╗`);
  console.log(`║   UAP DISCLOSURE ARCHIVE                     ║`);
  console.log(`║   http://localhost:${PORT}                       ║`);
  console.log(`║   http://${localIP}:${PORT}  (same WiFi)      ║`);
  console.log(`╚══════════════════════════════════════════════╝\n`);
  console.log(`To analyze PDFs: ANTHROPIC_API_KEY=... node process_pdfs.cjs`);
  console.log(`To watch for updates: node watcher.cjs\n`);
});
