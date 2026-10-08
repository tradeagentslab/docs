// Builds the site into a temporary folder and checks what comes out.

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { after, before, test } from "node:test";
import { createHash } from "node:crypto";
import { BODY_FONT, HEADERS, LANGS, PAGES, ROOT, THEME_SCRIPT, THEME_SCRIPT_HASH, build, fill, pagePath, parsePage, renderMarkdown, sourceOf } from "../build.mjs";
import { resolveGo } from "../functions/go/[[path]].js";
import config from "../site.config.json" with { type: "json" };

// Footer lines with fixed wording.
const ZH = "模拟盘，过去不代表未来，不是投资建议。";
const EN = "Simulated trading. Past results don't predict future results. Not investment advice.";

let out;
const files = new Map(); // path inside dist -> contents

before(async () => {
  out = await mkdtemp(join(tmpdir(), "docs-build-"));
  await build(out);
  const entries = await readdir(out, { recursive: true, withFileTypes: true });
  for (const entry of entries.filter((e) => e.isFile())) {
    const path = join(entry.parentPath, entry.name);
    files.set(relative(out, path), await readFile(path, "utf8"));
  }
});

after(() => rm(out, { recursive: true, force: true }));

// Self-hosted fonts (assets/fonts/), as named in style.css.
const FONT_FILES = ["plex-sans", "plex-mono-400", "plex-mono-500"].map((n) => `fonts/${n}.woff2`);
const fontsMissing = FONT_FILES.filter((f) => !existsSync(join(ROOT, "assets", f)));

const fileOf = (lang, page) => `${pagePath(lang, page).slice(1)}index.html`;
const htmlFiles = () => [...files].filter(([path]) => path.endsWith(".html"));
const footerOf = (html) => html.slice(html.indexOf("<footer"), html.indexOf("</footer>"));

test("builds every page in every language, plus the picker, 404 and site files", () => {
  const expected = [
    ...LANGS.flatMap((lang) => PAGES.map((page) => fileOf(lang, page))),
    "index.html",
    "404.html",
    "robots.txt",
    "sitemap.xml",
    "llms.txt",
    "_headers",
    "style.css",
    "site.js",
    "favicon-32.png",
    "apple-touch-icon.png",
    "logo.svg",
    "logo-1024.png",
    "fonts/OFL.txt",
    ...FONT_FILES.filter((f) => existsSync(join(ROOT, "assets", f))),
  ];
  assert.deepEqual([...files.keys()].sort(), expected.sort());
  assert.equal(LANGS.length * PAGES.length, 12);
  assert.ok(!PAGES.includes("scams"), "the scam checklist page was removed on 10-09");
});

test("every page footer carries the disclaimer, and no page carries the old UK/US line", () => {
  for (const [path, html] of htmlFiles()) {
    const footer = footerOf(html);
    const zh = path.startsWith("zh-hans/");
    const en = path.startsWith("en/");
    const bilingual = !zh && !en; // the picker at / and 404.html
    if (zh || bilingual) assert.ok(footer.includes(`>${ZH}</p>`), `${path}: Chinese disclaimer`);
    if (en || bilingual) {
      assert.ok(footer.includes(`>${EN}</p>`), `${path}: English disclaimer`);
    }
    assert.ok(!html.includes("Not for residents of the UK"), `${path}: no UK/US line`);
  }
});

test("every page footer links to GitHub and the contact address, and nothing mentions Discord", () => {
  for (const [path, html] of htmlFiles()) {
    const footer = footerOf(html);
    assert.ok(footer.includes(`<a href="${config.github}">GitHub</a>`), path);
    // Discord is postponed (10-08); the English side uses GitHub Discussions for now.
    assert.ok(!/discord/i.test(html), path);
    assert.ok(footer.includes(`<a href="mailto:${config.email}">${config.email}</a>`), path);
  }
});

test("the language switch leads to the same page in the other language", () => {
  for (const lang of LANGS) {
    for (const page of PAGES) {
      const html = files.get(fileOf(lang, page));
      for (const other of LANGS.filter((l) => l !== lang)) {
        assert.ok(html.includes(`<a class="lang tbtn" href="${pagePath(other, page)}"`), `${lang}/${page} -> ${other}`);
      }
    }
  }
});

test("the menu lists all seven pages and marks the current one", () => {
  for (const lang of LANGS) {
    for (const page of PAGES) {
      const html = files.get(fileOf(lang, page));
      const nav = html.slice(html.indexOf("<nav"), html.indexOf("</nav>"));
      for (const p of PAGES) assert.ok(nav.includes(`<a href="${pagePath(lang, p)}"`), `${lang}/${page}: ${p}`);
      assert.equal(nav.match(/aria-current="page"/g).length, 1);
      assert.ok(nav.includes(`<a href="${pagePath(lang, page)}" aria-current="page">`));
    }
  }
});

test("each content page has exactly one h1 and the right html lang", () => {
  for (const lang of LANGS) {
    for (const page of PAGES) {
      const html = files.get(fileOf(lang, page));
      assert.equal(html.match(/<h1[\s>]/g)?.length, 1, `${lang}/${page}`);
      assert.match(html, lang === "en" ? /<html lang="en">/ : /<html lang="zh-Hans">/);
    }
  }
});

test("the sitemap lists exactly the content pages (not the picker, not 404)", () => {
  const xml = files.get("sitemap.xml");
  const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  const expected = LANGS.flatMap((lang) => PAGES.map((page) => config.site + pagePath(lang, page)));
  assert.deepEqual(locs.sort(), expected.sort());
  assert.ok(!locs.includes(`${config.site}/`));
  assert.ok(!xml.includes("404"));
});

test("llms.txt names the site and lists every page with its title and one line", async () => {
  const txt = files.get("llms.txt");
  assert.ok(txt.startsWith(`# ${config.brand}\n\n> `));
  for (const lang of LANGS) {
    for (const page of PAGES) {
      const where = await sourceOf(lang, page);
      const { meta } = parsePage(fill(await readFile(join(ROOT, where), "utf8"), where), where);
      assert.ok(txt.includes(`- [${meta.title}](${config.site}${pagePath(lang, page)}): ${meta.description}\n`), where);
    }
  }
});

test("robots.txt keeps crawlers off /go/ and points to the sitemap", () => {
  const robots = files.get("robots.txt");
  assert.match(robots, /^Disallow: \/go\/$/m);
  assert.ok(robots.includes(`\nSitemap: ${config.site}/sitemap.xml\n`));
});

test("_headers sets the five security headers; the CSP allows only our files and one inline line", () => {
  const text = files.get("_headers");
  assert.ok(text.startsWith("/*\n"));
  for (const line of [
    "Content-Security-Policy: ",
    "X-Content-Type-Options: nosniff",
    "Referrer-Policy: strict-origin-when-cross-origin",
    "Permissions-Policy: ",
    "X-Frame-Options: DENY",
  ]) {
    assert.ok(text.includes(`\n  ${line}`), line);
  }
  const csp = HEADERS["Content-Security-Policy"];
  assert.ok(csp.includes("default-src 'self'"));
  assert.ok(csp.includes(`script-src 'self' '${THEME_SCRIPT_HASH}'`));
  assert.equal(THEME_SCRIPT_HASH, `sha256-${createHash("sha256").update(THEME_SCRIPT).digest("base64")}`);
  assert.doesNotMatch(csp, /https?:|\*|unsafe|data:/);
  // Everything off, except clipboard-write for our own pages (the copy button).
  for (const part of HEADERS["Permissions-Policy"].split(", ")) {
    if (part.startsWith("clipboard-write=")) assert.equal(part, "clipboard-write=(self)");
    else assert.match(part, /^[a-z-]+=\(\)$/);
  }
});

test("scripts: only /site.js and the inline theme line; nothing loaded from other sites", () => {
  for (const [path, html] of htmlFiles()) {
    const scripts = [...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/gi)];
    assert.equal(scripts.length, 2, path);
    assert.deepEqual(scripts.map(([, attrs, inner]) => [attrs.trim(), inner]), [["", THEME_SCRIPT], ['src="/site.js" defer', ""]], path);
    assert.doesNotMatch(html, /\son\w+="/i, `${path}: inline event handler`);
    assert.doesNotMatch(html, /\sstyle="/i, `${path}: inline style (the CSP blocks it)`);
    assert.doesNotMatch(html, /<style/i, `${path}: <style> block (the CSP blocks it)`);
    assert.doesNotMatch(html, /\ssrc="(https?:)?\/\//i, `${path}: something loaded from another site`);
    assert.doesNotMatch(html, /\shref="(https?:)?\/\/[^"]*"[^>]*rel="(stylesheet|preload|preconnect)"|<link rel="(stylesheet|preload|preconnect|dns-prefetch)" href="(https?:)?\/\//i, `${path}: link to another site's files`);
    const sheets = [...html.matchAll(/<link rel="stylesheet" href="([^"]+)"/g)].map((m) => m[1]);
    assert.deepEqual(sheets, ["/style.css"], path);
  }
  const css = files.get("style.css");
  assert.doesNotMatch(css, /@import|url\(\s*["']?(https?:)?\/\//i);
  const js = files.get("site.js");
  assert.doesNotMatch(js, /fetch\(|XMLHttpRequest|https?:\/\//, "site.js talks to nobody");
});

test("no page or file mentions Google's font hosts (blocked in mainland China)", () => {
  for (const [path, text] of files) {
    if (/\.(png|woff2)$/.test(path)) continue;
    assert.doesNotMatch(text, /fonts\.googleapis\.com|fonts\.gstatic\.com/, path);
  }
});

test("fonts are self-hosted: latin @font-face rules with swap, the licence, one preload", () => {
  const css = files.get("style.css");
  const faces = [...css.matchAll(/@font-face \{([\s\S]*?)\}/g)].map((m) => m[1]);
  assert.equal(faces.length, FONT_FILES.length);
  for (const face of faces) {
    assert.match(face, /font-display: swap;/);
    assert.match(face, /unicode-range: U\+0000-00FF/);
  }
  for (const f of FONT_FILES) assert.ok(css.includes(`url("/${f}") format("woff2")`), f);
  assert.match(files.get("fonts/OFL.txt"), /^Copyright © 2017 IBM Corp\. with Reserved Font Name "Plex"/);
  assert.match(files.get("fonts/OFL.txt"), /SIL OPEN FONT LICENSE Version 1\.1/);
  assert.equal(BODY_FONT, "/fonts/plex-sans.woff2");
  for (const [path, html] of htmlFiles()) {
    const preloads = [...html.matchAll(/<link rel="preload"[^>]*>/g)].map((m) => m[0]);
    const expected = fontsMissing.length === FONT_FILES.length && !existsSync(join(ROOT, "assets", BODY_FONT))
      ? []
      : [`<link rel="preload" href="${BODY_FONT}" as="font" type="font/woff2" crossorigin>`];
    assert.deepEqual(preloads, expected, path);
  }
});

test("the font files are in assets/fonts/", { skip: fontsMissing.length ? `not downloaded yet: ${fontsMissing.join(", ")}` : false }, () => {
  for (const f of FONT_FILES) {
    const head = files.get(f) ?? "";
    assert.ok(head.length > 0, f);
  }
});

test("every page has the theme button; the script remembers the choice inside try/catch", () => {
  for (const [path, html] of htmlFiles()) {
    assert.match(html, /<button class="tbtn" id="themeBtn" type="button" aria-label="[^"]+">/, path);
    assert.ok(html.includes('<span id="themeLbl">auto</span>'), path);
  }
  const js = files.get("site.js");
  assert.match(js, /try \{ return localStorage\.getItem\(KEY\); \} catch/);
  assert.match(js, /try \{ localStorage\.setItem\(KEY, v\); \} catch/);
  assert.ok(THEME_SCRIPT.startsWith("try{") && THEME_SCRIPT.includes("}catch(e){}"));
  const css = files.get("style.css");
  assert.ok(css.includes(':root[data-theme="light"]'));
  assert.ok(css.includes('@media (prefers-color-scheme: light)'));
  assert.ok(css.includes('@media (prefers-reduced-motion: reduce)'));
});

test("home pages: sample board is marked as sample, models are '—', install panel and links are right", () => {
  const sample = { "zh-hans": ["示例数据", "示例"], en: ["Sample data", "sample"] };
  for (const lang of LANGS) {
    const html = files.get(fileOf(lang, "index"));
    const board = html.slice(html.indexOf('<table class="board">'), html.indexOf("</table>"));
    const rows = [...board.matchAll(/<tr data-s="([^"]+)">([\s\S]*?)<\/tr>/g)];
    assert.equal(rows.length, 7, lang);
    for (const [, id, row] of rows) {
      assert.ok(row.includes('<td class="c-model model">—</td>'), `${lang}: model column of ${id}`);
      const baseline = ["hold", "dca", "ma"].includes(id);
      if (!baseline) assert.ok(row.includes(`<span class="tag ex">${sample[lang][1]}</span>`), `${lang}: ${id} tagged sample`);
    }
    assert.ok(html.includes(`<span class="pill">${sample[lang][0]}`), `${lang}: board pill`);
    assert.ok(html.includes(`<code id="cmdText">npx -y ${config.npm} init</code>`), lang);
    assert.ok(html.includes(`<code>${config.cli} halt</code>`), lang);
    for (const app of ["Claude Code", "Codex", "OpenClaw"]) assert.ok(html.includes(`role="tab" id="tab-`) && html.includes(`data-app="${app}"`), `${lang}: ${app} tab`);
    for (const p of ["arena", "run"]) assert.ok(html.includes(`<a class="go" href="${pagePath(lang, p)}">`), `${lang}: link to ${p}`);
    assert.ok(html.includes(`<a class="go" href="${config.github}">`), lang);
    assert.ok(html.includes(`href="https://github.com/${config.githubOrg}/arena-data"`), lang);
    // Internal links stay site paths and stay in the page's language (except the language link).
    for (const [, attrs, href] of html.matchAll(/<a([^>]*) href="(\/[^"]*)"/g)) {
      if (attrs.includes('class="lang')) continue;
      if (/^\/(zh-hans|en)\//.test(href)) assert.ok(href.startsWith(`/${lang}/`), `${lang}: ${href}`);
    }
  }
});

test("internal links point at pages that exist", () => {
  const known = new Set(["/", ...LANGS.flatMap((lang) => PAGES.map((page) => pagePath(lang, page)))]);
  for (const [path, html] of htmlFiles()) {
    for (const [, href] of html.matchAll(/<a[^>]* href="(\/(?!go\/)[^"#]*)"/g)) {
      assert.ok(known.has(href), `${path}: ${href}`);
    }
  }
});

test("footers link the Chinese group through the site's own address", () => {
  for (const lang of LANGS) {
    const footer = footerOf(files.get(fileOf(lang, "about")));
    assert.ok(footer.includes(`<a href="${config.site}/tg/join/group_chat/docs-zh">`), lang);
  }
  for (const [path, html] of htmlFiles()) assert.doesNotMatch(html, /t\.me\//, path);
});

test("no {{placeholder}} is left, and config values are filled in", () => {
  for (const [path, text] of files) if (!/\.(png|svg|woff2)$/.test(path)) assert.ok(!text.includes("{{"), path);
  for (const lang of LANGS) {
    const run = files.get(fileOf(lang, "run"));
    assert.ok(run.includes(`npx -y ${config.npm} init`), `${lang}: npm package`);
    assert.ok(run.includes(`${config.cli} halt`), `${lang}: command name`);
    assert.ok(files.get(fileOf(lang, "index")).includes(`<title>${config.brand}</title>`), `${lang}: brand`);
  }
});

test("every /go/ link has a valid from= and leads somewhere the redirect knows", () => {
  let count = 0;
  for (const [path, html] of htmlFiles()) {
    for (const [, attrs, raw] of html.matchAll(/<a([^>]*) href="(\/go\/[^"]*)"/g)) {
      const href = raw.replaceAll("&amp;", "&");
      assert.match(attrs, /rel="nofollow"/, `${path}: ${href}`);
      const hit = resolveGo(config.site + href);
      assert.ok(hit, `${path}: ${href} leads nowhere`);
      assert.ok(hit.src, `${path}: ${href} needs a valid from=`);
      count += 1;
    }
  }
  assert.ok(count > 0, "expected some /go/ links");
});

test("tables get a wrapper that scrolls sideways", () => {
  const html = renderMarkdown("| a | b |\n|---|---|\n| 1 | 2 |\n");
  assert.ok(html.includes('<div class="table-wrap"><table>'));
  assert.ok(html.includes("</table></div>"));
});

test("placeholders and front matter are checked", () => {
  assert.equal(fill("{{brand}} / {{ site }}"), `${config.brand} / ${config.site}`);
  assert.throws(() => fill("{{nope}}", "x.md"), /x\.md: unknown placeholder \{\{nope\}\}/);
  assert.throws(() => parsePage("# no front matter", "x.md"), /x\.md: missing front matter/);
  assert.throws(() => parsePage("---\ntitle: T\n---\nbody", "x.md"), /needs "description"/);
  const { meta, body } = parsePage('---\ntitle: "Step 0: A"\ndescription: d\n---\n# A\n');
  assert.deepEqual(meta, { title: "Step 0: A", description: "d" });
  assert.equal(body, "# A\n");
});

test("no group rules or notices on the site (they belong in the Telegram group only)", () => {
  for (const [path, html] of htmlFiles()) {
    assert.doesNotMatch(html, /骗子|私聊|群规|scam|\bDMs?\b|message you first/i, path);
  }
});
