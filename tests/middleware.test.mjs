// The regional gate in functions/_middleware.js, with fake Cloudflare requests and a fake D1.

import assert from "node:assert/strict";
import { test } from "node:test";
import { blockKind, normalPath } from "../functions/_middleware.js";
import { brokenD1, fakeD1, today, visit } from "./helpers.mjs";

const CN_LINE = "本站不向中国大陆提供服务。";

test("GB and US: every page passes through", async () => {
  for (const path of ["/en/", "/en/run/", "/en/account/", "/zh-hans/", "/zh-hans/account/", "/", "/style.css"]) {
    for (const country of ["GB", "US"]) {
      const res = await visit(path, { country });
      assert.equal(res.status, 200, `${country} ${path}`);
      assert.equal(await res.text(), `static ${path}`);
    }
  }
});

test("CN: every request on the site answers 451 with one Chinese line and nothing else", async () => {
  for (const path of ["/", "/zh-hans/", "/zh-hans/run/", "/en/", "/en/about/", "/zh-hans/account/", "/style.css", "/fonts/plex-sans.woff2", "/go/tool/tradingview?from=x", "/api/region", "/no-such-page", "/ZH-HANS/Account/"]) {
    const res = await visit(path, { country: "CN" });
    assert.equal(res.status, 451, path);
    assert.equal(res.headers.get("location"), null, path);
    const html = await res.text();
    assert.ok(html.includes(`<p>${CN_LINE}</p>`), path);
    assert.equal((html.match(/<p>/g) ?? []).length, 1, `${path}: one line only`);
    assert.doesNotMatch(html, /<a |href=|<img|<script/, `${path}: no links, images or scripts`);
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
  await visit("/en/account/", { country: "CN", env });
  await visit("/go/signup/okx", { country: "CN", env });
  await visit("/zh-hans/", { country: "CN", env });
  await visit("/en/", { country: "GB", env }); // passes: not counted
  await visit("/zh-hans/", { country: "US", env }); // passes: not counted
  assert.deepEqual(db.rows("SELECT * FROM blocked ORDER BY kind"), [
    { day: today(), kind: "cn", n: 3 },
  ]);
});

test("no DB binding: still 451, nothing breaks", async () => {
  const res = await visit("/zh-hans/account/", { country: "CN", env: {} });
  assert.equal(res.status, 451);
});

test("a failing DB: still 451; the error is only logged", async (t) => {
  const log = t.mock.method(console, "error", () => {});
  const res = await visit("/zh-hans/account/", { country: "CN", env: { DB: brokenD1() } });
  assert.equal(res.status, 451);
  assert.equal(log.mock.callCount(), 1);
});

test("451 pages are not cached, not indexed, and carry the security headers", async () => {
  const res = await visit("/zh-hans/account/", { country: "CN" });
  assert.equal(res.headers.get("cache-control"), "no-store");
  assert.equal(res.headers.get("x-content-type-options"), "nosniff");
  assert.equal(res.headers.get("x-frame-options"), "DENY");
  assert.equal(res.headers.get("referrer-policy"), "strict-origin-when-cross-origin");
  assert.match(res.headers.get("content-security-policy"), /default-src 'none'/);
  assert.ok((await res.text()).includes('<meta name="robots" content="noindex">'));
});

test("blockKind and normalPath", () => {
  assert.equal(blockKind("GB", "/en"), null);
  assert.equal(blockKind("GB", "/en/account"), null);
  assert.equal(blockKind("US", "/go/signup/binance"), null);
  for (const path of ["/", "/en/account", "/go/signup/okx", "/go/tool/tradingview", "/api/region", "/style.css"]) {
    assert.equal(blockKind("CN", path), "cn", path);
  }
  assert.equal(blockKind(undefined, "/en/"), null);
  assert.equal(normalPath("https://example.test/%45N//Run/"), "/en/run/");
  assert.equal(normalPath("https://example.test/en/%E0%A4%A"), "/en/%e0%a4%a"); // broken %-encoding: kept
});
