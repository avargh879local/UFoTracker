#!/usr/bin/env node
/**
 * Processes unanalyzed PDFs using Claude AI.
 * Run: ANTHROPIC_API_KEY=your-key node process_pdfs.cjs
 *
 * Resumable: skips already-processed documents.
 * Saves partial progress after each chunk.
 */

const Anthropic = require('@anthropic-ai/sdk');
const fs = require('fs');
const path = require('path');

const BASE = __dirname;
const DATA_DIR = path.join(BASE, 'data');
const SUMMARIES_DIR = path.join(DATA_DIR, 'summaries');

fs.mkdirSync(SUMMARIES_DIR, { recursive: true });

if (!process.env.ANTHROPIC_API_KEY) {
  console.error('\n  ERROR: ANTHROPIC_API_KEY not set.');
  console.error('  Run: ANTHROPIC_API_KEY=sk-ant-... node process_pdfs.cjs\n');
  process.exit(1);
}

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = 'claude-opus-4-7';
const MAX_FILE_MB = 28;

function cleanTitle(title, agency) {
  if (title.includes(',')) return title;
  const photoM = title.match(/^FBI_Photo_B(\d+)$/);
  if (photoM) return `FBI Photo Evidence — Set B, Item ${photoM[1]}`;
  if (title.startsWith('FBI_September_2023_Sighting')) {
    return title.replace(/^FBI_September_2023_Sighting_-_/, 'FBI Sept 2023 UAP Sighting: ').replace(/_/g, ' ');
  }
  const fbiHQ = title.match(/^65_HS1-\d+_(62-HQ-83894)_Section_(\d+)$/);
  if (fbiHQ) return `FBI Case 62-HQ-83894 — Section ${fbiHQ[2]}`;
  const fbiHQsub = title.match(/^65_HS1-\d+_(62-HQ-83894)_(SUB_.+)$/);
  if (fbiHQsub) return `FBI Case 62-HQ-83894 — ${fbiHQsub[2].replace(/_/g, ' ')}`;
  const fbiHQserial = title.match(/^65_HS1-\d+_(62-HQ-83894)_(Serial_\d+)$/);
  if (fbiHQserial) return `FBI Case 62-HQ-83894 — ${fbiHQserial[2].replace(/_/g, ' ')}`;
  const fbiDE = title.match(/^65_HS1-\d+_(100-DE-\d+)(?:_(Serial_\d+))?$/);
  if (fbiDE) return `FBI Case ${fbiDE[1]}${fbiDE[2] ? ' — ' + fbiDE[2].replace(/_/g, ' ') : ''}`;
  const incM = title.match(/^38_\d+_box(?:\d+_)?Incident_Summaries_(\d+-\d+)$/);
  if (incM) return `War Dept: Incident Summaries ${incM[1]}`;
  const genM = title.match(/^18_\d+_General_(.+)$/);
  if (genM) return `War Dept: General Records — ${genM[1].replace(/_/g, ' ')}`;
  if (title.match(/^342_.*Flying_Discs/)) return 'War Dept: Flying Discs Investigation Records (1949)';
  if (title.match(/^341_110448/)) return 'War Dept: Intelligence Collection Records 1948-1955';
  if (title.match(/^341_110677/)) return 'War Dept: Numerical File 5-2500';
  if (title.match(/^331_/)) return 'War Dept: Numeric Files 1944-45 — German Armament Documents';
  if (title.match(/^59_214434/)) return 'State Dept: SP 16 (July 18, 1963)';
  if (title.match(/^59_64634/)) return 'State Dept: File 711.5612 [7-2852]';
  if (title === 'USPER_Statement_about_UAP_Sighting') return 'USPER: Statement About UAP Sighting';
  if (title === 'Western_US_Event') return 'Western U.S. UAP Event';
  if (title.match(/^255_/)) return 'UFOs & Defense: What Should We Prepare For?';
  return title.replace(/_/g, ' ').replace(/^\d+\s+/, '').replace(/\s{2,}/g, ' ').trim();
}

async function processChunk(chunkPath, docTitle, agency, pagesRange, chunkIdx, totalChunks) {
  const pdfData = fs.readFileSync(chunkPath);
  const base64Data = pdfData.toString('base64');
  const [startPage] = pagesRange.split('-').map(Number);

  const prompt = `You are analyzing a declassified U.S. government UFO/UAP document for a public archive website.

Document: "${docTitle}"
Agency: ${agency}
Pages in this section: ${pagesRange} (chunk ${chunkIdx + 1} of ${totalChunks})

Analyze this document section carefully and return ONLY a valid JSON object with this exact structure:
{
  "section_overview": "2-3 sentence plain-English summary of what these specific pages cover",
  "pages": [
    {
      "page": ${startPage},
      "summary": "plain one-sentence summary of this page for a general audience",
      "interesting": true or false,
      "interesting_reason": "if interesting: specific reason why (empty string otherwise)"
    }
  ],
  "highlights": ["notable specific finding #1", "notable specific finding #2"],
  "key_entities": ["people/places/programs/dates mentioned"],
  "classification_markings": "any classification stamps, caveats, or handling instructions found on these pages",
  "curious_findings": [
    {
      "page": 1,
      "finding": "specific unusual detail — e.g. a strange redaction, an odd phrase, an unexplained reference, a shocking measurement, a contradiction, or anything that would make a researcher stop and re-read",
      "category": "redaction|technology|language|contradiction|reference|witness|measurement|other"
    }
  ]
}

Rules for "interesting" flag: mark true for pages with UAP/UFO sightings, unusual technology, witness accounts, crash retrievals, government programs, non-human references, cover-up evidence, anomalous phenomena, or threat assessments.

Rules for "curious_findings": Look for things that seem strange, suspicious, or unexpectedly significant — unusual word choices or phrases, heavy redactions over specific details, internal contradictions, vague references to classified programs, witness statements with unusual specificity, technical measurements that seem impossible, pages that appear to be missing, or anything that a serious researcher would find worth investigating further. Only include genuinely curious items, not routine content. An empty array is fine if nothing stands out.

Be thorough — do not miss important details. Write for a curious, intelligent general audience. Return ONLY the JSON object, no other text.`;

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 4096,
    messages: [{
      role: 'user',
      content: [
        { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64Data } },
        { type: 'text', text: prompt }
      ]
    }]
  });

  const text = response.content[0].text.trim();
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('No JSON found in response');
  return JSON.parse(jsonMatch[0]);
}

async function generateOverview(docTitle, agency, sections) {
  const sectionLines = sections.map((s, i) =>
    `Section ${i + 1} (pages ${s.pagesRange}): ${s.section_overview || 'No summary available'}`
  ).join('\n');

  const allCurious = sections.flatMap(s => s.curious_findings || []);
  const curiousDigest = allCurious.length > 0
    ? '\n\nNOTABLE CURIOUS FINDINGS ACROSS DOCUMENT:\n' + allCurious.slice(0, 10).map(c => `- Page ${c.page}: ${c.finding}`).join('\n')
    : '';

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 2048,
    messages: [{
      role: 'user',
      content: `You are writing an entry for a public UAP disclosure archive. Based on these section summaries from the declassified document "${docTitle}" (released by: ${agency}), write a comprehensive overview for general audiences.

SECTION SUMMARIES:
${sectionLines}${curiousDigest}

Return ONLY a valid JSON object:
{
  "tldr": "One clear sentence: what is this document and why does it matter?",
  "overview": "3-5 paragraph accessible overview of the entire document — what it contains, what it reveals, why it's significant",
  "significance": "Why this specific document matters for UAP disclosure (1-2 sentences)",
  "top_highlights": ["Most important finding #1", "Most important finding #2", "Most important finding #3"],
  "top_curious": ["Most intriguing unexplained or suspicious detail #1", "Most intriguing detail #2", "Most intriguing detail #3"]
}

Write for curious, intelligent adults who are not government or military insiders. Return ONLY the JSON object.`
    }]
  });

  const text = response.content[0].text.trim();
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('No JSON in overview response');
  return JSON.parse(jsonMatch[0]);
}

async function processDocument(item) {
  const summaryPath = path.join(SUMMARIES_DIR, `${item.folder}.json`);

  // Skip if fully processed
  if (fs.existsSync(summaryPath)) {
    const existing = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
    if (existing.status === 'processed') {
      console.log(`  SKIP (already processed): ${item.folder}`);
      return;
    }
    // Resume partial processing
    console.log(`  RESUME (was ${existing.status}): ${item.folder}`);
  }

  const folderPath = path.join(BASE, item.folder);
  if (!fs.existsSync(folderPath)) {
    console.log(`  SKIP (no folder): ${item.folder}`);
    return;
  }

  const chunks = fs.readdirSync(folderPath).filter(f => f.endsWith('.pdf')).sort();
  if (chunks.length === 0) {
    console.log(`  SKIP (no chunks): ${item.folder}`);
    return;
  }

  // Load any partial work
  let existing = null;
  if (fs.existsSync(summaryPath)) {
    try { existing = JSON.parse(fs.readFileSync(summaryPath, 'utf8')); } catch {}
  }
  const completedChunks = new Set((existing?.sections || []).filter(s => !s.error && !s.skipped).map(s => s.chunkFile));

  console.log(`  Processing ${chunks.length} chunks${completedChunks.size > 0 ? ` (${completedChunks.size} already done)` : ''}...`);

  const sections = existing?.sections || [];

  for (let i = 0; i < chunks.length; i++) {
    const chunkFile = chunks[i];
    const chunkPath = path.join(folderPath, chunkFile);
    const pagesM = chunkFile.match(/_pages_(\d+)-(\d+)\.pdf$/);
    const pagesRange = pagesM ? `${parseInt(pagesM[1])}-${parseInt(pagesM[2])}` : `chunk-${i + 1}`;

    // Skip already completed
    if (completedChunks.has(chunkFile)) {
      console.log(`    [${i + 1}/${chunks.length}] pages ${pagesRange} — already done`);
      continue;
    }

    const fileSizeMB = fs.statSync(chunkPath).size / (1024 * 1024);
    if (fileSizeMB > MAX_FILE_MB) {
      console.log(`    [${i + 1}/${chunks.length}] pages ${pagesRange} — SKIP (${fileSizeMB.toFixed(1)}MB > ${MAX_FILE_MB}MB)`);
      sections.push({ pagesRange, chunkFile, section_overview: 'Section too large to process.', pages: [], highlights: [], key_entities: [], classification_markings: '', skipped: true, sizeWarning: `${fileSizeMB.toFixed(1)}MB` });
      continue;
    }

    console.log(`    [${i + 1}/${chunks.length}] pages ${pagesRange} (${fileSizeMB.toFixed(1)}MB)...`);
    try {
      const result = await processChunk(chunkPath, item.title, item.agency, pagesRange, i, chunks.length);
      // Replace or add section
      const existingIdx = sections.findIndex(s => s.chunkFile === chunkFile);
      const sectionData = { pagesRange, chunkFile, ...result };
      if (existingIdx >= 0) sections[existingIdx] = sectionData;
      else sections.push(sectionData);

      // Save partial progress
      fs.writeFileSync(summaryPath, JSON.stringify({ id: item.folder, status: 'processing', sections, processedChunks: i + 1, totalChunks: chunks.length }, null, 2));
    } catch (err) {
      console.error(`    ERROR on ${chunkFile}: ${err.message}`);
      sections.push({ pagesRange, chunkFile, section_overview: `Error: ${err.message}`, pages: [], highlights: [], key_entities: [], classification_markings: '', error: err.message });
    }

    // Brief pause between API calls
    await new Promise(r => setTimeout(r, 800));
  }

  console.log(`    Generating document overview...`);
  let overview = {};
  try {
    overview = await generateOverview(item.title, item.agency, sections);
  } catch (err) {
    console.error(`    Overview error: ${err.message}`);
    overview = { tldr: item.title, overview: 'Overview generation failed.', significance: '', top_highlights: [] };
  }

  const allHighlights = sections.flatMap(s => s.highlights || []);
  const allKeyEntities = [...new Set(sections.flatMap(s => s.key_entities || []))];
  const allCuriousFindings = sections.flatMap(s =>
    (s.curious_findings || []).map(c => ({ ...c, sectionPages: s.pagesRange }))
  );
  const interestingPages = sections.flatMap(s =>
    (s.pages || []).filter(p => p.interesting).map(p => ({
      page: p.page,
      reason: p.interesting_reason,
      section: s.pagesRange
    }))
  );

  const summary = {
    id: item.folder,
    title: item.title,
    displayTitle: cleanTitle(item.title, item.agency),
    agency: item.agency,
    releaseDate: item.release_date,
    url: item.url,
    filename: item.filename,
    totalChunks: chunks.length,
    processedAt: new Date().toISOString(),
    status: 'processed',
    ...overview,
    sections,
    allHighlights,
    allKeyEntities,
    allCuriousFindings,
    interestingPages
  };

  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
  console.log(`  DONE: ${item.folder}`);

  if (global.broadcast) {
    global.broadcast({ type: 'document_processed', id: item.folder, displayTitle: summary.displayTitle });
  }
}

async function main() {
  const manifest = JSON.parse(fs.readFileSync(path.join(BASE, 'war_ufo_pdf_manifest.json'), 'utf8'));
  const items = manifest.items.filter(i => !i.skip);

  const toProcess = items.filter(item => {
    const sp = path.join(SUMMARIES_DIR, `${item.folder}.json`);
    if (!fs.existsSync(sp)) return true;
    try {
      return JSON.parse(fs.readFileSync(sp, 'utf8')).status !== 'processed';
    } catch { return true; }
  });

  if (toProcess.length === 0) {
    console.log('\n  All documents already processed!\n');
    return;
  }

  console.log(`\n  Processing ${toProcess.length} of ${items.length} documents...\n`);
  console.log('  This may take several hours for all 118 documents.');
  console.log('  Progress is saved after each chunk — safe to interrupt and resume.\n');

  for (let i = 0; i < toProcess.length; i++) {
    const item = toProcess[i];
    console.log(`\n[${i + 1}/${toProcess.length}] ${item.folder} (${item.agency})`);
    try {
      await processDocument(item);
    } catch (err) {
      console.error(`  FATAL error on ${item.folder}: ${err.message}`);
    }
  }

  console.log('\n  All done!\n');
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
