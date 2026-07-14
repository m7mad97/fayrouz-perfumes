/**
 * Builds assets/data/products.json — the single source of truth for the
 * website UI. Merges the cleaned catalog CSV with the image validation
 * results so the site can render an honest status per product without
 * ever hiding or dropping one.
 *
 * Re-run this after re-running validate-images.js so the site picks up
 * newly acquired images. The UI (index.html/app.js) never needs to change
 * when this file's contents change — that's the "admin ready" split.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const CSV_PATH = path.join(ROOT, 'data', 'viroz_perfumes_mapping.csv');
const VALIDATION_PATH = path.join(ROOT, 'output', 'validation-results.json');
const PROCESSED_DIR = path.join(ROOT, 'products', 'processed');
const OUT_PATH = path.join(ROOT, 'assets', 'data', 'products.json');

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

function slugify(str) {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

function main() {
  const csvRows = parseCsv(fs.readFileSync(CSV_PATH, 'utf8'));
  const header = csvRows[0];
  const idx = Object.fromEntries(header.map((h, i) => [h, i]));
  const dataRows = csvRows.slice(1);

  const validation = fs.existsSync(VALIDATION_PATH)
    ? JSON.parse(fs.readFileSync(VALIDATION_PATH, 'utf8'))
    : [];
  const validationByEnglish = Object.fromEntries(validation.map(v => [v.english, v]));

  const products = dataRows.map((r, i) => {
    const english = r[idx.english_name];
    const imageFilename = r[idx.image_filename];
    const base = imageFilename.replace(/\.[^.]+$/, '');
    const processedFile = base + '.png';
    const processedPath = path.join(PROCESSED_DIR, processedFile);
    const hasImage = fs.existsSync(processedPath);
    const v = validationByEnglish[english];
    const validationStatus = v ? v.status : 'MISSING IMAGE';

    let uiStatus;
    if (!hasImage) {
      uiStatus = 'COMING_SOON';
    } else if (validationStatus === 'READY') {
      uiStatus = 'READY';
    } else {
      uiStatus = 'MANUAL_REVIEW';
    }

    return {
      id: slugify(english) + '-' + i,
      arabic_name: r[idx.arabic_name],
      english_name: english,
      brand: r[idx.brand],
      gender: r[idx.gender],
      exact_variant: r[idx.exact_variant],
      price_jod: Number(r[idx.price_jod]),
      image_filename: imageFilename,
      image: hasImage ? `products/processed/${processedFile}` : null,
      confidence_score: Number(r[idx.confidence_score]),
      notes: r[idx.notes],
      status: uiStatus,
    };
  });

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, JSON.stringify(products, null, 2));

  const counts = products.reduce((acc, p) => { acc[p.status] = (acc[p.status] || 0) + 1; return acc; }, {});
  console.log(`Wrote ${products.length} products to ${path.relative(ROOT, OUT_PATH)}`);
  console.log('Status breakdown:', counts);
}

main();
