const fs = require('fs');
const path = require('path');
const { chromium } = require('/Users/adam/.nvm/versions/node/v24.15.0/lib/node_modules/playwright');

const baseDir = '/Users/adam/Desktop/AI Projects/DOW:UFO';
const manifestPath = path.join(baseDir, 'war_ufo_pdf_manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const items = manifest.items.filter((item) => !item.skip);
const logPath = path.join(baseDir, 'war_ufo_download_log.json');

function isPdfFile(filePath) {
  if (!fs.existsSync(filePath)) return false;
  const fd = fs.openSync(filePath, 'r');
  try {
    const buf = Buffer.alloc(4);
    fs.readSync(fd, buf, 0, 4, 0);
    return buf.toString() === '%PDF';
  } finally {
    fs.closeSync(fd);
  }
}

async function downloadOne(ctx, item, index, total) {
  const target = path.join(baseDir, item.filename);
  const tmp = `${target}.part`;

  if (isPdfFile(target)) {
    const size = fs.statSync(target).size;
    console.log(`[${index}/${total}] exists ${item.filename} (${Math.round(size / 1024 / 1024)} MB)`);
    return { ...item, status: 'exists', bytes: size };
  }

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      console.log(`[${index}/${total}] downloading ${item.filename} (attempt ${attempt})`);
      const response = await ctx.request.get(item.url, {
        timeout: 300000,
        headers: {
          accept: 'application/pdf,*/*',
          referer: 'https://www.war.gov/UFO/',
        },
      });
      const body = await response.body();
      const first = body.subarray(0, 4).toString();
      if (!response.ok() || first !== '%PDF') {
        throw new Error(`bad response status=${response.status()} first=${JSON.stringify(first)} bytes=${body.length}`);
      }
      fs.writeFileSync(tmp, body);
      fs.renameSync(tmp, target);
      console.log(`[${index}/${total}] saved ${item.filename} (${Math.round(body.length / 1024 / 1024)} MB)`);
      return { ...item, status: 'downloaded', bytes: body.length };
    } catch (error) {
      if (fs.existsSync(tmp)) fs.rmSync(tmp, { force: true });
      console.log(`[${index}/${total}] failed attempt ${attempt}: ${error.message}`);
      if (attempt === 3) return { ...item, status: 'failed', error: error.message };
      await new Promise((resolve) => setTimeout(resolve, 3000 * attempt));
    }
  }
}

async function main() {
  console.log(`Starting WAR UFO PDF download: ${items.length} files`);
  const browser = await chromium.launch({ channel: 'chrome', headless: false });
  const ctx = await browser.newContext({ acceptDownloads: true });
  const page = await ctx.newPage();
  await page.goto('https://www.war.gov/UFO/#release', { waitUntil: 'load', timeout: 60000 });
  await page.waitForTimeout(2500);

  const results = [];
  let cursor = 0;
  const total = items.length;
  const concurrency = 2;

  async function worker() {
    while (cursor < items.length) {
      const index = cursor++;
      const result = await downloadOne(ctx, items[index], index + 1, total);
      results.push(result);
      fs.writeFileSync(logPath, JSON.stringify({ updatedAt: new Date().toISOString(), results }, null, 2));
    }
  }

  await Promise.all(Array.from({ length: concurrency }, worker));
  await browser.close();

  const failed = results.filter((result) => result.status === 'failed');
  console.log(`Done. downloaded=${results.filter((r) => r.status === 'downloaded').length} exists=${results.filter((r) => r.status === 'exists').length} failed=${failed.length}`);
  if (failed.length) {
    console.log('Failed files:');
    for (const item of failed) console.log(`- ${item.filename}: ${item.error}`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
