/**
 * Downloads product images approved in data/image-sources.csv into
 * products/original/, using the exact image_filename from the cleaned
 * catalog. Only rows with a populated image_url and an acquisition_method
 * other than MANUAL_REVIEW are attempted.
 *
 * Safety/etiquette built in:
 *  - descriptive User-Agent identifying this project (no impersonation)
 *  - normal redirect following (no bypassing of auth/CAPTCHA/anti-bot)
 *  - 403/429 are treated as terminal (not retried) to respect access control
 *    and rate limits
 *  - up to 2 retries only for transient 5xx failures, with backoff
 *  - a fixed delay between requests
 *  - Content-Type must be an image/* type — HTML error/interstitial pages
 *    saved with a 200 status are rejected
 *  - files under 10KB are rejected as likely placeholders/broken assets
 *  - actual image format is verified by decoding (sharp), not by trusting
 *    the extension or Content-Type header alone
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const sharp = require('sharp');

const ROOT = path.join(__dirname, '..');
const SOURCES_CSV = path.join(ROOT, 'data', 'image-sources.csv');
const ORIGINAL_DIR = path.join(ROOT, 'products', 'original');
const OUTPUT_DIR = path.join(ROOT, 'output');

const USER_AGENT = 'VIROZ-Perfume-Poster-ImageAcquisition/1.0 (+contact: project owner; catalog asset research)';
const MIN_BYTES = 10 * 1024;
const MAX_REDIRECTS = 5;
const REQUEST_TIMEOUT_MS = 15000;
const DELAY_BETWEEN_MS = 1500;
const MAX_5XX_RETRIES = 2;

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\r') { }
      else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else field += c;
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.length > 1 || r[0] !== '');
}

function csvEscape(v) {
  v = String(v ?? '');
  if (/[",\n]/.test(v)) v = '"' + v.replace(/"/g, '""') + '"';
  return v;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function fetchOnce(url) {
  return new Promise((resolve) => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(url, {
      headers: { 'User-Agent': USER_AGENT, 'Accept': 'image/*,*/*;q=0.8' },
      timeout: REQUEST_TIMEOUT_MS,
    }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: Buffer.concat(chunks),
        });
      });
    });
    req.on('timeout', () => { req.destroy(); resolve({ statusCode: 0, error: 'TIMEOUT' }); });
    req.on('error', (err) => resolve({ statusCode: 0, error: err.message }));
  });
}

async function fetchWithRedirects(url, redirectsLeft = MAX_REDIRECTS) {
  const res = await fetchOnce(url);
  if (res.statusCode >= 300 && res.statusCode < 400 && res.headers && res.headers.location && redirectsLeft > 0) {
    const nextUrl = new URL(res.headers.location, url).toString();
    return fetchWithRedirects(nextUrl, redirectsLeft - 1);
  }
  return res;
}

async function downloadWithPolicy(url) {
  let attempt = 0;
  let lastResult = null;
  while (attempt <= MAX_5XX_RETRIES) {
    const res = await fetchWithRedirects(url);
    lastResult = res;

    if (res.statusCode === 0) {
      return { ok: false, httpStatus: 0, reason: `Network error: ${res.error}` };
    }
    if (res.statusCode === 403 || res.statusCode === 429) {
      // Respect access control / rate limiting — do not retry aggressively.
      return { ok: false, httpStatus: res.statusCode, reason: `${res.statusCode} — respecting access control/rate limit, not retrying` };
    }
    if (res.statusCode >= 500) {
      attempt++;
      if (attempt > MAX_5XX_RETRIES) {
        return { ok: false, httpStatus: res.statusCode, reason: `${res.statusCode} after ${MAX_5XX_RETRIES} retries` };
      }
      await sleep(1000 * attempt);
      continue;
    }
    if (res.statusCode !== 200) {
      return { ok: false, httpStatus: res.statusCode, reason: `Unexpected HTTP status ${res.statusCode}` };
    }

    const contentType = (res.headers['content-type'] || '').toLowerCase();
    if (!contentType.startsWith('image/')) {
      return { ok: false, httpStatus: res.statusCode, reason: `Rejected: Content-Type "${contentType}" is not an image (likely HTML error/interstitial page)` };
    }

    if (res.body.length < MIN_BYTES) {
      return { ok: false, httpStatus: res.statusCode, reason: `Rejected: file only ${res.body.length} bytes (< ${MIN_BYTES} minimum)` };
    }

    // Verify actual decodable image format rather than trusting headers.
    let meta;
    try {
      meta = await sharp(res.body, { limitInputPixels: false }).metadata();
    } catch (err) {
      return { ok: false, httpStatus: res.statusCode, reason: `Rejected: could not decode as an image (${err.message})` };
    }

    return {
      ok: true,
      httpStatus: res.statusCode,
      body: res.body,
      format: meta.format,
      width: meta.width,
      height: meta.height,
    };
  }
  return { ok: false, httpStatus: lastResult ? lastResult.statusCode : 0, reason: 'Exhausted retries' };
}

async function main() {
  const csvText = fs.readFileSync(SOURCES_CSV, 'utf8');
  const rows = parseCsv(csvText);
  const header = rows[0];
  const dataRows = rows.slice(1);

  const idx = Object.fromEntries(header.map((h, i) => [h, i]));
  fs.mkdirSync(ORIGINAL_DIR, { recursive: true });

  const log = [];

  for (const row of dataRows) {
    const english = row[idx.english_name];
    const filename = row[idx.image_filename];
    const imageUrl = row[idx.image_url];
    const method = row[idx.acquisition_method];

    if (!imageUrl || method === 'MANUAL_REVIEW' || !method) {
      log.push({ english, filename, status: 'SKIPPED', reason: 'No approved image_url / marked MANUAL_REVIEW' });
      row[idx.download_status] = 'NOT_DOWNLOADED';
      continue;
    }

    process.stdout.write(`Downloading ${english} (${filename}) ... `);
    const result = await downloadWithPolicy(imageUrl);

    if (!result.ok) {
      console.log('FAILED:', result.reason);
      log.push({ english, filename, imageUrl, status: 'FAILED', httpStatus: result.httpStatus, reason: result.reason });
      row[idx.download_status] = 'FAILED';
      row[idx.http_status] = String(result.httpStatus);
      row[idx.notes] = (row[idx.notes] || '') + ` | download failed: ${result.reason}`;
      await sleep(DELAY_BETWEEN_MS);
      continue;
    }

    const ext = '.' + (result.format === 'jpeg' ? 'jpg' : result.format);
    const outFilename = filename.replace(/\.[^.]+$/, ext);
    const outPath = path.join(ORIGINAL_DIR, outFilename);
    fs.writeFileSync(outPath, result.body);

    console.log(`OK (${result.width}x${result.height} ${result.format})`);
    log.push({
      english, filename: outFilename, imageUrl, status: 'DOWNLOADED',
      httpStatus: result.httpStatus, width: result.width, height: result.height, format: result.format,
    });
    row[idx.download_status] = 'DOWNLOADED';
    row[idx.http_status] = String(result.httpStatus);
    row[idx.image_width] = String(result.width);
    row[idx.image_height] = String(result.height);

    await sleep(DELAY_BETWEEN_MS);
  }

  const outLines = [header.map(csvEscape).join(',')].concat(
    dataRows.map(r => r.map(csvEscape).join(','))
  );
  fs.writeFileSync(SOURCES_CSV, outLines.join('\r\n') + '\r\n', 'utf8');

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUTPUT_DIR, 'image-acquisition-log.json'), JSON.stringify(log, null, 2));

  const summary = log.reduce((acc, r) => { acc[r.status] = (acc[r.status] || 0) + 1; return acc; }, {});
  console.log('\nAcquisition summary:', summary);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
