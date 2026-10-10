import { buildQuery, search, getMetadata, extractStills, createLimiter } from './ia.js';

const ROWS = 24;
const STILLS_PER_SHOW = 8;

const $ = (sel, root = document) => root.querySelector(sel);
const el = {
  form: $('#search-form'), q: $('#q'), sort: $('#sort'), era: $('#era'), region: $('#region'),
  scope: $('#scope'), random: $('#random-btn'), viewBtns: document.querySelectorAll('.view-switch .chip'),
  masthead: $('.masthead'), browse: $('#browse'), browseToggle: $('#browse-toggle'), regions: $('#regions'), topics: $('#topics'),
  results: $('#results'), resultsTitle: $('#results-title'), resultsMeta: $('#results-meta'),
  status: $('#status'), wall: $('#wall'), shows: $('#shows'), more: $('#more-btn'),
  lightbox: $('#lightbox'), lbImg: $('#lb-img'), lbTitle: $('#lb-title'), lbSub: $('#lb-sub'),
  lbItem: $('#lb-item'), lbFile: $('#lb-file'), about: $('#about'), aboutLink: $('#about-link'),
  stillTpl: $('#still-tpl'), showTpl: $('#show-tpl'),
};

const state = {
  catalog: null,
  view: 'stills',
  terms: '', preset: '', presetLabel: '', sort: '', era: '', region: '',
  scoped: true,
  page: 0, numFound: 0, q: '',
  docs: [],                 // normalized search docs in order
  stills: [],               // flat list: { doc, name, url, seq, idx }
  controller: null,
};

const limit = createLimiter(4);
const observer = new IntersectionObserver(onIntersect, { rootMargin: '600px 0px' });

init();

async function init() {
  try {
    const res = await fetch('data/catalog.json', { cache: 'no-cache' });
    state.catalog = await res.json();
  } catch (e) {
    state.catalog = { regions: [], topics: [], eras: [], defaultScope: '' };
    showStatus('Could not load data/catalog.json — the station list is unavailable, but search still works.', 'warn');
  }
  renderBrowse();
  bind();
  readHash();
  if (state.terms || state.preset) runSearch({ reset: true });
}

/* ---------------- Browse section ---------------- */

function renderBrowse() {
  const { regions = [], topics = [], eras = [] } = state.catalog;
  el.regions.innerHTML = '';
  for (const r of regions) {
    const sec = document.createElement('section');
    sec.className = 'region';
    sec.innerHTML = `<h3>${esc(r.name)}</h3><p class="muted">${esc(r.blurb || '')}</p><div class="chips"></div>`;
    const chips = $('.chips', sec);
    for (const s of r.stations) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'chip';
      b.innerHTML = `<strong>${esc(s.name)}</strong><span class="muted"> · ${esc(s.place)}</span>`;
      if (s.note) b.title = s.note;
      b.addEventListener('click', () => usePreset(s.q, s.name));
      chips.appendChild(b);
    }
    el.regions.appendChild(sec);
    const opt = new Option(r.name, r.id);
    el.region.add(opt);
  }
  el.topics.innerHTML = '';
  for (const t of topics) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'chip';
    b.textContent = t.name;
    b.addEventListener('click', () => usePreset(t.q, t.name));
    el.topics.appendChild(b);
  }
  for (const e of eras) el.era.add(new Option(e.name, e.name));
}

function usePreset(q, label) {
  state.preset = q; state.presetLabel = label;
  state.terms = el.q.value.trim();
  runSearch({ reset: true });
}

/* ---------------- Events ---------------- */

function bind() {
  el.form.addEventListener('submit', (e) => {
    e.preventDefault();
    state.terms = el.q.value.trim();
    if (state.terms) { state.preset = ''; state.presetLabel = ''; }
    runSearch({ reset: true });
  });
  el.sort.addEventListener('change', () => { state.sort = el.sort.value; if (state.q) runSearch({ reset: true }); });
  el.era.addEventListener('change', () => { state.era = el.era.value; if (state.q) runSearch({ reset: true }); });
  el.region.addEventListener('change', () => { state.region = el.region.value; if (state.q) runSearch({ reset: true }); });
  el.scope.addEventListener('change', () => { state.scoped = el.scope.checked; if (state.q) runSearch({ reset: true }); });
  el.more.addEventListener('click', () => runSearch({ reset: false }));
  el.random.addEventListener('click', surpriseMe);
  el.viewBtns.forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));
  el.aboutLink.addEventListener('click', (e) => { e.preventDefault(); el.about.showModal(); });
  el.browseToggle.addEventListener('click', () => collapseBrowse(!el.browse.classList.contains('is-collapsed')));

  const sizeMasthead = () => document.documentElement.style.setProperty('--masthead-h', `${el.masthead.offsetHeight}px`);
  sizeMasthead();
  window.addEventListener('resize', sizeMasthead);

  el.lightbox.addEventListener('click', (e) => {
    const action = e.target.closest('[data-action]')?.dataset.action;
    if (action === 'close') el.lightbox.close();
    else if (action === 'prev') stepLightbox(-1);
    else if (action === 'next') stepLightbox(1);
    else if (action === 'copy') copyLink();
    else if (e.target === el.lightbox) el.lightbox.close();
  });

  document.addEventListener('keydown', (e) => {
    if (el.lightbox.open) {
      if (e.key === 'ArrowLeft') stepLightbox(-1);
      if (e.key === 'ArrowRight') stepLightbox(1);
      return;
    }
    if (e.key === '/' && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName)) {
      e.preventDefault(); el.q.focus(); el.q.select();
    }
  });

  window.addEventListener('hashchange', () => { readHash(); if (state.terms || state.preset) runSearch({ reset: true }); });
}

function collapseBrowse(collapsed) {
  el.browse.classList.toggle('is-collapsed', collapsed);
  el.browseToggle.textContent = collapsed ? 'Show stations & themes' : 'Hide';
  el.browseToggle.setAttribute('aria-expanded', String(!collapsed));
}

function goToResults() {
  collapseBrowse(true);
  el.results.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function setView(view) {
  state.view = view;
  el.viewBtns.forEach((b) => {
    const on = b.dataset.view === view;
    b.classList.toggle('is-active', on);
    b.setAttribute('aria-pressed', String(on));
  });
  el.wall.hidden = view !== 'stills' || !state.docs.length;
  el.shows.hidden = view !== 'shows' || !state.docs.length;
  writeHash();
}

/* ---------------- URL state ---------------- */

function readHash() {
  const p = new URLSearchParams(location.hash.slice(1));
  state.terms = p.get('q') || '';
  state.preset = p.get('preset') || '';
  state.presetLabel = p.get('label') || '';
  state.sort = p.get('sort') || '';
  state.era = p.get('era') || '';
  state.region = p.get('region') || '';
  state.scoped = p.get('all') !== '1';
  state.view = p.get('view') === 'shows' ? 'shows' : 'stills';
  el.q.value = state.terms; el.sort.value = state.sort; el.era.value = state.era; el.region.value = state.region;
  el.scope.checked = state.scoped;
  setViewButtons();
}

function setViewButtons() {
  el.viewBtns.forEach((b) => {
    const on = b.dataset.view === state.view;
    b.classList.toggle('is-active', on);
    b.setAttribute('aria-pressed', String(on));
  });
}

function writeHash() {
  const p = new URLSearchParams();
  if (state.terms) p.set('q', state.terms);
  if (state.preset) { p.set('preset', state.preset); if (state.presetLabel) p.set('label', state.presetLabel); }
  if (state.sort) p.set('sort', state.sort);
  if (state.era) p.set('era', state.era);
  if (state.region) p.set('region', state.region);
  if (!state.scoped) p.set('all', '1');
  if (state.view !== 'stills') p.set('view', state.view);
  const h = p.toString();
  if (location.hash.slice(1) !== h) history.replaceState(null, '', h ? `#${h}` : location.pathname);
}

/* ---------------- Search ---------------- */

function regionClause() {
  if (!state.region || !state.catalog) return '';
  const r = state.catalog.regions.find((x) => x.id === state.region);
  if (!r) return '';
  return r.stations.map((s) => `(${s.q})`).join(' OR ');
}

function composeQuery() {
  const era = (state.catalog?.eras || []).find((e) => e.name === state.era) || null;
  const extras = [state.preset, regionClause()].filter(Boolean).map((x) => `(${x})`).join(' AND ');
  return buildQuery({
    terms: state.terms,
    scope: state.scoped ? (state.catalog?.defaultScope || '') : '',
    era,
    extra: extras,
  });
}

async function runSearch({ reset }) {
  const q = composeQuery();
  if (!state.terms && !state.preset && !state.region) {
    showStatus('Type something, or pick a station or theme above.', 'info');
    return;
  }
  if (reset) {
    state.controller?.abort();
    state.controller = new AbortController();
    state.page = 0; state.numFound = 0; state.docs = []; state.stills = []; state.q = q;
    el.wall.innerHTML = ''; el.shows.innerHTML = '';
    observer.disconnect();
    writeHash();
    goToResults();
  }
  const signal = state.controller.signal;
  const page = state.page + 1;
  setBusy(true);
  el.more.hidden = true;
  showStatus(page === 1 ? 'Searching the Internet Archive…' : 'Loading more…', 'loading');

  try {
    const r = await search({ q, rows: ROWS, page, sort: state.sort, signal });
    if (signal.aborted) return;
    state.page = page; state.numFound = r.numFound;
    state.docs.push(...r.docs);
    hideStatus();
    updateHeading();
    if (!state.docs.length) {
      showStatus(`Nothing matched. ${state.scoped ? 'Try unticking the public access limit, or ' : 'Try '}fewer or different words.`, 'info');
    }
    r.docs.forEach(addShowCard);
    el.wall.hidden = state.view !== 'stills' || !state.docs.length;
    el.shows.hidden = state.view !== 'shows' || !state.docs.length;
    el.more.hidden = state.docs.length >= state.numFound || !r.docs.length;
  } catch (err) {
    if (err.name === 'AbortError') return;
    console.error(err);
    showStatus(`Couldn't reach the Internet Archive (${err.message}). It may be down or blocked on your network — try again in a moment.`, 'error');
  } finally {
    if (!signal.aborted) setBusy(false);
  }
}

function updateHeading() {
  const what = state.presetLabel || state.terms || (state.region ? regionName() : 'Everything');
  el.resultsTitle.textContent = what;
  const bits = [];
  bits.push(`${fmt(state.numFound)} ${state.numFound === 1 ? 'episode' : 'episodes'}`);
  if (state.terms && state.presetLabel) bits.push(`matching “${state.terms}”`);
  if (state.era) bits.push(state.era);
  if (state.region && !state.presetLabel) bits.push(regionName());
  if (!state.scoped) bits.push('all of archive.org');
  el.resultsMeta.textContent = bits.join(' · ');
}

function regionName() {
  return state.catalog?.regions.find((x) => x.id === state.region)?.name || '';
}

/* ---------------- Rendering ---------------- */

function addShowCard(doc) {
  const node = el.showTpl.content.firstElementChild.cloneNode(true);
  node.dataset.id = doc.id;
  $('.show-title', node).textContent = doc.title;
  $('.show-meta', node).textContent = metaLine(doc);
  $('.show-desc', node).textContent = truncate(doc.description, 260);
  $('.show-link', node).href = doc.itemUrl;
  const strip = $('.strip', node);
  strip.innerHTML = `<div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div>`;
  el.shows.appendChild(node);

  // Placeholder tile on the wall until stills arrive; observer triggers metadata fetch.
  const ph = document.createElement('div');
  ph.className = 'skeleton wall-pending';
  ph.dataset.id = doc.id;
  ph.setAttribute('aria-hidden', 'true');
  el.wall.appendChild(ph);
  observer.observe(ph);
  observer.observe(node);
}

function onIntersect(entries) {
  for (const e of entries) {
    if (!e.isIntersecting) continue;
    const id = e.target.dataset.id;
    observer.unobserve(e.target);
    const doc = state.docs.find((d) => d.id === id);
    if (doc && !doc._loading) { doc._loading = true; loadStills(doc); }
  }
}

async function loadStills(doc) {
  let stills = [];
  try {
    const meta = await limit(() => getMetadata(doc.id));
    stills = extractStills(doc.id, meta);
    const m = meta.metadata || {};
    if (!doc.description && m.description) doc.description = String(Array.isArray(m.description) ? m.description[0] : m.description);
  } catch (err) {
    console.warn('metadata failed for', doc.id, err);
  }
  if (!stills.length) stills = [{ name: '__poster', url: doc.posterUrl, seq: 0 }];
  doc.stills = stills;

  // Wall: replace placeholder with real tiles (cap per show so one long upload doesn't dominate).
  const ph = el.wall.querySelector(`.wall-pending[data-id="${cssEscape(doc.id)}"]`);
  const frag = document.createDocumentFragment();
  const picks = spread(stills, STILLS_PER_SHOW);
  for (const s of picks) {
    const idx = state.stills.length;
    state.stills.push({ doc, ...s, idx });
    frag.appendChild(makeStill(doc, s, idx));
  }
  if (ph) ph.replaceWith(frag); else el.wall.appendChild(frag);

  // Show card strip: thumbnails that open the same lightbox.
  const card = el.shows.querySelector(`.show[data-id="${cssEscape(doc.id)}"]`);
  if (card) {
    const strip = $('.strip', card);
    strip.innerHTML = '';
    for (const s of picks) {
      const idx = state.stills.findIndex((x) => x.doc === doc && x.name === s.name);
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'strip-btn'; b.setAttribute('role', 'listitem');
      b.innerHTML = `<img loading="lazy" decoding="async" alt="">`;
      $('img', b).src = s.url;
      $('img', b).alt = `Still from ${doc.title}`;
      b.addEventListener('click', () => openLightbox(idx));
      strip.appendChild(b);
    }
    if (stills.length > picks.length) {
      const more = document.createElement('a');
      more.className = 'strip-more'; more.href = doc.itemUrl; more.target = '_blank'; more.rel = 'noopener';
      more.textContent = `+${stills.length - picks.length} more`;
      strip.appendChild(more);
    }
  }
}

function makeStill(doc, s, idx) {
  const node = el.stillTpl.content.firstElementChild.cloneNode(true);
  const img = $('img', node);
  img.src = s.url;
  img.alt = `Still from ${doc.title}`;
  img.addEventListener('error', () => { if (img.src !== doc.posterUrl) img.src = doc.posterUrl; else node.classList.add('broken'); }, { once: false });
  $('.still-title', node).textContent = doc.title;
  $('.still-meta', node).textContent = metaLine(doc);
  $('.still-btn', node).addEventListener('click', () => openLightbox(idx));
  return node;
}

/** Evenly sample up to n items from an array (keeps first and last). */
function spread(arr, n) {
  if (arr.length <= n) return arr;
  const out = [];
  for (let i = 0; i < n; i++) out.push(arr[Math.round((i * (arr.length - 1)) / (n - 1))]);
  return out;
}

function metaLine(doc) {
  const bits = [];
  if (doc.year) bits.push(doc.year);
  const coll = doc.collections.find((c) => !/^(movies|community_media|opensource_movies|additional_collections)$/i.test(c));
  if (doc.creator) bits.push(doc.creator);
  else if (coll) bits.push(humanize(coll));
  return bits.join(' · ');
}

/* ---------------- Lightbox ---------------- */

let lbIndex = -1;

function openLightbox(idx) {
  if (idx < 0 || idx >= state.stills.length) return;
  lbIndex = idx;
  const s = state.stills[idx];
  el.lbImg.src = s.url;
  el.lbImg.alt = `Still from ${s.doc.title}`;
  el.lbTitle.textContent = s.doc.title;
  const frame = s.name === '__poster' ? 'Item poster (no frame stills derived yet)' : `Frame ${s.seq === Number.MAX_SAFE_INTEGER ? '' : s.seq}`.trim();
  el.lbSub.textContent = [metaLine(s.doc), frame, `${idx + 1} / ${state.stills.length}`].filter(Boolean).join(' · ');
  el.lbItem.href = s.doc.itemUrl;
  el.lbFile.href = s.url;
  if (!el.lightbox.open) el.lightbox.showModal();
  // Preload neighbours
  for (const d of [1, -1]) { const n = state.stills[idx + d]; if (n) { const i = new Image(); i.src = n.url; } }
}

function stepLightbox(d) {
  const n = lbIndex + d;
  if (n >= 0 && n < state.stills.length) openLightbox(n);
}

async function copyLink() {
  const s = state.stills[lbIndex];
  if (!s) return;
  try { await navigator.clipboard.writeText(s.url); flash('Link copied'); } catch { flash('Copy failed — long-press the image instead'); }
}

/* ---------------- Surprise me ---------------- */

async function surpriseMe() {
  const regions = state.catalog?.regions || [];
  const stations = regions.flatMap((r) => r.stations);
  if (!stations.length) return;
  const s = stations[Math.floor(Math.random() * stations.length)];
  state.terms = ''; el.q.value = '';
  state.preset = s.q; state.presetLabel = s.name;
  await runSearch({ reset: true });
  // Jump to a random page if the result set is deep enough.
  const pages = Math.min(40, Math.ceil(state.numFound / ROWS));
  if (pages > 1) {
    state.page = Math.floor(Math.random() * (pages - 1));
    state.docs = []; state.stills = []; el.wall.innerHTML = ''; el.shows.innerHTML = ''; observer.disconnect();
    await runSearch({ reset: false });
  }
}

/* ---------------- Status / helpers ---------------- */

function showStatus(msg, kind = 'info') {
  el.status.hidden = false;
  el.status.dataset.kind = kind;
  el.status.textContent = msg;
}
function hideStatus() { el.status.hidden = true; }
function setBusy(b) { el.results.setAttribute('aria-busy', String(b)); el.form.classList.toggle('is-busy', b); }

let flashTimer;
function flash(msg) {
  let t = $('#toast');
  if (!t) { t = document.createElement('div'); t.id = 'toast'; t.className = 'toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
  t.textContent = msg; t.classList.add('show');
  clearTimeout(flashTimer); flashTimer = setTimeout(() => t.classList.remove('show'), 1800);
}

function esc(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function cssEscape(s) { return (window.CSS && CSS.escape) ? CSS.escape(s) : String(s).replace(/["\\]/g, '\\$&'); }
function fmt(n) { return new Intl.NumberFormat().format(n); }
function truncate(s, n) { return s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s; }
function humanize(s) { return String(s).replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()); }
