/**
 * Builds output/image-acquisition-report.html from data/image-sources.csv,
 * showing exactly what was found/downloaded/rejected per product and why.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const CSV_PATH = path.join(ROOT, 'data', 'image-sources.csv');
const ORIGINAL_DIR = path.join(ROOT, 'products', 'original');
const OUTPUT_DIR = path.join(ROOT, 'output');

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

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function findOriginal(baseFilename) {
  const base = baseFilename.replace(/\.[^.]+$/, '');
  for (const ext of ['.png', '.jpg', '.jpeg', '.webp', '.gif']) {
    const p = path.join(ORIGINAL_DIR, base + ext);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function statusBadgeClass(status) {
  return {
    'DOWNLOADED': 'badge-ready',
    'NOT_DOWNLOADED': 'badge-review',
    'FAILED': 'badge-invalid',
  }[status] || 'badge-review';
}

function main() {
  const text = fs.readFileSync(CSV_PATH, 'utf8');
  const rows = parseCsv(text);
  const header = rows[0];
  const idx = Object.fromEntries(header.map((h, i) => [h, i]));
  const dataRows = rows.slice(1);

  const cards = dataRows.map(r => {
    const arabic = r[idx.arabic_name];
    const english = r[idx.english_name];
    const brand = r[idx.brand];
    const variant = r[idx.exact_variant];
    const productPageUrl = r[idx.product_page_url];
    const imageUrl = r[idx.image_url];
    const method = r[idx.acquisition_method];
    const identityMatch = r[idx.identity_match];
    const downloadStatus = r[idx.download_status];
    const notes = r[idx.notes];
    const originalPath = findOriginal(r[idx.image_filename]);

    return `
    <tr>
      <td dir="rtl">${escapeHtml(arabic)}</td>
      <td>${escapeHtml(english)}</td>
      <td>${escapeHtml(brand)}</td>
      <td>${escapeHtml(variant)}</td>
      <td>${productPageUrl ? `<a href="${escapeHtml(productPageUrl)}" target="_blank" rel="noopener">page</a>` : '—'}</td>
      <td>${imageUrl ? `<a href="${escapeHtml(imageUrl)}" target="_blank" rel="noopener">source</a>` : '—'}</td>
      <td>${escapeHtml(method)}</td>
      <td>${originalPath ? `<img src="../${path.relative(ROOT, originalPath).replace(/\\/g, '/')}" class="thumb">` : '<span class="none">—</span>'}</td>
      <td>${escapeHtml(identityMatch)}</td>
      <td><span class="badge ${statusBadgeClass(downloadStatus)}">${escapeHtml(downloadStatus)}</span></td>
      <td class="notes">${escapeHtml(notes)}</td>
    </tr>`;
  }).join('\n');

  const counts = dataRows.reduce((acc, r) => {
    const s = r[idx.download_status];
    acc[s] = (acc[s] || 0) + 1;
    return acc;
  }, {});

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>VIROZ — Image Acquisition Report</title>
<style>
  body { font-family: system-ui, -apple-system, sans-serif; margin: 0; padding: 24px; background: #0e0e0e; color: #eee; }
  h1 { color: #d4af37; font-size: 22px; }
  .summary { display: flex; gap: 16px; margin: 16px 0 24px; flex-wrap: wrap; }
  .summary div { background: #1a1a1a; border: 1px solid #333; border-radius: 8px; padding: 10px 16px; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; background: #141414; }
  th, td { padding: 6px 8px; border-bottom: 1px solid #262626; text-align: left; vertical-align: middle; }
  th { background: #1a1a1a; color: #d4af37; position: sticky; top: 0; }
  .thumb { width: 48px; height: 48px; object-fit: contain; background: #222; border-radius: 4px; }
  .none { color: #666; }
  .notes { color: #999; max-width: 320px; }
  a { color: #7eb8e0; }
  .badge { padding: 3px 8px; border-radius: 12px; font-size: 11px; font-weight: 600; white-space: nowrap; }
  .badge-ready { background: #1e3d24; color: #7ee08d; }
  .badge-invalid { background: #3d1e1e; color: #e07e7e; }
  .badge-review { background: #1e2c3d; color: #7eb8e0; }
</style>
</head>
<body>
  <h1>VIROZ | فيروز — Image Acquisition Report</h1>
  <div class="summary">
    ${Object.entries(counts).map(([k, v]) => `<div><strong>${v}</strong> ${escapeHtml(k)}</div>`).join('')}
    <div><strong>${dataRows.length}</strong> Total products</div>
  </div>
  <table>
    <thead>
      <tr>
        <th>Arabic</th><th>English</th><th>Brand</th><th>Variant</th><th>Product page</th><th>Image source</th>
        <th>Method</th><th>Original</th><th>Identity match</th><th>Status</th><th>Notes</th>
      </tr>
    </thead>
    <tbody>${cards}</tbody>
  </table>
</body>
</html>`;

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUTPUT_DIR, 'image-acquisition-report.html'), html);
  console.log('Acquisition report written. Status counts:', counts);
}

main();
