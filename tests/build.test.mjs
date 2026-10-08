// Builds the site into a temporary folder and checks what comes out.

import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { after, before, test } from "node:test";
import { HEADERS, LANGS, PAGES, ROOT, build, fill, pagePath, parsePage, renderMarkdown } from "../build.mjs";
import { resolveGo } from "../functions/go/[[path]].js";
import config from "../site.config.json" with { type: "json" };

// Footer lines with fixed wording.
const ZH = "模拟盘，过去不代表未来，不是投资建议。";
const EN = "Simulated trading. Past results don't predict future results. Not investment advice.";
const UK_US = "Not for residents of the UK or US.";

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
    "favicon-32.png",
    "apple-touch-icon.png",
    "logo.svg",
    "logo-1024.png",
  ];
  assert.deepEqual([...files.keys()].sort(), expected.sort());
  assert.equal(LANGS.length * PAGES.length, 14);
});

test("every page footer carries the disclaimer; English ones add the UK/US line on its own", () => {
  for (const [path, html] of htmlFiles()) {
    const footer = footerOf(html);
    const zh = path.startsWith("zh-hans/");
    const en = path.startsWith("en/");
    const bilingual = !zh && !en; // the picker at / and 404.html
    if (zh || bilingual) assert.ok(footer.includes(`>${ZH}</p>`), `${path}: Chinese disclaimer`);
    if (en || bilingual) {
      assert.ok(footer.includes(`>${EN}</p>`), `${path}: English disclaimer`);
      assert.ok(footer.includes(`<p lang="en">${UK_US}</p>`), `${path}: UK/US line`);
    }
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
        assert.ok(html.includes(`<a class="lang" href="${pagePath(other, page)}"`), `${lang}/${page} -> ${other}`);
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
      const where = `content/${lang}/${page}.md`;
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

test("_headers sets the five security headers; the CSP allows only our own files", () => {
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
  assert.ok(csp.includes("script-src 'none'"));
  assert.doesNotMatch(csp, /https?:|\*|unsafe|data:/);
  for (const part of HEADERS["Permissions-Policy"].split(", ")) assert.match(part, /^[a-z-]+=\(\)$/);
});

test("pages run no scripts and load nothing from other sites", () => {
  for (const [path, html] of htmlFiles()) {
    assert.doesNotMatch(html, /<script/i, path);
    assert.doesNotMatch(html, /\son\w+="/i, `${path}: inline event handler`);
    assert.doesNotMatch(html, /\ssrc="(https?:)?\/\//i, `${path}: something loaded from another site`);
    const sheets = [...html.matchAll(/<link rel="stylesheet" href="([^"]+)"/g)].map((m) => m[1]);
    assert.deepEqual(sheets, ["/style.css"], path);
  }
  const css = files.get("style.css");
  assert.doesNotMatch(css, /@import|@font-face|url\(\s*["']?(https?:)?\/\//i);
});

test("no {{placeholder}} is left, and config values are filled in", () => {
  for (const [path, text] of files) if (!/\.(png|svg)$/.test(path)) assert.ok(!text.includes("{{"), path);
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
