/**
 * Rendering + interaction layer: grid, search, filters, sort, modal,
 * lazy loading, hero particles, scroll-in animation.
 */
(function () {
  'use strict';

  let allProducts = [];
  let state = { search: '', brand: '', gender: '', priceRange: '', sort: 'default' };

  const grid = document.getElementById('productsGrid');
  const resultsCount = document.getElementById('resultsCount');
  const noResults = document.getElementById('noResults');
  const searchInput = document.getElementById('searchInput');
  const brandFilter = document.getElementById('brandFilter');
  const genderFilter = document.getElementById('genderFilter');
  const priceFilter = document.getElementById('priceFilter');
  const sortSelect = document.getElementById('sortSelect');

  function createParticles(count) {
    const container = document.getElementById('goldParticles');
    if (!container) return;
    const frag = document.createDocumentFragment();
    for (let i = 0; i < count; i++) {
      const span = document.createElement('span');
      span.style.setProperty('--x', `${Math.random() * 100}%`);
      span.style.setProperty('--size', `${2 + Math.random() * 4}px`);
      span.style.setProperty('--dur', `${10 + Math.random() * 14}s`);
      span.style.setProperty('--delay', `${Math.random() * -20}s`);
      frag.appendChild(span);
    }
    container.appendChild(frag);
  }

  function populateBrandFilter(products) {
    const brands = ProductsData.uniqueBrands(products);
    const frag = document.createDocumentFragment();
    brands.forEach(b => {
      const opt = document.createElement('option');
      opt.value = b;
      opt.textContent = b;
      frag.appendChild(opt);
    });
    brandFilter.appendChild(frag);
  }

  function matchesFilters(p) {
    if (state.search && !p.arabic_name.includes(state.search) && !p.english_name.toLowerCase().includes(state.search.toLowerCase())) {
      return false;
    }
    if (state.brand && p.brand !== state.brand) return false;
    if (state.gender && p.gender !== state.gender) return false;
    if (state.priceRange) {
      const [min, max] = state.priceRange.split('-').map(Number);
      if (p.price_jod < min || p.price_jod > max) return false;
    }
    return true;
  }

  function sortProducts(list) {
    const sorted = [...list];
    switch (state.sort) {
      case 'price-asc': sorted.sort((a, b) => a.price_jod - b.price_jod); break;
      case 'price-desc': sorted.sort((a, b) => b.price_jod - a.price_jod); break;
      case 'alpha': sorted.sort((a, b) => a.arabic_name.localeCompare(b.arabic_name, 'ar')); break;
      default: break;
    }
    return sorted;
  }

  function cardTemplate(p) {
    const src = ProductsData.imageSrc(p);
    const badge = ProductsData.statusLabel(p.status);
    return `
      <article class="product-card" data-id="${p.id}" tabindex="0" role="button" aria-label="${p.arabic_name}">
        <div class="card-image-wrap">
          <span class="status-badge status-${p.status}">${badge}</span>
          <img src="${src}" alt="${p.arabic_name}" loading="lazy" decoding="async">
        </div>
        <div class="card-body">
          <h3 class="card-name">${p.arabic_name}</h3>
          <p class="card-brand">${p.brand}</p>
          <div class="card-price">${p.price_jod} <span class="currency">دينار</span></div>
        </div>
      </article>
    `;
  }

  function render() {
    const filtered = allProducts.filter(matchesFilters);
    const sorted = sortProducts(filtered);

    resultsCount.textContent = `${sorted.length} من ${allProducts.length} عطر`;
    noResults.hidden = sorted.length !== 0;
    grid.innerHTML = sorted.map(cardTemplate).join('');

    observeCards();
    attachCardHandlers(sorted);
  }

  function attachCardHandlers(products) {
    const byId = Object.fromEntries(products.map(p => [p.id, p]));
    grid.querySelectorAll('.product-card').forEach(card => {
      const open = () => openModal(byId[card.dataset.id]);
      card.addEventListener('click', open);
      card.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
      });
    });
  }

  let cardObserver;
  function observeCards() {
    if (!('IntersectionObserver' in window)) {
      grid.querySelectorAll('.product-card').forEach(c => c.classList.add('in-view'));
      return;
    }
    if (cardObserver) cardObserver.disconnect();
    cardObserver = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('in-view');
          cardObserver.unobserve(entry.target);
        }
      });
    }, { threshold: 0.08, rootMargin: '80px' });
    grid.querySelectorAll('.product-card:not(.in-view)').forEach(c => cardObserver.observe(c));
  }

  // ---------------- modal ----------------
  const modalOverlay = document.getElementById('modalOverlay');
  const modalImage = document.getElementById('modalImage');
  const modalBadge = document.getElementById('modalBadge');
  const modalTitle = document.getElementById('modalTitle');
  const modalEnglish = document.getElementById('modalEnglish');
  const modalBrand = document.getElementById('modalBrand');
  const modalVariant = document.getElementById('modalVariant');
  const modalGender = document.getElementById('modalGender');
  const modalPrice = document.getElementById('modalPrice');
  const modalClose = document.getElementById('modalClose');

  function openModal(p) {
    if (!p) return;
    modalImage.src = ProductsData.imageSrc(p);
    modalImage.alt = p.arabic_name;
    modalBadge.textContent = ProductsData.statusLabel(p.status);
    modalBadge.className = `modal-badge status-${p.status}`;
    modalTitle.textContent = p.arabic_name;
    modalEnglish.textContent = p.english_name;
    modalBrand.textContent = p.brand;
    modalVariant.textContent = p.exact_variant || '—';
    modalGender.textContent = ProductsData.genderLabel(p.gender);
    modalPrice.textContent = p.price_jod;

    modalOverlay.hidden = false;
    document.body.style.overflow = 'hidden';
  }

  function closeModal() {
    modalOverlay.hidden = true;
    document.body.style.overflow = '';
  }

  modalClose.addEventListener('click', closeModal);
  modalOverlay.addEventListener('click', (e) => { if (e.target === modalOverlay) closeModal(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !modalOverlay.hidden) closeModal(); });

  // ---------------- controls ----------------
  let searchDebounce;
  searchInput.addEventListener('input', (e) => {
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(() => {
      state.search = e.target.value.trim();
      render();
    }, 150);
  });
  brandFilter.addEventListener('change', (e) => { state.brand = e.target.value; render(); });
  genderFilter.addEventListener('change', (e) => { state.gender = e.target.value; render(); });
  priceFilter.addEventListener('change', (e) => { state.priceRange = e.target.value; render(); });
  sortSelect.addEventListener('change', (e) => { state.sort = e.target.value; render(); });

  const searchToggle = document.getElementById('searchToggle');
  if (searchToggle) {
    searchToggle.addEventListener('click', () => {
      document.getElementById('catalog').scrollIntoView({ behavior: 'smooth' });
      setTimeout(() => searchInput.focus(), 400);
    });
  }

  // ---------------- header shrink on scroll ----------------
  const header = document.getElementById('siteHeader');
  window.addEventListener('scroll', () => {
    header.style.boxShadow = window.scrollY > 20 ? '0 6px 24px rgba(0,0,0,0.4)' : 'none';
  });

  // ---------------- footer year ----------------
  const yearEl = document.getElementById('footerYear');
  if (yearEl) yearEl.textContent = new Date().getFullYear();

  function injectStructuredData(products) {
    const script = document.getElementById('productListSchema');
    if (!script) return;
    const base = location.href.replace(/index\.html$/, '');
    script.textContent = JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'ItemList',
      name: 'VIROZ Perfume Catalog',
      itemListElement: products.map((p, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        item: {
          '@type': 'Product',
          name: p.arabic_name,
          alternateName: p.english_name,
          brand: { '@type': 'Brand', name: p.brand },
          image: p.image ? base + p.image : undefined,
          offers: {
            '@type': 'Offer',
            price: p.price_jod,
            priceCurrency: 'JOD',
            availability: 'https://schema.org/InStock',
          },
        },
      })),
    });
  }

  // ---------------- init ----------------
  async function init() {
    createParticles(28);
    try {
      allProducts = await ProductsData.load();
      populateBrandFilter(allProducts);
      render();
      injectStructuredData(allProducts);
    } catch (err) {
      grid.innerHTML = `<p class="no-results">تعذر تحميل بيانات المنتجات. (${err.message})</p>`;
      console.error(err);
    }
  }

  init();
})();
