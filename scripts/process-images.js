/**
 * Processes original product photos into catalog-ready assets.
 *
 * For each row in data/viroz_perfumes_mapping.csv, looks for the matching
 * file in products/original/ (any of .png/.jpg/.jpeg/.webp), removes the
 * background with a real segmentation model (not naive white-pixel removal,
 * so transparent glass / reflections / soft shadows survive), trims the
 * excess margin, centers the bottle on a 1000x1000 transparent canvas
 * without stretching or cropping, and writes the result to
 * products/processed/<image_filename>.
 */

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { removeBackground } = require('@imgly/background-removal-node');

const ROOT = path.join(__dirname, '..');
const CSV_PATH = path.join(ROOT, 'data', 'viroz_perfumes_mapping.csv');
const ORIGINAL_DIR = path.join(ROOT, 'products', 'original');
const PROCESSED_DIR = path.join(ROOT, 'products', 'processed');

const CANVAS = 1000;
const SOURCE_EXTS = ['.png', '.jpg', '.jpeg', '.webp', '.gif'];

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

function findSourceFile(baseFilename) {
  const base = baseFilename.replace(/\.[^.]+$/, '');
  for (const ext of SOURCE_EXTS) {
    const p = path.join(ORIGINAL_DIR, base + ext);
    if (fs.existsSync(p)) return p;
  }
  // also allow exact filename match regardless of extension mismatch
  const exact = path.join(ORIGINAL_DIR, baseFilename);
  if (fs.existsSync(exact)) return exact;
  return null;
}

async function processOne(imageFilename) {
  const src = findSourceFile(imageFilename);
  if (!src) {
    return { imageFilename, status: 'MISSING_SOURCE' };
  }

  let inputBuffer = fs.readFileSync(src);
  const inputMeta = await sharp(inputBuffer, { limitInputPixels: false }).metadata();
  const directMime = { jpeg: 'image/jpeg', jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
  let mimeType = directMime[inputMeta.format];
  if (!mimeType) {
    // Formats the segmentation library doesn't accept directly (gif, avif, ...)
    // — re-encode to PNG with sharp first, since sharp itself decodes them fine.
    try {
      inputBuffer = await sharp(inputBuffer, { limitInputPixels: false }).png().toBuffer();
      mimeType = 'image/png';
    } catch (err) {
      return { imageFilename, status: 'INVALID_FORMAT', error: `Unsupported source format: ${inputMeta.format} (${err.message})` };
    }
  }

  // Segmentation-based background removal (preserves semi-transparent
  // glass edges/reflections far better than a color-key/white-pixel cutout).
  // The library requires an explicit MIME type on the input Blob — a plain
  // Buffer decodes to an untyped Blob and fails with "Unsupported format:".
  let cutoutBuffer;
  try {
    const inputBlob = new Blob([inputBuffer], { type: mimeType });
    const blob = await removeBackground(inputBlob, {
      output: { format: 'image/png' },
    });
    cutoutBuffer = Buffer.from(await blob.arrayBuffer());
  } catch (err) {
    return { imageFilename, status: 'SEGMENTATION_FAILED', error: err.message };
  }

  const img = sharp(cutoutBuffer, { limitInputPixels: false }).ensureAlpha();
  const meta = await img.metadata();

  // Trim fully-transparent margins without touching opaque pixel content.
  const trimmed = img.trim({ threshold: 5 });
  const trimmedBuffer = await trimmed.png().toBuffer();
  const trimmedMeta = await sharp(trimmedBuffer).metadata();

  const w = trimmedMeta.width;
  const h = trimmedMeta.height;

  // Scale to fit inside the canvas (with a small padding margin) preserving
  // aspect ratio — never stretch, never crop.
  const padding = Math.round(CANVAS * 0.06);
  const maxDim = CANVAS - padding * 2;
  const scale = Math.min(maxDim / w, maxDim / h, 1 /* never upscale beyond source unless smaller than target */);
  const targetW = Math.max(1, Math.round(w * scale));
  const targetH = Math.max(1, Math.round(h * scale));

  const resized = await sharp(trimmedBuffer)
    .resize(targetW, targetH, { fit: 'inside', withoutEnlargement: false })
    .png()
    .toBuffer();

  const canvas = sharp({
    create: {
      width: CANVAS,
      height: CANVAS,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  });

  const left = Math.round((CANVAS - targetW) / 2);
  const top = Math.round((CANVAS - targetH) / 2);

  const outBuffer = await canvas
    .composite([{ input: resized, left, top }])
    .png()
    .toBuffer();

  const outPath = path.join(PROCESSED_DIR, imageFilename.replace(/\.[^.]+$/, '.png'));
  fs.writeFileSync(outPath, outBuffer);

  return {
    imageFilename,
    status: 'PROCESSED',
    sourceWidth: meta.width,
    sourceHeight: meta.height,
    outputPath: path.relative(ROOT, outPath),
  };
}

async function main() {
  const csvText = fs.readFileSync(CSV_PATH, 'utf8');
  const rows = parseCsv(csvText);
  const header = rows[0];
  const filenameIdx = header.indexOf('image_filename');
  const dataRows = rows.slice(1);

  fs.mkdirSync(PROCESSED_DIR, { recursive: true });

  const results = [];
  for (const row of dataRows) {
    const imageFilename = row[filenameIdx];
    if (!imageFilename) continue;
    process.stdout.write(`Processing ${imageFilename} ... `);
    const result = await processOne(imageFilename);
    console.log(result.status);
    results.push(result);
  }

  fs.writeFileSync(
    path.join(ROOT, 'output', 'process-results.json'),
    JSON.stringify(results, null, 2)
  );

  const summary = results.reduce((acc, r) => {
    acc[r.status] = (acc[r.status] || 0) + 1;
    return acc;
  }, {});
  console.log('\nSummary:', summary);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
