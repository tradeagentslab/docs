// Builds the static site into dist/.
//
//   content/<lang>/<page>.md  ->  dist/<lang>/<page>/index.html   (index -> dist/<lang>/index.html)
//
// It also writes a language picker at /, 404.html, robots.txt, sitemap.xml, llms.txt and _headers,
// and copies everything in assets/ to the top of dist/.
//
// Names, addresses and links live in site.config.json. Pages and content/ui.json write them as
// {{brand}}, {{site}}, {{npm}}, {{cli}} and so on; this script fills them in.
//
// Run: node build.mjs

import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { Marked } from "marked";
import config from "./site.config.json" with { type: "json" };
import rawUi from "./content/ui.json" with { type: "json" };

export const ROOT = dirname(fileURLToPath(import.meta.url));

// Page ids, in menu order. "index" is the home page of each language.
export const PAGES = ["index", "run", "tools", "scams", "arena", "account", "about"];

// Search engines get this language when none of ours matches (hreflang="x-default").
// It also leads llms.txt.
const DEFAULT_LANG = "en";

// Browser features we never use. Permissions-Policy switches all of them off.
const FEATURES_OFF = [
  "accelerometer", "autoplay", "bluetooth", "camera", "clipboard-read", "clipboard-write",
  "display-capture", "encrypted-media", "fullscreen", "gamepad", "geolocation", "gyroscope",
  "hid", "idle-detection", "local-fonts", "magnetometer", "microphone", "midi", "payment",
  "picture-in-picture", "publickey-credentials-create", "publickey-credentials-get",
  "screen-wake-lock", "serial", "usb", "web-share", "xr-spatial-tracking",
];

// Security headers for every static file (written to dist/_headers).
// The site runs no scripts and loads nothing from other sites, so only our own files are allowed.
export const HEADERS = {
  "Content-Security-Policy":
    "default-src 'self'; script-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": FEATURES_OFF.map((feature) => `${feature}=()`).join(", "),
  "X-Frame-Options": "DENY",
};

// Replaces {{key}} with that key's value from site.config.json.
// An unknown key stops the build, so a typo never reaches the site.
export function fill(text, where = "text") {
  return text.replace(/\{\{\s*([\w-]+)\s*\}\}/g, (_, key) => {
    if (!Object.hasOwn(config, key)) throw new Error(`${where}: unknown placeholder {{${key}}}`);
    return String(config[key]);
  });
}

// content/ui.json (menu labels, footer lines ...) with its placeholders filled in.
function fillAll(value, where) {
  if (typeof value === "string") return fill(value, where);
  if (Array.isArray(value)) return value.map((item) => fillAll(item, where));
  return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, fillAll(v, where)]));
}
export const ui = fillAll(rawUi, "content/ui.json");

// Languages, in the order they appear in content/ui.json.
export const LANGS = Object.keys(ui);

// Address of a page on the site, e.g. pagePath("en", "run") -> "/en/run/".
export function pagePath(lang, page) {
  return page === "index" ? `/${lang}/` : `/${lang}/${page}/`;
}

// Full address, e.g. "/en/" -> "https://<domain>/en/".
const abs = (path) => config.site + path;

// Escapes text for HTML. Every attribute here uses double quotes, so ' can stay as it is.
const ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };
const esc = (text) => String(text).replace(/[&<>"]/g, (c) => ESCAPES[c]);

// Splits a page into its front matter and its Markdown. The front matter is a few
// "key: value" lines between two "---" lines; title and description are required.
export function parsePage(text, where = "page") {
  const match = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(text);
  if (!match) throw new Error(`${where}: missing front matter (--- title / description ---)`);
  const meta = {};
  for (const line of match[1].split(/\r?\n/)) {
    if (!line.trim()) continue;
    const colon = line.indexOf(":");
    if (colon < 1) throw new Error(`${where}: front matter line without "key:": ${line}`);
    let value = line.slice(colon + 1).trim();
    if (/^(["']).*\1$/.test(value)) value = value.slice(1, -1);
    meta[line.slice(0, colon).trim()] = value;
  }
  for (const key of ["title", "description"]) {
    if (!meta[key]) throw new Error(`${where}: front matter needs "${key}"`);
  }
  return { meta, body: text.slice(match[0].length) };
}

const markdown = new Marked({ gfm: true });

export function renderMarkdown(md) {
  return (
    markdown
      .parse(md)
      // Wide tables scroll sideways on phones instead of squeezing the text.
      .replaceAll("<table>", '<div class="table-wrap"><table>')
      .replaceAll("</table>", "</table></div>")
      // Links out of the site go through /go/ to be counted; search engines should not follow them.
      .replaceAll('<a href="/go/', '<a rel="nofollow" href="/go/')
  );
}

// Stops the build if content/ui.json is missing a label.
function checkUi() {
  const keys = ["langName", "htmlLang", "skip", "navLabel", "tagline", "notFound", "home"];
  for (const lang of LANGS) {
    const t = ui[lang];
    for (const key of keys) {
      if (!t[key]) throw new Error(`content/ui.json: "${lang}" needs "${key}"`);
    }
    for (const page of PAGES) {
      if (!t.nav?.[page]) throw new Error(`content/ui.json: "${lang}" needs a menu label for "${page}"`);
    }
    if (!t.disclaimer?.length) throw new Error(`content/ui.json: "${lang}" needs "disclaimer" lines`);
  }
}

// Reads and renders every content/<lang>/<page>.md.
async function readPages() {
  const pages = {};
  for (const lang of LANGS) {
    pages[lang] = {};
    for (const page of PAGES) {
      const where = `content/${lang}/${page}.md`;
      const text = fill(await readFile(join(ROOT, where), "utf8"), where);
      const { meta, body } = parsePage(text, where);
      pages[lang][page] = { meta, html: renderMarkdown(body) };
    }
  }
  return pages;
}

// The same page in every language, for <link rel="alternate"> and the sitemap.
function alternates(page) {
  const list = LANGS.map((lang) => [ui[lang].htmlLang, pagePath(lang, page)]);
  list.push(["x-default", page === "index" ? "/" : pagePath(DEFAULT_LANG, page)]);
  return list;
}

function documentHtml({ lang, title, description, canonical, links = [], noindex = false, body }) {
  const head = [
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${esc(title)}</title>`,
    `<meta name="description" content="${esc(description)}">`,
    noindex ? '<meta name="robots" content="noindex">' : "",
    canonical ? `<link rel="canonical" href="${esc(abs(canonical))}">` : "",
    ...links.map(([hreflang, path]) => `<link rel="alternate" hreflang="${hreflang}" href="${esc(abs(path))}">`),
    '<link rel="icon" href="/logo.svg" type="image/svg+xml">',
    '<link rel="icon" href="/favicon-32.png" sizes="32x32" type="image/png">',
    '<link rel="apple-touch-icon" href="/apple-touch-icon.png">',
    '<meta name="theme-color" content="#5B8DEF">',
    '<link rel="stylesheet" href="/style.css">',
  ].filter(Boolean);
  return `<!doctype html>
<html lang="${lang}">
<head>
${head.join("\n")}
</head>
<body>
${body}
</body>
</html>
`;
}

// Footer: the disclaimer lines of the given languages, then GitHub and the contact address.
function footerHtml(langs) {
  const lines = langs.flatMap((lang) =>
    ui[lang].disclaimer.map((text) => `<p lang="${ui[lang].htmlLang}">${esc(text)}</p>`),
  );
  return `<footer class="site-footer">
<div class="wrap">
${lines.join("\n")}
<p class="links"><a href="${esc(config.github)}">GitHub</a> · <a href="mailto:${esc(config.email)}">${esc(config.email)}</a></p>
</div>
</footer>`;
}

// A content page: header (site name, language switch, menu), the page, footer.
function pageHtml(lang, page, meta, content) {
  const t = ui[lang];
  const menu = PAGES.map((p) => {
    const current = p === page ? ' aria-current="page"' : "";
    return `<a href="${pagePath(lang, p)}"${current}>${esc(t.nav[p])}</a>`;
  });
  // The switch leads to this same page in the other language(s).
  const switches = LANGS.filter((l) => l !== lang).map((l) => {
    const code = ui[l].htmlLang;
    return `<a class="lang" href="${pagePath(l, page)}" hreflang="${code}" lang="${code}">${esc(ui[l].langName)}</a>`;
  });
  const body = `<a class="skip" href="#main">${esc(t.skip)}</a>
<header class="site-header">
<div class="wrap">
<div class="bar">
<a class="brand" href="${pagePath(lang, "index")}">${esc(config.brand)}</a>
${switches.join("\n")}
</div>
<nav aria-label="${esc(t.navLabel)}">
${menu.join("\n")}
</nav>
</div>
</header>
<main id="main" class="wrap">
${content.trim()}
</main>
${footerHtml([lang])}`;
  return documentHtml({
    lang: t.htmlLang,
    title: meta.title === config.brand ? config.brand : `${meta.title} · ${config.brand}`,
    description: meta.description,
    canonical: pagePath(lang, page),
    links: alternates(page),
    body,
  });
}

// The page at /: one line about the site in each language, and a button per language.
function pickerHtml() {
  const blurbs = LANGS.map((l) => `<p lang="${ui[l].htmlLang}">${esc(ui[l].tagline)}</p>`);
  const choices = LANGS.map((l) => {
    const code = ui[l].htmlLang;
    return `<a href="${pagePath(l, "index")}" hreflang="${code}" lang="${code}">${esc(ui[l].langName)}</a>`;
  });
  const body = `<main id="main" class="wrap picker">
<h1>${esc(config.brand)}</h1>
${blurbs.join("\n")}
<p class="choices">
${choices.join("\n")}
</p>
</main>
${footerHtml(LANGS)}`;
  return documentHtml({
    lang: ui[DEFAULT_LANG].htmlLang,
    title: config.brand,
    description: LANGS.map((l) => ui[l].tagline).join(" "),
    canonical: "/",
    links: alternates("index"),
    body,
  });
}

// Shown by Cloudflare Pages for any address that doesn't exist.
function notFoundHtml() {
  const lines = LANGS.map((l) => {
    const code = ui[l].htmlLang;
    return `<p lang="${code}">${esc(ui[l].notFound)} <a href="${pagePath(l, "index")}">${esc(ui[l].home)}</a></p>`;
  });
  const body = `<header class="site-header">
<div class="wrap">
<div class="bar"><a class="brand" href="/">${esc(config.brand)}</a></div>
</div>
</header>
<main id="main" class="wrap">
<h1>404</h1>
${lines.join("\n")}
</main>
${footerHtml(LANGS)}`;
  return documentHtml({
    lang: ui[DEFAULT_LANG].htmlLang,
    title: `404 · ${config.brand}`,
    description: LANGS.map((l) => ui[l].notFound).join(" "),
    noindex: true,
    body,
  });
}

function robotsTxt() {
  return `User-agent: *
Disallow: /go/

Sitemap: ${abs("/sitemap.xml")}
`;
}

// Lists the content pages only: not the language picker at /, not 404.html.
function sitemapXml() {
  const entries = LANGS.flatMap((lang) =>
    PAGES.map((page) => {
      const links = alternates(page).map(
        ([hreflang, path]) => `    <xhtml:link rel="alternate" hreflang="${hreflang}" href="${esc(abs(path))}"/>`,
      );
      return `  <url>
    <loc>${esc(abs(pagePath(lang, page)))}</loc>
${links.join("\n")}
  </url>`;
    }),
  );
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${entries.join("\n")}
</urlset>
`;
}

// llms.txt, as described on llmstxt.org: a title, a one-line summary, then a list of pages
// (title and one sentence each) per language.
function llmsTxt(pages) {
  const order = [DEFAULT_LANG, ...LANGS.filter((l) => l !== DEFAULT_LANG)];
  const others = order.slice(1).map((l) => ui[l].tagline);
  const notes = order.map((l) => ui[l].disclaimer.join(" "));
  const sections = order.map((lang) => {
    const items = PAGES.map((page) => {
      const { title, description } = pages[lang][page].meta;
      return `- [${title}](${abs(pagePath(lang, page))}): ${description}`;
    });
    return `## ${ui[lang].langName}\n\n${items.join("\n")}`;
  });
  return `# ${config.brand}

> ${ui[DEFAULT_LANG].tagline}

${[...others, ...notes].join("\n\n")}

${sections.join("\n\n")}
`;
}

function headersFile() {
  const lines = Object.entries(HEADERS).map(([name, value]) => `  ${name}: ${value}`);
  return `/*\n${lines.join("\n")}\n`;
}

// Builds everything into outDir (default dist/). Empties outDir first.
export async function build(outDir = join(ROOT, "dist")) {
  const out = resolve(outDir);
  if (out === ROOT || ROOT.startsWith(out + sep)) throw new Error(`Refusing to empty ${out}`);
  checkUi();
  const pages = await readPages();

  const files = new Map();
  for (const lang of LANGS) {
    for (const page of PAGES) {
      const { meta, html } = pages[lang][page];
      files.set(`${pagePath(lang, page).slice(1)}index.html`, pageHtml(lang, page, meta, html));
    }
  }
  files.set("index.html", pickerHtml());
  files.set("404.html", notFoundHtml());
  files.set("robots.txt", robotsTxt());
  files.set("sitemap.xml", sitemapXml());
  files.set("llms.txt", llmsTxt(pages));
  files.set("_headers", headersFile());

  await rm(out, { recursive: true, force: true });
  for (const [path, text] of files) {
    await mkdir(dirname(join(out, path)), { recursive: true });
    await writeFile(join(out, path), text);
  }
  await cp(join(ROOT, "assets"), out, { recursive: true });
  return out;
}

// Only build when run as a script (tests import this file instead).
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const out = await build();
  console.log(`Built the site into ${out}`);
}
