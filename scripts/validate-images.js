/**
 * Validates every product image referenced by data/viroz_perfumes_mapping.csv.
 *
 * Checks per product: filename, source file existence, image format,
 * width, height, aspect ratio, transparency (alpha channel), and whether
 * the file can be decoded (corruption check). Emits:
 *   - output/image-validation-report.html
 *   - output/image-contact-sheet.html
 *   - output/validation-results.json (machine-readable, feeds the poster step)
 */

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const ROOT = path.join(__dirname, '..');
const CSV_PATH = path.join(ROOT, 'data', 'viroz_perfumes_mapping.csv');
const ORIGINAL_DIR = path.join(ROOT, 'products', 'original');
const PROCESSED_DIR = path.join(ROOT, 'products', 'processed');
const OUTPUT_DIR = path.join(ROOT, 'output');

const MIN_LONG_SIDE = 800;

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
      else if (c === '\r') { /* skip */ }
      else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else field += c;
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.length > 1 || r[0] !== '');
}

function findFile(dir, baseFilename) {
  const base = baseFilename.replace(/\.[^.]+$/, '');
  for (const ext of ['.png', '.jpg', '.jpeg', '.webp', '.gif']) {
    const p = path.join(dir, base + ext);
    if (fs.existsSync(p)) return p;
  }
  const exact = path.join(dir, baseFilename);
  if (fs.existsSync(exact)) return exact;
  return null;
}

async function inspect(filePath) {
  try {
    const buf = fs.readFileSync(filePath);
    const meta = await sharp(buf, { limitInputPixels: false }).metadata();
    // Force a full decode pass to catch truncated/corrupt files that only
    // fail once pixel data (not just headers) is read.
    await sharp(buf, { limitInputPixels: false }).raw().toBuffer();
    return {
      ok: true,
      format: meta.format,
      width: meta.width,
      height: meta.height,
      hasAlpha: !!meta.hasAlpha,
    };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function validateOne(row, idx) {
  const [arabic, english, brand, gender, variant, price, imageFilename, conf, notes] = row;

  const originalPath = findFile(ORIGINAL_DIR, imageFilename);
  const processedPath = findFile(PROCESSED_DIR, imageFilename);

  const record = {
    idx,
    arabic, english, brand, gender, variant, price, imageFilename, conf, notes,
    originalPath: originalPath ? path.relative(ROOT, originalPath) : null,
    processedPath: processedPath ? path.relative(ROOT, processedPath) : null,
  };

  if (!originalPath) {
    record.status = 'MISSING IMAGE';
    record.reason = 'No source file found in products/original/';
    return record;
  }

  const info = await inspect(originalPath);
  if (!info.ok) {
    record.status = 'INVALID IMAGE';
    record.reason = `Corrupt or undecodable: ${info.error}`;
    return record;
  }

  record.format = info.format;
  record.width = info.width;
  record.height = info.height;
  record.aspectRatio = (info.width / info.height).toFixed(3);
  record.hasAlpha = info.hasAlpha;

  const longSide = Math.max(info.width, info.height);
  const issues = [];
  if (longSide < MIN_LONG_SIDE) issues.push(`resolution below ${MIN_LONG_SIDE}px (long side ${longSide}px)`);
  if (!['png', 'jpg', 'jpeg', 'webp'].includes(info.format)) issues.push(`source format '${info.format}' outside accepted PNG/JPG/JPEG/WEBP set (auto-converted to PNG during processing, but original should be re-sourced in an accepted format)`);

  if (Number(conf) < 90 || /NEEDS REVIEW/.test(notes || '')) {
    record.status = 'NEEDS REVIEW';
    record.reason = notes || 'Low confidence score';
    return record;
  }

  if (issues.length) {
    record.status = 'INVALID IMAGE';
    record.reason = issues.join('; ');
    return record;
  }

  if (!processedPath) {
    record.status = 'NEEDS REVIEW';
    record.reason = 'Original present but not yet processed into products/processed/';
    return record;
  }

  record.status = 'READY';
  record.reason = '';
  return record;
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function statusBadgeClass(status) {
  return {
    'READY': 'badge-ready',
    'MISSING IMAGE': 'badge-missing',
    'INVALID IMAGE': 'badge-invalid',
    'NEEDS REVIEW': 'badge-review',
  }[status] || 'badge-review';
}

function buildValidationReportHtml(records) {
  const rows = records.map(r => `
    <tr>
      <td class="ar" dir="rtl">${escapeHtml(r.arabic)}</td>
      <td>${escapeHtml(r.english)}</td>
      <td>${escapeHtml(r.brand)}</td>
      <td>${escapeHtml(r.price)} JOD</td>
      <td><code>${escapeHtml(r.imageFilename)}</code></td>
      <td>${r.originalPath ? `<img src="../${r.originalPath.replace(/\\/g, '/')}" class="thumb" loading="lazy">` : '<span class="none">—</span>'}</td>
      <td>${r.width ? `${r.width}×${r.height}` : '—'}</td>
      <td>${r.format || '—'}</td>
      <td>${r.hasAlpha === undefined ? '—' : (r.hasAlpha ? 'yes' : 'no')}</td>
      <td><span class="badge ${statusBadgeClass(r.status)}">${r.status}</span></td>
      <td class="reason">${escapeHtml(r.reason || '')}</td>
    </tr>
  `).join('\n');

  const counts = records.reduce((acc, r) => { acc[r.status] = (acc[r.status] || 0) + 1; return acc; }, {});

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>VIROZ — Image Validation Report</title>
<style>
  body { font-family: system-ui, -apple-system, sans-serif; margin: 0; padding: 24px; background: #0e0e0e; color: #eee; }
  h1 { color: #d4af37; font-size: 22px; margin-bottom: 4px; }
  .summary { display: flex; gap: 16px; margin: 16px 0 24px; flex-wrap: wrap; }
  .summary div { background: #1a1a1a; border: 1px solid #333; border-radius: 8px; padding: 10px 16px; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; background: #141414; }
  th, td { padding: 8px 10px; border-bottom: 1px solid #262626; text-align: left; vertical-align: middle; }
  th { background: #1a1a1a; color: #d4af37; position: sticky; top: 0; }
  .ar { font-size: 15px; }
  .thumb { width: 56px; height: 56px; object-fit: contain; background: #222; border-radius: 4px; }
  .none { color: #666; }
  code { font-size: 11px; color: #aaa; }
  .reason { color: #999; max-width: 260px; }
  .badge { padding: 3px 8px; border-radius: 12px; font-size: 11px; font-weight: 600; white-space: nowrap; }
  .badge-ready { background: #1e3d24; color: #7ee08d; }
  .badge-missing { background: #3d1e1e; color: #e07e7e; }
  .badge-invalid { background: #3d301e; color: #e0b87e; }
  .badge-review { background: #1e2c3d; color: #7eb8e0; }
</style>
</head>
<body>
  <h1>VIROZ | فيروز — Image Validation Report</h1>
  <div class="summary">
    ${Object.entries(counts).map(([k, v]) => `<div><strong>${v}</strong> ${escapeHtml(k)}</div>`).join('')}
    <div><strong>${records.length}</strong> Total products</div>
  </div>
  <table>
    <thead>
      <tr>
        <th>Arabic name</th><th>English name</th><th>Brand</th><th>Price</th>
        <th>Filename</th><th>Preview</th><th>Dimensions</th><th>Format</th><th>Alpha</th><th>Status</th><th>Reason</th>
      </tr>
    </thead>
    <tbody>
      ${rows}
    </tbody>
  </table>
</body>
</html>`;
}

function buildContactSheetHtml(records) {
  const cards = records.map(r => `
    <div class="card">
      <div class="imgs">
        <div class="imgbox">
          <span class="label">original</span>
          ${r.originalPath ? `<img src="../${r.originalPath.replace(/\\/g, '/')}" loading="lazy">` : '<div class="placeholder">MISSING</div>'}
        </div>
        <div class="imgbox">
          <span class="label">processed</span>
          ${r.processedPath ? `<img src="../${r.processedPath.replace(/\\/g, '/')}" loading="lazy">` : '<div class="placeholder">—</div>'}
        </div>
      </div>
      <div class="meta">
        <div class="name" dir="rtl">${escapeHtml(r.arabic)}</div>
        <div class="name-en">${escapeHtml(r.english)} · ${escapeHtml(r.brand)}</div>
        <div class="price">${escapeHtml(r.price)} JOD</div>
        <span class="badge ${statusBadgeClass(r.status)}">${r.status}</span>
      </div>
    </div>
  `).join('\n');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>VIROZ — Image Contact Sheet</title>
<style>
  body { font-family: system-ui, -apple-system, sans-serif; margin: 0; padding: 24px; background: #0e0e0e; color: #eee; }
  h1 { color: #d4af37; font-size: 22px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 16px; }
  .card { background: #141414; border: 1px solid #262626; border-radius: 10px; padding: 12px; }
  .imgs { display: flex; gap: 8px; }
  .imgbox { flex: 1; text-align: center; }
  .imgbox img { width: 100%; height: 110px; object-fit: contain; background: #1e1e1e; border-radius: 6px; }
  .placeholder { width: 100%; height: 110px; display: flex; align-items: center; justify-content: center; background: #1e1e1e; border-radius: 6px; color: #555; font-size: 11px; }
  .label { display: block; font-size: 10px; color: #777; margin-bottom: 4px; text-transform: uppercase; letter-spacing: .05em; }
  .meta { margin-top: 8px; }
  .name { font-size: 15px; }
  .name-en { font-size: 12px; color: #999; margin: 2px 0; }
  .price { font-size: 13px; color: #d4af37; margin-bottom: 6px; }
  .badge { padding: 3px 8px; border-radius: 12px; font-size: 11px; font-weight: 600; }
  .badge-ready { background: #1e3d24; color: #7ee08d; }
  .badge-missing { background: #3d1e1e; color: #e07e7e; }
  .badge-invalid { background: #3d301e; color: #e0b87e; }
  .badge-review { background: #1e2c3d; color: #7eb8e0; }
</style>
</head>
<body>
  <h1>VIROZ | فيروز — Contact Sheet (${records.length} products)</h1>
  <div class="grid">
    ${cards}
  </div>
</body>
</html>`;
}

async function main() {
  const csvText = fs.readFileSync(CSV_PATH, 'utf8');
  const rows = parseCsv(csvText);
  const dataRows = rows.slice(1);

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const records = [];
  for (let i = 0; i < dataRows.length; i++) {
    records.push(await validateOne(dataRows[i], i));
  }

  fs.writeFileSync(path.join(OUTPUT_DIR, 'validation-results.json'), JSON.stringify(records, null, 2));
  fs.writeFileSync(path.join(ROOT, 'image-validation-report.html'), buildValidationReportHtml(records));
  fs.writeFileSync(path.join(OUTPUT_DIR, 'image-validation-report.html'), buildValidationReportHtml(records));
  fs.writeFileSync(path.join(OUTPUT_DIR, 'image-contact-sheet.html'), buildContactSheetHtml(records));

  const counts = records.reduce((acc, r) => { acc[r.status] = (acc[r.status] || 0) + 1; return acc; }, {});
  console.log('Validation summary:', counts);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
