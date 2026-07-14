# فيروز | VIROZ — Perfume Catalog Website

A production-ready, static, RTL Arabic landing page for a perfume price catalog.
Black + gold luxury theme, no build step, no frameworks — plain HTML/CSS/JS.

## Project structure

```
viroz-perfume-poster/
├── index.html                  ← the website (single page)
├── assets/
│   ├── css/style.css           ← all styling (RTL, responsive grid, animations)
│   ├── js/
│   │   ├── products.js         ← data-loading layer (fetches assets/data/products.json)
│   │   └── app.js              ← rendering, search, filters, sort, modal, particles
│   ├── data/products.json      ← THE CATALOG — edit this file to change products
│   ├── images/
│   │   ├── placeholder-bottle.svg   ← "Image Coming Soon" placeholder
│   │   └── og-cover.jpg             ← social share preview image
│   └── fonts/                  ← self-hosted Cairo (Arabic) + Playfair Display (headings)
├── data/
│   ├── viroz_perfumes_mapping.csv  ← master product catalog (source of truth for data)
│   └── image-sources.csv           ← per-product image research/acquisition log
├── products/
│   ├── original/                ← downloaded source photos
│   └── processed/                ← 1000×1000 transparent PNGs used by the site
├── scripts/                     ← the whole data + image pipeline (see below)
├── output/                      ← validation/acquisition HTML reports
└── README.md
```

## Updating the catalog (no code changes needed)

The site reads **`assets/data/products.json`** at runtime. To change prices, add/remove
products, or pick up newly acquired images, you only ever need to touch that file (or
regenerate it) — `index.html`, `style.css`, and the JS never need to change.

Each entry looks like:

```json
{
  "id": "good-girl-0",
  "arabic_name": "جود جيرل بلاك كارولينا هيريرا",
  "english_name": "Good Girl",
  "brand": "Carolina Herrera",
  "gender": "Women",
  "exact_variant": "Good Girl EDP",
  "price_jod": 42,
  "image": "products/processed/carolina-herrera-good-girl.png",
  "status": "READY"
}
```

`status` is one of `READY`, `MANUAL_REVIEW`, `COMING_SOON` and drives the badge shown
on the card. `image` is `null` when no processed photo exists yet — the site falls back
to the gold placeholder silhouette automatically, it never hides or drops a product.

## Regenerating products.json from the CSV pipeline

If you edit `data/viroz_perfumes_mapping.csv` (prices, products) or acquire new images,
regenerate the JSON the site reads:

```bash
cd viroz-perfume-poster
node scripts/validate-images.js        # re-checks products/processed/ against the CSV
node scripts/build-products-json.js     # rebuilds assets/data/products.json
```

Full pipeline (only needed when sourcing new photos):

```bash
node scripts/acquire-images.js          # downloads approved images from data/image-sources.csv
node scripts/process-images.js          # background removal + center + 1000x1000 transparent PNG
node scripts/validate-images.js         # READY / NEEDS REVIEW / MISSING / INVALID
node scripts/build-acquisition-report.js
node scripts/build-products-json.js
```

## Running locally

Any static file server works. A zero-dependency one is included:

```bash
cd viroz-perfume-poster
node scripts/serve.js         # serves on http://localhost:8080
```

Opening `index.html` directly via `file://` will NOT work — `fetch()` of
`assets/data/products.json` is blocked by browser CORS rules for local files.
Always serve it over HTTP (this local server, or any static host below).

## Deploying

This is a plain static site — upload the `viroz-perfume-poster/` folder as-is to any
static host (Netlify, Vercel, GitHub Pages, S3 + CloudFront, cPanel, etc). No build step.

## Design notes

- **Colors**: black (`#0a0a0a`) / charcoal / gold (`#d4af37`) only — no bright accents.
- **Fonts**: Cairo (Arabic body/UI) + Playfair Display (headings/prices), both self-hosted
  under `assets/fonts/` (OFL-licensed, no external requests, no CDN dependency).
- **Grid**: 5 columns desktop → 4 laptop (≤1180px) → 3 tablet (≤900px) → 2 mobile (≤640px).
- **Placeholder policy**: every product in the CSV is always rendered. Missing/invalid
  images never remove a card — they show the gold bottle-silhouette placeholder with
  "Image Coming Soon" / "الصورة قريباً" instead.
- **Status badges**: `READY` (green), `MANUAL_REVIEW` (amber — image exists but needs a
  data/quality check), `COMING_SOON` (gray — no image yet).

## Known limitations

- 27 of 46 products currently have `COMING_SOON` status — official brand sites for
  those either blocked automated fetching (HTTP 403) or no verified direct image URL
  was found. See `output/image-acquisition-report.html` for the exact reason per product
  and `data/image-sources.csv` for retailer leads that need a manual visit.
- Fonts are shipped as `.ttf` (not `.woff2`) for simplicity; convert if you want to
  shave a few KB off first load.
