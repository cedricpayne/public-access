// End-to-end smoke test: serve the static site, mock archive.org, drive it in Chromium.
//   npm i -D playwright && npm run test:e2e
// Set SHOTS=<dir> to keep screenshots, TRACE=1 to echo page console output.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8123;
const SHOTS = process.env.SHOTS || mkdtempSync(path.join(tmpdir(), 'access-stills-'));
console.log('screenshots →', SHOTS);
const server = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1', '-d', ROOT], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 800));

// 1x1 JPEG-ish PNG so <img> loads succeed.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64');

const docs = Array.from({ length: 24 }, (_, i) => ({
  identifier: `bctv-ep-${i}`,
  title: `Brattleboro Select Board ${1990 + (i % 9)} #${i}`,
  description: `<p>Episode ${i} of a <b>public access</b> meeting.</p>`,
  date: `${1990 + (i % 9)}-05-0${(i % 9) + 1}T00:00:00Z`,
  subject: ['government', 'public access'],
  collection: ['community_media', 'brattleborocommunitytv'],
  creator: 'BCTV',
  downloads: 100 - i,
  mediatype: 'movies',
}));

const seen = { search: [], meta: [], images: 0 };
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); else if (process.env.TRACE) console.log('  [console]', m.text()); });
await page.addInitScript(() => {
  const of = window.fetch;
  window.fetch = (u, o) => { console.log('fetch ' + String(u).slice(0, 110)); return of(u, o).then((r) => { console.log('done ' + r.status + ' ' + String(u).slice(0, 80)); return r; }, (e) => { console.log('FAIL ' + e + ' ' + String(u).slice(0, 80)); throw e; }); };
  window.addEventListener('hashchange', () => console.log('hashchange ' + location.hash));
  window.addEventListener('error', (e) => console.log('window.error ' + e.message));
  window.addEventListener('unhandledrejection', (e) => console.log('unhandledrejection ' + e.reason));
});
page.on('pageerror', (e) => errors.push(String(e)));

await page.route('https://archive.org/**', async (route) => {
  const url = new URL(route.request().url());
  if (url.pathname === '/advancedsearch.php') {
    seen.search.push(url.searchParams.get('q'));
    const pg = Number(url.searchParams.get('page') || 1);
    return route.fulfill({ json: { response: { numFound: 60, start: (pg - 1) * 24, docs: pg === 1 ? docs : docs.slice(0, 12).map((d) => ({ ...d, identifier: d.identifier + '-p2' })) } } });
  }
  if (url.pathname.startsWith('/metadata/')) {
    const id = decodeURIComponent(url.pathname.split('/')[2]);
    seen.meta.push(id);
    if (id.endsWith('-3')) return route.fulfill({ json: { files: [{ name: 'x.mp4' }], metadata: {} } }); // no stills → poster fallback
    const files = [{ name: '__ia_thumb.jpg', format: 'Item Tile' }, { name: 'ep.mp4', format: 'h.264' }];
    for (let k = 1; k <= 20; k++) files.push({ name: `ep.thumbs/ep_${String(k).padStart(6, '0')}.jpg`, format: 'Thumbnail' });
    return route.fulfill({ json: { files, metadata: { title: id, description: 'From metadata' } } });
  }
  if (url.pathname.startsWith('/download/') || url.pathname.startsWith('/services/img/')) {
    seen.images++;
    const hue = [...url.pathname].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 360, 7);
    const label = decodeURIComponent(url.pathname.split('/').pop()).replace(/\.jpg$/, '');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue},45%,35%)"/><stop offset="1" stop-color="hsl(${(hue+40)%360},55%,15%)"/></linearGradient></defs><rect width="640" height="480" fill="url(#g)"/><rect x="40" y="300" width="560" height="120" fill="rgba(0,0,0,.45)"/><text x="60" y="370" font-family="monospace" font-size="34" fill="#fff">${label}</text><text x="60" y="410" font-family="sans-serif" font-size="22" fill="#ffd">PUBLIC ACCESS  ·  ${hue}</text></svg>`;
    return route.fulfill({ body: svg, contentType: 'image/svg+xml' });
  }
  return route.fulfill({ status: 404, body: 'nope' });
});

const base = `http://127.0.0.1:${PORT}/`;
await page.goto(base);
await page.waitForSelector('#regions .chip');
const chipCount = await page.locator('#regions .chip').count();
console.log('station chips:', chipCount, 'topic chips:', await page.locator('#topics .chip').count());
await page.screenshot({ path: SHOTS + '/01-home.png', fullPage: false });

// Search via the form
await page.fill('#q', 'select board');
await page.selectOption('#era', '1990s');
await page.click('#search-form .btn.primary');
try {
  await page.waitForSelector('.still img', { timeout: 10000 });
} catch (e) {
  console.log('DEBUG status:', await page.textContent('#status'), '| pending:', await page.locator('.wall-pending').count(), '| stills:', await page.locator('.still').count(), '| searches:', seen.search.length, '| meta:', seen.meta.length, '| wall hidden:', await page.evaluate(() => document.getElementById('wall').hidden), '| errors:', errors);
  throw e;
}
await page.waitForFunction(() => document.querySelectorAll('.still').length >= 24, null, { timeout: 15000 });
console.log('last search q:', seen.search.at(-1));
console.log('hash:', await page.evaluate(() => location.hash));
console.log('heading:', await page.textContent('#results-title'), '|', await page.textContent('#results-meta'));
const stills = await page.locator('.still').count();
console.log('stills rendered:', stills, 'meta fetches:', seen.meta.length, 'images:', seen.images);
await page.screenshot({ path: SHOTS + '/02-wall.png', fullPage: false });

// Lightbox
await page.click('.still-btn >> nth=0');
await page.waitForSelector('#lightbox[open]');
console.log('lightbox title:', await page.textContent('#lb-title'), '|', await page.textContent('#lb-sub'));
await page.keyboard.press('ArrowRight');
console.log('after →:', await page.textContent('#lb-sub'));
await page.screenshot({ path: SHOTS + '/03-lightbox.png' });
await page.keyboard.press('Escape');
console.log('lightbox closed:', !(await page.isVisible('#lightbox[open]')));

// By-show view
await page.click('.view-switch [data-view="shows"]');
await page.waitForSelector('.show .strip-btn');
console.log('show cards:', await page.locator('.show').count(), 'hash:', await page.evaluate(() => location.hash));
console.log('wall visible in shows view:', await page.isVisible('#wall'), '| shows visible:', await page.isVisible('#shows'));
await page.waitForTimeout(400);
await page.screenshot({ path: SHOTS + '/04-shows.png' });

// Load more
await page.click('.view-switch [data-view="stills"]');
await page.click('#more-btn');
await page.waitForFunction(() => document.querySelectorAll('.still, .wall-pending').length > 24);
console.log('searches made:', seen.search.length);

// Preset chip → hash preset; reload restores
console.log('browse collapsed:', await page.evaluate(() => document.getElementById('browse').classList.contains('is-collapsed')));
await page.click('#browse-toggle');
await page.click('#topics .chip >> nth=0');
await page.waitForFunction((n) => document.querySelectorAll('.still').length > 0 && location.hash.includes('preset'), null);
const h = await page.evaluate(() => location.hash);
console.log('preset hash:', h);
await page.goto(base + h);
await page.waitForSelector('.still img');
console.log('restored heading:', await page.textContent('#results-title'));

// Mobile viewport
const m = await browser.newPage({ viewport: { width: 390, height: 800 } });
await m.goto(base + '#q=puppet');
await m.waitForTimeout(600);
const overflow = await m.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
console.log('mobile horizontal overflow:', overflow);
await m.screenshot({ path: SHOTS + '/05-mobile.png' });

// Error path: archive down
const bad = await browser.newPage();
await bad.route('https://archive.org/**', (r) => r.abort());
await bad.goto(base + '#q=anything');
await bad.waitForSelector('#status[data-kind="error"]');
console.log('error status:', await bad.textContent('#status'));

console.log('console errors:', errors);
await browser.close();
server.kill();
if (errors.length) { console.error('FAILED: page logged errors'); process.exit(1); }
console.log('PASS');
