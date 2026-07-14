/**
 * Data access layer. Keeps the catalog data (assets/data/products.json)
 * completely separate from rendering (app.js) — replace the JSON file
 * and the site picks it up on next load, no HTML/JS edits needed.
 */
const ProductsData = (() => {
  const DATA_URL = './assets/data/products.json';
  const PLACEHOLDER_IMAGE = './assets/images/placeholder-bottle.svg';

  let cache = null;

  async function load() {
    if (cache) return cache;
    const res = await fetch(DATA_URL, { cache: 'no-store' });
    if (!res.ok) throw new Error(`Failed to load product data (${res.status})`);
    cache = await res.json();
    return cache;
  }

  function imageSrc(product) {
    return product.image || PLACEHOLDER_IMAGE;
  }

  function genderLabel(gender) {
    return { Women: 'نسائي', Men: 'رجالي', Unisex: 'للجنسين' }[gender] || gender || '—';
  }

  function statusLabel(status) {
    return {
      READY: 'جاهز',
      MANUAL_REVIEW: 'قيد المراجعة',
      COMING_SOON: 'الصورة قريباً',
    }[status] || status;
  }

  function uniqueBrands(products) {
    return [...new Set(products.map(p => p.brand))].sort((a, b) => a.localeCompare(b));
  }

  return { load, imageSrc, genderLabel, statusLabel, uniqueBrands, PLACEHOLDER_IMAGE };
})();
