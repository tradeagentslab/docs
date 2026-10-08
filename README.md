# Docs site

Source of the project's website: a small static site in Simplified Chinese and English, built by one script and served by Cloudflare Pages.

Simulated trading. Past results don't predict future results. Not investment advice.

## What's here

| Path | What it is |
|---|---|
| `site.config.json` | The project's name, domain, links, npm package and command name. Everything that carries the name lives here and only here. |
| `content/<lang>/<page>.md` | Page text: Markdown with a short front matter (`title`, `description`). |
| `content/ui.json` | Menu labels, footer lines and the other short texts, per language. |
| `build.mjs` | Turns `content/` into static HTML in `dist/`, plus a language picker, `404.html`, `robots.txt`, `sitemap.xml`, `llms.txt` and `_headers`. |
| `assets/style.css` | The only stylesheet. The site runs no scripts and loads no fonts, trackers or anything else from other sites. |
| `functions/_middleware.js` | Regional notices: answers HTTP 451 where a page is not offered. |
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

## Writing pages

Each page is front matter plus Markdown. `{{brand}}`, `{{site}}`, `{{domain}}`, `{{email}}`, `{{github}}`, `{{githubOrg}}`, `{{npm}}`, `{{cli}}` (any key in `site.config.json`) are filled in by the build. An unknown placeholder stops the build.

Links to other sites go through `/go/`, with a `from=` that says where the link sits:

```md
[TradingView](/go/tool/tradingview?from=tools-en)
```

`from` is 1–40 characters of `a-z 0-9 _ -`. The tests fail if a `/go/` link has no valid `from` or points to a target `functions/go/` doesn't know. Tool addresses live in `functions/go/targets.json`.

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
