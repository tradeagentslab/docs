// The regional gate in functions/_middleware.js, with fake Cloudflare requests and a fake D1.

import assert from "node:assert/strict";
import { test } from "node:test";
import { blockKind, normalPath } from "../functions/_middleware.js";
import { brokenD1, fakeD1, today, visit } from "./helpers.mjs";

const UK_LINE = "This page is not available in the United Kingdom.";
const CN_LINE = "本页不向中国大陆提供服务。";
const CN_LINE_EN = "This page is not available in mainland China.";

test("GB: every English page answers 451 with the UK line", async () => {
  for (const path of ["/en/", "/en", "/en/run/", "/en/account/", "/en/no-such-page/", "/EN/Run/", "/%65n/run/", "//en//run/"]) {
    const res = await visit(path, { country: "GB" });
    assert.equal(res.status, 451, path);
    assert.equal(res.headers.get("content-type"), "text/html; charset=utf-8");
    const html = await res.text();
    assert.ok(html.includes(`<p>${UK_LINE}</p>`), path);
    assert.ok(!html.includes(CN_LINE), path);
  }
});

test("GB: Chinese pages, the root and other files pass through", async () => {
  for (const path of ["/zh-hans/", "/zh-hans/run/", "/zh-hans/account/", "/", "/style.css", "/english/"]) {
    const res = await visit(path, { country: "GB" });
    assert.equal(res.status, 200, path);
    assert.equal(await res.text(), `static ${path}`);
  }
});

test("CN: both account pages answer 451 with the Chinese line plus an English line", async () => {
  for (const path of ["/zh-hans/account/", "/zh-hans/account", "/zh-hans/account/index.html", "/en/account/", "/ZH-HANS/Account/"]) {
    const res = await visit(path, { country: "CN" });
    assert.equal(res.status, 451, path);
    const html = await res.text();
    assert.ok(html.includes(`<p>${CN_LINE}</p>`), path);
    assert.ok(html.includes(`<p>${CN_LINE_EN}</p>`), path);
  }
});

test("CN: every other page passes through", async () => {
  for (const path of ["/", "/zh-hans/", "/zh-hans/run/", "/zh-hans/tools/", "/zh-hans/accounts/", "/en/", "/en/run/", "/en/about/"]) {
    const res = await visit(path, { country: "CN" });
    assert.equal(res.status, 200, path);
  }
});

test("other countries, or no country at all, pass everywhere", async () => {
  for (const country of ["US", "HK", "DE", undefined]) {
    for (const path of ["/en/", "/en/account/", "/zh-hans/account/"]) {
      const res = await visit(path, { country });
      assert.equal(res.status, 200, `${country} ${path}`);
    }
  }
});

test("blocks are counted per day and kind, and nothing else is stored", async () => {
  const db = fakeD1();
  const env = { DB: db };
  await visit("/en/", { country: "GB", env });
  await visit("/en/run/", { country: "GB", env });
  await visit("/zh-hans/account/", { country: "CN", env });
  await visit("/zh-hans/", { country: "CN", env }); // passes: not counted
  await visit("/zh-hans/", { country: "GB", env }); // passes: not counted
  assert.deepEqual(db.rows("SELECT * FROM blocked ORDER BY kind"), [
    { day: today(), kind: "cn-account", n: 1 },
    { day: today(), kind: "gb-en", n: 2 },
  ]);
});

test("no DB binding: still 451, nothing breaks", async () => {
  const res = await visit("/en/", { country: "GB", env: {} });
  assert.equal(res.status, 451);
});

test("a failing DB: still 451; the error is only logged", async (t) => {
  const log = t.mock.method(console, "error", () => {});
  const res = await visit("/en/", { country: "GB", env: { DB: brokenD1() } });
  assert.equal(res.status, 451);
  assert.equal(log.mock.callCount(), 1);
});

test("451 pages are not cached, not indexed, and carry the security headers", async () => {
  const res = await visit("/en/", { country: "GB" });
  assert.equal(res.headers.get("cache-control"), "no-store");
  assert.equal(res.headers.get("x-content-type-options"), "nosniff");
  assert.equal(res.headers.get("x-frame-options"), "DENY");
  assert.equal(res.headers.get("referrer-policy"), "strict-origin-when-cross-origin");
  assert.match(res.headers.get("content-security-policy"), /default-src 'none'/);
  assert.ok((await res.text()).includes('<meta name="robots" content="noindex">'));
});

test("blockKind and normalPath", () => {
  assert.equal(blockKind("GB", "/en"), "gb-en");
  assert.equal(blockKind("GB", "/english"), null);
  assert.equal(blockKind("GB", "/go/signup/binance"), null);
  assert.equal(blockKind("CN", "/en/account"), "cn-account");
  assert.equal(blockKind("CN", "/go/signup/okx"), "cn-go");
  assert.equal(blockKind("CN", "/go/help-bot"), "cn-go");
  assert.equal(blockKind("CN", "/go/help-bots"), null);
  assert.equal(blockKind("CN", "/go/tool/tradingview"), null);
  assert.equal(blockKind(undefined, "/en/"), null);
  assert.equal(normalPath("https://example.test/%45N//Run/"), "/en/run/");
  assert.equal(normalPath("https://example.test/en/%E0%A4%A"), "/en/%e0%a4%a"); // broken %-encoding: kept
});
