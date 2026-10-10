# Docs site

Source of the project's website: a small static site in Simplified Chinese and English, built by one script and served by Cloudflare Pages.

Simulated trading. Past results don't predict future results. Not investment advice.

## What's here

| Path | What it is |
|---|---|
| `site.config.json` | The project's name, domain, links, npm package and command name. Everything that carries the name lives here and only here. |
| `content/<lang>/<page>.md` | Page text: Markdown with a short front matter (`title`, `description`). |
| `content/<lang>/index.html` | The home pages: the same front matter, then ready HTML used as is (no Markdown). A `.html` file wins over a `.md` of the same name. |
| `content/ui.json` | Menu labels, footer lines and the other short texts, per language. |
| `build.mjs` | Turns `content/` into static HTML in `dist/`, plus a language picker, `404.html`, `robots.txt`, `sitemap.xml`, `llms.txt` and `_headers`. |
| `assets/style.css` | The only stylesheet: navy and steel blue, dark first with a light variant (follows the system; the theme button overrides it). |
| `assets/site.js` | The only script file, small, no libraries: the theme button, and on the home page the install tabs, the copy button and board/chart highlighting. Pages work without it. |
| `functions/_middleware.js` | Regional gate: visitors from mainland China get HTTP 451 for the whole site. |
| `functions/go/` | Outbound links. Each click adds 1 to a daily counter per target and source. No IP addresses, user agents or other personal data. |
| `schema.sql` | The two D1 counter tables. |
| `wrangler.toml` | Cloudflare Pages settings. |
| `tests/` | `node --test`, no network. |

## Build and test

Needs Node 24 or newer.

```sh
npm ci
npm run build   # writes dist/
npm test
```

To look at the result, serve `dist/` with any static file server, for example `python3 -m http.server -d dist`. That skips `functions/`; `npx wrangler@4 pages dev dist` runs them too.

## Look and loading

- Fonts: IBM Plex Sans (400, 500, 600) and IBM Plex Mono (400, 500) are self-hosted in `assets/fonts/` as latin-only woff2 (`font-display: swap`), under the SIL Open Font License 1.1 (`assets/fonts/OFL.txt`). Chinese text uses system fonts. The site loads nothing from other sites. Only the body weight is preloaded.
- Scripts: `/site.js` (deferred) and one inline line in `<head>` that applies a remembered theme before the page paints. The CSP allows exactly that line by its hash (`THEME_SCRIPT_HASH` in `build.mjs`); change the line and the hash follows at build time. No inline styles or `<style>` blocks (the CSP blocks them).
- `Permissions-Policy` keeps everything off except `clipboard-write=(self)`, for the copy button.
- The arena pages' live board (`functions/_board.js`) renders `<table class="board">`, styled in `style.css`.

## Writing pages

Each page is front matter plus Markdown. `{{brand}}`, `{{site}}`, `{{domain}}`, `{{email}}`, `{{github}}`, `{{githubOrg}}`, `{{npm}}`, `{{cli}}` (any key in `site.config.json`) are filled in by the build. An unknown placeholder stops the build.

Links to other sites go through `/go/`, with a `from=` that says where the link sits:

```md
[TradingView](/go/tool/tradingview?from=tools-en)
```

`from` is 1–40 characters of `a-z 0-9 _ -`. The tests fail if a `/go/` link has no valid `from` or points to a target `functions/go/` doesn't know. Tool addresses live in `functions/go/targets.json`.

## Board card (image for X and Hacker News)

`share/board-card.html` is a 1200 x 675 template in the site's look; `share/board-card.mjs` fills it from one arena standings file (format `arena.standings/v0`) into a single self-contained HTML page (fonts inlined, no scripts):

```sh
node share/board-card.mjs --in share/sample-board.json --out out/card.html --lang en   # or zh-hans
```

GitHub → Actions → **board card** → Run workflow screenshots it with headless Chromium (pinned Playwright) and keeps the PNGs as an artifact. Leave the input empty for the sample, or give a board from the site's arena API. Anything not marked `sample: false` carries a "Sample data · 示例" mark. Every card says: "Paper trading. Past results do not predict the future. Not investment advice." The card ranks agents; the model an agent runs on is shown under its name, not as a column of its own.

## Deploy

GitHub → Actions → **deploy** → Run workflow → `preview` or `production`. Both build and run the tests first; production only runs from `main`.

Repository secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`.

There is no separate setup step. The deploy workflow creates the Pages project if it is missing; a production run also creates the counter database if it is missing, adds its tables, and attaches the domain. Names come from `site.config.json`.

The counter database is bound in production only, so clicks on preview deployments are not counted.

## Renaming

1. Edit `site.config.json`.
2. In `wrangler.toml`, change these two lines: `name` (= `pagesProject`) and `database_name` (= `d1Database`; also `database_id` if it is a new database). TOML can't read JSON, so they repeat the config; a test checks that they match.
3. Run `npm test`. It fails if the name still shows up in any file other than `site.config.json`, `wrangler.toml` and `package-lock.json`.

Outside this repository: the Cloudflare Pages project and custom domain, the D1 database, the GitHub repository and its secrets. `campaign` is the source tag on sign-up and help-bot links and partners count visits by it, so agree on a new value with them before changing it.

## License

Code: MIT. Text in `content/`: CC BY 4.0.
