# Access Stills

A static micro-site for searching **frame stills from public access and community television shows around the world**.

Type a word, pick a station, or hit *Surprise me*, and the page lays out a wall of stills. Click any still to view it full size, step through the episode frame by frame, copy a direct link, or jump to the full video on the Internet Archive.

There is no backend and no build step. Open `index.html` over any static web server and it works.

## How it works

Everything comes live from the [Internet Archive](https://archive.org), which holds the largest open collection of public access television (the [Community Media Archive](https://archive.org/details/community_media) alone has tens of thousands of programmes).

1. **Search.** The browser calls the Archive's `advancedsearch.php` API with a Lucene query. By default the query is limited to video items that describe themselves as public access, community television, Offener Kanal, Öppna Kanalen, télévision communautaire, and so on. Untick *Limit to public access & community TV* to search every video on the Archive.
2. **Stills.** For each result, the page calls the `metadata/{identifier}` API and picks out the derived frame thumbnails the Archive generates for every uploaded video (`*.thumbs/*_000001.jpg` …). Up to eight evenly spaced frames per episode go on the wall; the lightbox lets you step through them. Items with no derived frames fall back to their poster image.
3. **Curation.** Stations, regions, themes and eras live in [`data/catalog.json`](data/catalog.json). Every entry is just a search query, so adding a station from your part of the world is a one-line edit:

   ```json
   { "name": "SALTO Amsterdam", "place": "Netherlands", "q": "SALTO Amsterdam OR \"Open Kanaal\"" }
   ```

Metadata responses are cached in `sessionStorage` and fetched at most four at a time so the site stays a polite guest of the Archive. Search state lives in the URL hash, so any view is shareable.

## Run it locally

```sh
npm run dev          # python3 -m http.server on http://127.0.0.1:8080
```

Or any other static server (`npx serve .`, `php -S`, …). Opening `index.html` directly from disk will not work because ES modules and `fetch` need an HTTP origin.

## Test

```sh
npm run check        # syntax-check the JS and validate the catalog JSON
npm test             # unit tests for the Internet Archive client (node:test, no deps)
npm i -D playwright && npm run test:e2e
                     # browser smoke test: serves the site, mocks archive.org, drives
                     # search → wall → lightbox → by-show → load more in Chromium
```

## Deploy

**Vercel (recommended).** Import the repository at <https://vercel.com/new>, leave the framework preset on *Other*, and deploy. `vercel.json` already tells Vercel there is no build step and sets cache headers. Every push to the production branch redeploys, and every other branch gets a preview URL. From a terminal, `npx vercel` from the repo root does the same.

**Sharing and passwords.** The production URL is public. To put the whole site behind a password, add an environment variable `SITE_PASSWORD` (and optionally `SITE_USER`, default `guest`) in the Vercel project settings and redeploy; `middleware.js` then asks every visitor for it with the browser's own prompt. Remove the variable to make it public again.

**GitHub Pages.** `.github/workflows/pages.yml` is a manual workflow: enable Pages with *Source: GitHub Actions* in the repository settings, then run the workflow from the Actions tab.

Any other static host works just as well; there is nothing to build.

## Layout

```
index.html          page shell, templates, dialogs
styles.css          design tokens, light/dark theming, layout
js/ia.js            Internet Archive client: query builder, search, metadata, still extraction
js/app.js           UI: browse chips, search, stills wall, by-show view, lightbox, URL state
data/catalog.json   regions, stations, themes, eras (edit me)
test/ia.test.js     unit tests
scripts/e2e.mjs     Playwright smoke test with a mocked Internet Archive
```

## Notes and limits

- Stills are shown exactly as the Archive derives them. Rights stay with the original producers and stations.
- The Archive's search is full-text over metadata, not over video content, so results are only as good as the uploader's titles and descriptions.
- Public access outside North America is unevenly represented on the Archive. The regional presets are starting points, not guarantees; some will return few results until more is uploaded.
