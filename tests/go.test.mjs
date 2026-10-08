// The outbound-link redirects in functions/go/[[path]].js, run behind the middleware
// like on Cloudflare Pages, with fake requests and a fake D1.

import assert from "node:assert/strict";
import { test } from "node:test";
import { botStart, cleanId, isPreviewBot } from "../functions/go/[[path]].js";
import targets from "../functions/go/targets.json" with { type: "json" };
import config from "../site.config.json" with { type: "json" };
import { brokenD1, fakeD1, today, visit } from "./helpers.mjs";

const signupUrl = (lang, exchange, id) =>
  `https://fairrebate.com/${lang}/signup/${exchange}/?utm_campaign=${config.campaign}&utm_content=${id}`;
const botUrl = (lang, id) => `https://t.me/FairRebateBot?start=${lang}_${config.campaign}-${id}`;

const clicks = (db) => db.rows("SELECT * FROM clicks ORDER BY target, src");

test("binance sign-up: each language goes to the guide, tagged with campaign and id", async () => {
  for (const lang of ["zh-hans", "zh-hant", "en", "es", "pt-br"]) {
    const res = await visit(`/go/signup/binance?l=${lang}&from=account-en`);
    assert.equal(res.status, 302, lang);
    assert.equal(res.headers.get("location"), signupUrl(lang, "binance", "account-en"));
  }
});

test("okx sign-up: the same, except there is no pt-br guide (404 page, not counted)", async () => {
  for (const lang of ["zh-hans", "zh-hant", "en", "es"]) {
    const res = await visit(`/go/signup/okx?l=${lang}&from=account-en`);
    assert.equal(res.status, 302, lang);
    assert.equal(res.headers.get("location"), signupUrl(lang, "okx", "account-en"));
  }
  const db = fakeD1();
  const res = await visit("/go/signup/okx?l=pt-br&from=account-en", { env: { DB: db } });
  assert.equal(res.status, 404);
  assert.equal(res.headers.get("location"), null);
  assert.equal(await res.text(), "404 page");
  assert.deepEqual(clicks(db), []);
});

test("sign-up without a known language: 404 page", async () => {
  for (const query of ["from=x", "l=fr&from=x", "l=zh&from=x", "l=zhs&from=x"]) {
    const res = await visit(`/go/signup/binance?${query}`);
    assert.equal(res.status, 404, query);
  }
});

test("help bot: each language code goes to the bot with code, campaign and id", async () => {
  for (const lang of ["zhs", "zht", "en", "es", "pt"]) {
    const res = await visit(`/go/help-bot?l=${lang}&from=account-zh-hans`);
    assert.equal(res.status, 302, lang);
    assert.equal(res.headers.get("location"), botUrl(lang, "account-zh-hans"));
  }
  assert.equal((await visit("/go/help-bot?l=zh-hans&from=x")).status, 404);
  assert.equal((await visit("/go/help-bot?from=x")).status, 404);
});

test("tools: each name goes to its address in targets.json", async () => {
  assert.deepEqual(Object.keys(targets).sort(), ["digitalocean", "tradingview"]);
  for (const [name, url] of Object.entries(targets)) {
    assert.match(url, /^https:\/\//);
    const res = await visit(`/go/tool/${name}?from=tools-en`);
    assert.equal(res.status, 302, name);
    assert.equal(res.headers.get("location"), url);
  }
});

test("unknown targets get the 404 page and are not counted", async () => {
  const db = fakeD1();
  for (const path of [
    "/go/",
    "/go/nope?from=x",
    "/go/tool/nope?from=x",
    "/go/tool/__proto__?from=x",
    "/go/tool/constructor?from=x",
    "/go/tool/?from=x",
    "/go/tool/tradingview/more?from=x",
    "/go/signup/kraken?l=en&from=x",
    "/go/signup/binance/more?l=en&from=x",
    "/go/help-bot/more?l=en&from=x",
  ]) {
    const res = await visit(path, { env: { DB: db } });
    assert.equal(res.status, 404, path);
    assert.equal(await res.text(), "404 page", path);
  }
  assert.deepEqual(clicks(db), []);
});

test("clicks are counted per day, target and source; repeats add up", async () => {
  const db = fakeD1();
  const env = { DB: db };
  for (let i = 0; i < 3; i += 1) await visit("/go/tool/tradingview?from=tools-en", { env });
  await visit("/go/tool/tradingview?from=tools-zh-hans", { env });
  await visit("/go/signup/okx?l=en&from=account-en", { env });
  await visit("/go/help-bot?l=zhs&from=account-zh-hans", { env });
  assert.deepEqual(clicks(db), [
    { day: today(), target: "help-bot/zhs", src: "account-zh-hans", n: 1 },
    { day: today(), target: "signup/okx/en", src: "account-en", n: 1 },
    { day: today(), target: "tool/tradingview", src: "tools-en", n: 3 },
    { day: today(), target: "tool/tradingview", src: "tools-zh-hans", n: 1 },
  ]);
});

test("from= is lower-cased; anything else than 1-40 of [a-z0-9_-] is not counted and becomes 'bad'", async () => {
  const db = fakeD1();
  const env = { DB: db };

  const upper = await visit("/go/signup/binance?l=en&from=Account-EN", { env });
  assert.equal(upper.headers.get("location"), signupUrl("en", "binance", "account-en"));

  const longest = "a".repeat(40);
  const ok = await visit(`/go/signup/binance?l=en&from=${longest}`, { env });
  assert.equal(ok.headers.get("location"), signupUrl("en", "binance", longest));

  for (const bad of ["", "a b", "a".repeat(41), "<script>", "ünï", "a.b", "a/b", "a&b"]) {
    const res = await visit(`/go/signup/binance?l=en&from=${encodeURIComponent(bad)}`, { env });
    assert.equal(res.status, 302, bad);
    assert.equal(res.headers.get("location"), signupUrl("en", "binance", "bad"), bad);
  }
  const missing = await visit("/go/help-bot?l=en", { env });
  assert.equal(missing.headers.get("location"), botUrl("en", "bad"));

  assert.deepEqual(clicks(db), [
    { day: today(), target: "signup/binance/en", src: longest, n: 1 },
    { day: today(), target: "signup/binance/en", src: "account-en", n: 1 },
  ]);
  assert.equal(cleanId(" x"), null);
  assert.equal(cleanId("A_b-9"), "a_b-9");
});

test("the bot's start parameter never goes over 64 characters", async () => {
  const cut = botStart("zhs", "x".repeat(100));
  assert.equal(cut.length, 64);
  assert.ok(cut.startsWith(`zhs_${config.campaign}-x`));
  assert.equal(botStart("en", "abc"), `en_${config.campaign}-abc`);

  // The longest id the link accepts (40) fits without cutting.
  const id = "b".repeat(40);
  const res = await visit(`/go/help-bot?l=zht&from=${id}`);
  const start = new URL(res.headers.get("location")).searchParams.get("start");
  assert.equal(start, `zht_${config.campaign}-${id}`);
  assert.ok(start.length <= 64);
});

test("CN: sign-up and help-bot links answer 451 and count as blocked; tool links still work", async () => {
  const db = fakeD1();
  const env = { DB: db };
  for (const path of ["/go/signup/binance?l=en&from=x", "/go/signup/okx?l=zh-hans&from=x", "/go/help-bot?l=zhs&from=x", "/go/SIGNUP/binance?l=en"]) {
    const res = await visit(path, { country: "CN", env });
    assert.equal(res.status, 451, path);
    assert.equal(res.headers.get("location"), null, path);
    assert.ok((await res.text()).includes("本页不向中国大陆提供服务。"), path);
  }
  const tool = await visit("/go/tool/tradingview?from=tools-zh-hans", { country: "CN", env });
  assert.equal(tool.status, 302);

  assert.deepEqual(db.rows("SELECT * FROM blocked"), [{ day: today(), kind: "cn-go", n: 4 }]);
  assert.deepEqual(clicks(db), [{ day: today(), target: "tool/tradingview", src: "tools-zh-hans", n: 1 }]);

  // Other countries are not stopped here.
  assert.equal((await visit("/go/signup/binance?l=en&from=x", { country: "GB" })).status, 302);
});

test("no DB binding: the redirect still works", async () => {
  const res = await visit("/go/tool/digitalocean?from=tools-en", { env: {} });
  assert.equal(res.status, 302);
  assert.equal(res.headers.get("location"), targets.digitalocean);
});

test("a failing DB: the redirect still works; the error is only logged", async (t) => {
  const log = t.mock.method(console, "error", () => {});
  const res = await visit("/go/signup/binance?l=en&from=x", { env: { DB: brokenD1() } });
  assert.equal(res.status, 302);
  assert.equal(log.mock.callCount(), 1);
});

test("HEAD gets the redirect but is not counted", async () => {
  const db = fakeD1();
  const res = await visit("/go/tool/tradingview?from=tools-en", { env: { DB: db }, method: "HEAD" });
  assert.equal(res.status, 302);
  assert.deepEqual(clicks(db), []);
});

test("redirects are not cached and set no cookies", async () => {
  const res = await visit("/go/tool/tradingview?from=tools-en");
  assert.equal(res.headers.get("cache-control"), "no-store");
  assert.equal(res.headers.get("set-cookie"), null);
  assert.equal(res.headers.get("referrer-policy"), "strict-origin-when-cross-origin");
});

test("link previews (Telegram, Discord, X…) still get the redirect but are not counted", async () => {
  const db = fakeD1();
  const env = { DB: db };
  const res = await visit("/go/tool/tradingview?from=tools-en", { env, userAgent: "TelegramBot (like TwitterBot)" });
  assert.equal(res.status, 302);
  await visit("/go/tool/tradingview?from=tools-en", { env, userAgent: "Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)" });
  await visit("/go/tool/tradingview?from=tools-en", { env, userAgent: "Mozilla/5.0 (Macintosh) Safari/605.1.15" });
  assert.deepEqual(clicks(db).map((r) => r.n), [1]);
  assert.equal(isPreviewBot("Mozilla/5.0 (iPhone) Mobile Safari"), false);
  assert.equal(isPreviewBot("facebookexternalhit/1.1"), true);
});
