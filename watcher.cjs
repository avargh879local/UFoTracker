#!/usr/bin/env node
/**
 * Watches war.gov/medialink/ufo/ for new document releases.
 * When new PDFs are found: downloads, splits, and triggers processing.
 * Run: node watcher.cjs
 */

const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { chromium } = require('/Users/adam/.nvm/versions/node/v24.15.0/lib/node_modules/playwright');

const BASE = __dirname;
const MANIFEST_PATH = path.join(BASE, 'war_ufo_pdf_manifest.json');
const WAR_GOV_URL = 'https://www.war.gov/medialink/ufo/';
const CHECK_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

async function scrapeCurrentDocs() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  try {
    await page.goto(WAR_GOV_URL, { waitUntil: 'networkidle', timeout: 30000 });

    const rows = await page.evaluate(() => {
      const items = [];
      // Try common table/list patterns
      document.querySelectorAll('tr, li, .document-item, [role="row"]').forEach(row => {
        const link = row.querySelector('a[href$=".pdf"], a[href*=".pdf"]');
        if (!link) return;
        const cells = row.querySelectorAll('td');
        const href = link.href;
        const filename = href.split('/').pop().replace(/\.pdf$/i, '');
        items.push({
          title: (cells[0]?.textContent?.trim() || link.textContent?.trim() || filename).replace(/\s+/g, ' '),
          agency: cells[1]?.textContent?.trim() || '',
          release_date: cells[2]?.textContent?.trim() || new Date().toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: '2-digit' }),
          url: href,
          filename: href.split('/').pop()
        });
      });
      return items;
    });

    return rows.filter(r => r.url && r.filename);
  } finally {
    await browser.close();
  }
}

function filenameToFolder(filename) {
  return filename.replace(/\.pdf$/i, '').replace(/[^A-Za-z0-9._-]/g, '_').replace(/__+/g, '_');
}

async function checkForUpdates() {
  const ts = new Date().toISOString();
  console.log(`[${ts}] Checking ${WAR_GOV_URL} for new documents...`);

  let manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  const existingUrls = new Set(manifest.items.map(i => (i.url || '').toLowerCase()));

  let scraped;
  try {
    scraped = await scrapeCurrentDocs();
    console.log(`  Found ${scraped.length} total documents on site.`);
  } catch (err) {
    console.error(`  Scrape failed: ${err.message}`);
    return 0;
  }

  const newItems = scraped.filter(item => !existingUrls.has(item.url.toLowerCase()));
  if (newItems.length === 0) {
    console.log('  No new documents.\n');
    return 0;
  }

  console.log(`  !! ${newItems.length} NEW document(s) found !!`);
  newItems.forEach(item => console.log(`     + ${item.filename}`));

  // Add to manifest
  const maxIndex = Math.max(0, ...manifest.items.map(i => i.pdf_index || 0));
  newItems.forEach((item, idx) => {
    const folder = filenameToFolder(item.filename);
    manifest.items.push({
      site_row: manifest.items.length + idx + 1,
      pdf_index: maxIndex + idx + 1,
      title: item.title,
      agency: item.agency || 'Unknown',
      release_date: item.release_date,
      type: 'PDF',
      url: item.url,
      filename: item.filename,
      folder,
      skip: false,
      added_by_watcher: true,
      added_at: ts
    });
  });
  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2));
  console.log('  Manifest updated.');

  // Download
  console.log('  Downloading new PDFs...');
  try {
    execSync(`node "${path.join(BASE, 'download_war_ufo_pdfs.cjs')}"`, { stdio: 'inherit' });
  } catch (err) {
    console.error('  Download error:', err.message);
  }

  // Split
  console.log('  Splitting PDFs...');
  try {
    execSync(`python3 "${path.join(BASE, 'split_war_ufo_pdfs.py')}"`, { stdio: 'inherit' });
  } catch (err) {
    console.error('  Split error:', err.message);
  }

  // Process with Claude if API key available
  if (process.env.ANTHROPIC_API_KEY) {
    console.log('  Processing with Claude (background)...');
    spawn(process.execPath, [path.join(BASE, 'process_pdfs.cjs')], {
      stdio: 'inherit',
      env: { ...process.env },
      detached: false
    });
  } else {
    console.log('  (Set ANTHROPIC_API_KEY to auto-process new documents)');
  }

  // Notify SSE clients if server module is loaded
  if (typeof global.broadcast === 'function') {
    global.broadcast({ type: 'new_documents', count: newItems.length, titles: newItems.map(i => i.title) });
  }

  console.log(`  Done. ${newItems.length} new document(s) added.\n`);
  return newItems.length;
}

async function main() {
  console.log('\n=== UAP Document Watcher ===');
  console.log(`Watching: ${WAR_GOV_URL}`);
  console.log(`Interval: every ${CHECK_INTERVAL_MS / 60000} minutes\n`);

  await checkForUpdates();
  setInterval(checkForUpdates, CHECK_INTERVAL_MS);
}

main().catch(err => {
  console.error('Watcher fatal error:', err.message);
  process.exit(1);
});
