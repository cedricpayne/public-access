import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildQuery, extractStills, fileUrl, normalizeDoc } from '../js/ia.js';

test('buildQuery: plain words favour all-terms match but allow any', () => {
  const q = buildQuery({ terms: 'puppet show', scope: 'collection:community_media' });
  assert.equal(q, 'mediatype:movies AND (collection:community_media) AND ((puppet AND show)^4 OR (puppet OR show))');
});

test('buildQuery: single word, no scope, era appended', () => {
  const q = buildQuery({ terms: 'wrestling', era: { from: '1980-01-01', to: '1989-12-31' } });
  assert.equal(q, 'mediatype:movies AND (wrestling) AND date:[1980-01-01 TO 1989-12-31]');
});

test('buildQuery: raw Lucene passes through untouched', () => {
  const q = buildQuery({ terms: '"Offener Kanal" OR Bürgerfernsehen' });
  assert.equal(q, 'mediatype:movies AND ("Offener Kanal" OR Bürgerfernsehen)');
});

test('buildQuery: strips Lucene specials from plain words', () => {
  const q = buildQuery({ terms: 'cook*ng' });
  assert.equal(q, 'mediatype:movies AND (cook ng)'.replace('cook ng', '(cook AND ng)^4 OR (cook OR ng)'));
});

test('buildQuery: extra clause and empty terms', () => {
  const q = buildQuery({ terms: '   ', extra: '"Denver Open Media"' });
  assert.equal(q, 'mediatype:movies AND ("Denver Open Media")');
});

test('fileUrl encodes each path segment but keeps slashes', () => {
  assert.equal(
    fileUrl('my item', 'ep 1.thumbs/ep 1_000001.jpg'),
    'https://archive.org/download/my%20item/ep%201.thumbs/ep%201_000001.jpg',
  );
});

test('extractStills finds derived thumbs, drops __ia_thumb, sorts by frame number', () => {
  const meta = { files: [
    { name: '__ia_thumb.jpg', format: 'Item Tile' },
    { name: 'show.thumbs/show_000010.jpg', format: 'Thumbnail' },
    { name: 'show.thumbs/show_000002.jpg', format: 'Thumbnail' },
    { name: 'show.mp4', format: 'h.264' },
    { name: 'show_meta.xml', format: 'Metadata' },
    { name: 'poster.jpg', format: 'Thumbnail' },
  ] };
  const s = extractStills('abc', meta);
  assert.deepEqual(s.map((x) => x.name), ['show.thumbs/show_000002.jpg', 'show.thumbs/show_000010.jpg', 'poster.jpg']);
  assert.equal(s[0].url, 'https://archive.org/download/abc/show.thumbs/show_000002.jpg');
});

test('extractStills tolerates missing files', () => {
  assert.deepEqual(extractStills('x', {}), []);
  assert.deepEqual(extractStills('x', null), []);
});

test('normalizeDoc flattens arrays and strips HTML', () => {
  const d = normalizeDoc({
    identifier: 'bctv-123', title: ['Select Board 1/2/1994'], description: '<p>Town  <b>meeting</b></p>',
    date: '1994-01-02T00:00:00Z', subject: 'government', collection: ['community_media', 'bctv'], downloads: '12',
  });
  assert.equal(d.id, 'bctv-123');
  assert.equal(d.title, 'Select Board 1/2/1994');
  assert.equal(d.description, 'Town meeting');
  assert.equal(d.date, '1994-01-02');
  assert.equal(d.year, '1994');
  assert.deepEqual(d.subjects, ['government']);
  assert.deepEqual(d.collections, ['community_media', 'bctv']);
  assert.equal(d.downloads, 12);
  assert.equal(d.itemUrl, 'https://archive.org/details/bctv-123');
});
