/**
 * Minimal client for the Internet Archive's public, CORS-enabled APIs.
 *
 *  - advancedsearch.php  → find video items matching a Lucene query
 *  - metadata/{id}       → list an item's files, including derived frame thumbnails
 *  - download/{id}/{f}   → fetch a file (the still itself)
 *
 * No API key is needed. Be a polite guest: requests are throttled and
 * metadata responses are cached in sessionStorage.
 */

export const IA_BASE = 'https://archive.org';
export const SEARCH_FIELDS = [
  'identifier', 'title', 'description', 'date', 'year', 'subject',
  'collection', 'creator', 'downloads', 'mediatype', 'addeddate',
];

const META_CACHE_PREFIX = 'ia:meta:';
const inflight = new Map();

/** Build the Lucene query string sent to advancedsearch. */
export function buildQuery({ terms = '', scope = '', era = null, extra = '' } = {}) {
  const parts = ['mediatype:movies'];
  if (scope) parts.push(`(${scope})`);
  if (extra) parts.push(`(${extra})`);
  const t = terms.trim();
  if (t) parts.push(looksLikeLucene(t) ? `(${t})` : `(${escapeTerms(t)})`);
  if (era && era.from && era.to) parts.push(`date:[${era.from} TO ${era.to}]`);
  return parts.join(' AND ');
}

/** Heuristic: treat input with field prefixes / boolean operators / quotes as raw Lucene. */
function looksLikeLucene(s) {
  return /(^|\s)(AND|OR|NOT)(\s|$)|\w+:\S|"|\[.+TO.+\]|[()]/.test(s);
}

/** Plain words: match any word, favour all of them. */
function escapeTerms(s) {
  const words = s.replace(/[+\-!(){}[\]^~*?:\\/]/g, ' ').split(/\s+/).filter(Boolean);
  if (!words.length) return '';
  const all = words.join(' AND ');
  const any = words.join(' OR ');
  return words.length === 1 ? all : `(${all})^4 OR (${any})`;
}

/**
 * Search the Archive.
 * @returns {Promise<{numFound:number, start:number, docs:object[]}>}
 */
export async function search({ q, rows = 24, page = 1, sort = '', signal } = {}) {
  const url = new URL(`${IA_BASE}/advancedsearch.php`);
  url.searchParams.set('q', q);
  for (const f of SEARCH_FIELDS) url.searchParams.append('fl[]', f);
  if (sort) url.searchParams.append('sort[]', sort);
  url.searchParams.set('rows', String(rows));
  url.searchParams.set('page', String(page));
  url.searchParams.set('output', 'json');

  const res = await fetch(url, { signal, headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`Internet Archive search failed (${res.status})`);
  const json = await res.json();
  const r = json.response || {};
  return {
    numFound: r.numFound ?? 0,
    start: r.start ?? 0,
    docs: (r.docs || []).map(normalizeDoc),
  };
}

function first(v) { return Array.isArray(v) ? v[0] : v; }
function list(v) { return v == null ? [] : Array.isArray(v) ? v : [v]; }

export function normalizeDoc(d) {
  const date = first(d.date) || first(d.year) || '';
  return {
    id: d.identifier,
    title: first(d.title) || d.identifier,
    description: stripHtml(first(d.description) || ''),
    date: typeof date === 'string' ? date.slice(0, 10) : String(date),
    year: (String(first(d.year) || date).match(/\d{4}/) || [''])[0],
    subjects: list(d.subject).map(String),
    collections: list(d.collection).map(String),
    creator: list(d.creator).map(String).join(', '),
    downloads: Number(d.downloads || 0),
    added: first(d.addeddate) || '',
    itemUrl: `${IA_BASE}/details/${encodeURIComponent(d.identifier)}`,
    posterUrl: `${IA_BASE}/services/img/${encodeURIComponent(d.identifier)}`,
  };
}

export function stripHtml(s) {
  return String(s).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Fetch an item's metadata (files + metadata). Cached per session, de-duplicated in flight.
 */
export async function getMetadata(id, { signal } = {}) {
  const key = META_CACHE_PREFIX + id;
  try {
    const hit = sessionStorage.getItem(key);
    if (hit) return JSON.parse(hit);
  } catch { /* storage unavailable: fall through */ }

  if (inflight.has(id)) return inflight.get(id);

  const p = (async () => {
    const res = await fetch(`${IA_BASE}/metadata/${encodeURIComponent(id)}`, { signal, headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`metadata ${res.status}`);
    const json = await res.json();
    const slim = {
      files: (json.files || []).map((f) => ({ name: f.name, format: f.format, size: f.size, source: f.source })),
      metadata: json.metadata || {},
    };
    try { sessionStorage.setItem(key, JSON.stringify(slim)); } catch { /* quota: ignore */ }
    return slim;
  })();
  inflight.set(id, p);
  try { return await p; } finally { inflight.delete(id); }
}

/** Build a download URL for a file path inside an item, encoding each path segment. */
export function fileUrl(id, name) {
  const path = String(name).split('/').map(encodeURIComponent).join('/');
  return `${IA_BASE}/download/${encodeURIComponent(id)}/${path}`;
}

/**
 * Pick out frame stills from an item's file list.
 * The Archive derives `<video>.thumbs/<video>_000001.jpg` … for every uploaded video.
 */
export function extractStills(id, meta) {
  const files = (meta && meta.files) || [];
  const stills = files
    .filter((f) => f.name && !/__ia_thumb\.jpg$/i.test(f.name))
    .filter((f) => /\.thumbs\/.+\.(jpe?g|png)$/i.test(f.name) || /^thumbnail$/i.test(f.format || ''))
    .map((f) => ({ name: f.name, url: fileUrl(id, f.name), seq: seqOf(f.name) }))
    .sort((a, b) => a.seq - b.seq || a.name.localeCompare(b.name));
  return stills;
}

function seqOf(name) {
  const m = String(name).match(/_(\d{3,})\.(?:jpe?g|png)$/i);
  return m ? parseInt(m[1], 10) : Number.MAX_SAFE_INTEGER;
}

/** Simple concurrency limiter so we don't hammer the Archive with metadata calls. */
export function createLimiter(max = 4) {
  let active = 0;
  const queue = [];
  const next = () => {
    if (active >= max || !queue.length) return;
    active++;
    const { fn, resolve, reject } = queue.shift();
    fn().then(resolve, reject).finally(() => { active--; next(); });
  };
  return (fn) => new Promise((resolve, reject) => { queue.push({ fn, resolve, reject }); next(); });
}
