// The interview form handler in functions/talk/send.js, with fake requests and a fake D1.

import assert from "node:assert/strict";
import { test } from "node:test";
import { DAILY_CAP, MAX_CHARS, QUESTIONS } from "../functions/talk/send.js";
import { brokenD1, fakeD1, today, visit } from "./helpers.mjs";

// A form body like the page sends: lang, the empty honeypot, q1..q8.
function form({ lang = "en", website = "", answers = {} } = {}) {
  const params = new URLSearchParams({ lang, website });
  for (let i = 1; i <= QUESTIONS; i += 1) params.set(`q${i}`, answers[i] ?? "");
  return params.toString();
}

const post = (body, opts = {}) => visit("/talk/send", { method: "POST", body, ...opts });
const stored = (db) => db.rows("SELECT id, day, lang, answers FROM talk_replies ORDER BY id");

test("happy path: one row with day, lang and 8 trimmed answers; 303 to the thanks page", async () => {
  const db = fakeD1();
  const res = await post(form({ lang: "zh-hans", answers: { 1: "  模拟盘  ", 4: "急停\n很重要" } }), { env: { DB: db } });
  assert.equal(res.status, 303);
  assert.equal(res.headers.get("location"), "/zh-hans/talk/thanks/");
  const rows = stored(db);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].day, today());
  assert.equal(rows[0].lang, "zh-hans");
  assert.deepEqual(JSON.parse(rows[0].answers), ["模拟盘", "", "", "急停\n很重要", "", "", "", ""]);
  assert.deepEqual(Object.keys(rows[0]), ["id", "day", "lang", "answers"]);
});

test("nothing about the person is stored or set: no IP, no user agent, no cookie", async () => {
  const db = fakeD1();
  const res = await post(form({ answers: { 2: "yes" } }), { env: { DB: db }, userAgent: "Mozilla/5.0 test-agent", country: "US" });
  assert.equal(res.status, 303);
  assert.equal(res.headers.get("set-cookie"), null);
  const cols = db.rows("PRAGMA table_info(talk_replies)").map((c) => c.name);
  assert.deepEqual(cols, ["id", "day", "lang", "answers"]);
  assert.doesNotMatch(JSON.stringify(stored(db)), /test-agent|US/);
});

test("lang must be zh-hans or en; anything else becomes en", async () => {
  for (const lang of ["fr", "", "EN", "zh-hant", "../x"]) {
    const db = fakeD1();
    const res = await post(form({ lang, answers: { 1: "a" } }), { env: { DB: db } });
    assert.equal(res.headers.get("location"), "/en/talk/thanks/", lang);
    assert.equal(stored(db)[0].lang, "en", lang);
  }
});

test("honeypot filled: looks like success, nothing stored", async () => {
  const db = fakeD1();
  const res = await post(form({ lang: "zh-hans", website: "http://spam.example", answers: { 1: "buy now" } }), { env: { DB: db } });
  assert.equal(res.status, 303);
  assert.equal(res.headers.get("location"), "/zh-hans/talk/thanks/");
  assert.equal(stored(db).length, 0);
});

test("an answer over 4000 characters: 400 and a short page, nothing stored", async () => {
  const db = fakeD1();
  const ok = "字".repeat(MAX_CHARS);
  assert.equal((await post(form({ answers: { 3: ok } }), { env: { DB: db } })).status, 303, "exactly 4000 is fine");
  for (const lang of ["zh-hans", "en"]) {
    const res = await post(form({ lang, answers: { 3: `${ok}x` } }), { env: { DB: db } });
    assert.equal(res.status, 400, lang);
    const html = await res.text();
    assert.ok(html.includes(String(MAX_CHARS)), lang);
    assert.ok(html.includes(`href="/${lang}/talk/"`), lang);
  }
  assert.equal(stored(db).length, 1);
});

test("all answers empty (or only spaces): back to the form, nothing stored", async () => {
  const db = fakeD1();
  for (const lang of ["zh-hans", "en"]) {
    const res = await post(form({ lang, answers: { 1: "   ", 5: "\n\n" } }), { env: { DB: db } });
    assert.equal(res.status, 303);
    assert.equal(res.headers.get("location"), `/${lang}/talk/`);
  }
  assert.equal(stored(db).length, 0);
});

test("daily cap: at 200 rows today, 429 and a page pointing to email; earlier days don't count", async () => {
  const db = fakeD1();
  const values = (day, n) => Array.from({ length: n }, () => `('${day}', 'en', '[]')`).join(",");
  db.exec(`INSERT INTO talk_replies (day, lang, answers) VALUES ${values("2000-01-01", 500)}`);
  db.exec(`INSERT INTO talk_replies (day, lang, answers) VALUES ${values(today(), DAILY_CAP - 1)}`);
  assert.equal((await post(form({ answers: { 1: "199 -> 200" } }), { env: { DB: db } })).status, 303);
  const res = await post(form({ lang: "zh-hans", answers: { 1: "one too many" } }), { env: { DB: db } });
  assert.equal(res.status, 429);
  assert.ok((await res.text()).includes("hello@"));
  assert.equal(db.rows(`SELECT COUNT(*) AS n FROM talk_replies WHERE day = '${today()}'`)[0].n, DAILY_CAP);
});

test("no DB binding (preview): nothing stored, still the thanks page", async () => {
  const res = await post(form({ lang: "zh-hans", answers: { 1: "a" } }));
  assert.equal(res.status, 303);
  assert.equal(res.headers.get("location"), "/zh-hans/talk/thanks/");
});

test("a failing DB: 503 page asking to try later or email; the error is only logged", async (t) => {
  t.mock.method(console, "error", () => {});
  const res = await post(form({ answers: { 1: "a" } }), { env: { DB: brokenD1() } });
  assert.equal(res.status, 503);
  assert.ok((await res.text()).includes("hello@"));
});

test("only POST: other methods get 405 with Allow: POST", async () => {
  for (const method of ["GET", "HEAD", "PUT", "DELETE"]) {
    const res = await visit("/talk/send", { method });
    assert.equal(res.status, 405, method);
    assert.equal(res.headers.get("allow"), "POST", method);
  }
});

test("not a urlencoded form: 400, nothing stored", async () => {
  const db = fakeD1();
  const res = await post(JSON.stringify({ q1: "a" }), { env: { DB: db }, type: "application/json" });
  assert.equal(res.status, 400);
  assert.equal(stored(db).length, 0);
});

test("responses are not cached and carry the security headers", async () => {
  for (const res of [await post(form({ answers: { 1: "a" } })), await post(form({ answers: { 1: "x".repeat(MAX_CHARS + 1) } }))]) {
    assert.equal(res.headers.get("cache-control"), "no-store");
    assert.equal(res.headers.get("x-frame-options"), "DENY");
    assert.match(res.headers.get("content-security-policy"), /default-src 'none'/);
  }
});

test("CN: the form handler answers 451 and stores nothing", async () => {
  const db = fakeD1();
  for (const path of ["/talk/send", "/TALK/send", "/zh-hans/talk/", "/en/talk/thanks/"]) {
    const res = await visit(path, { method: path === "/talk/send" ? "POST" : "GET", body: path === "/talk/send" ? form({ answers: { 1: "a" } }) : undefined, country: "CN", env: { DB: db } });
    assert.equal(res.status, 451, path);
  }
  assert.equal(stored(db).length, 0);
});

test("line breaks sent as \\r\\n count as one character", async () => {
  const db = fakeD1();
  const text = "a\r\n".repeat(1999) + "ab";
  assert.equal((await post(form({ answers: { 1: text } }), { env: { DB: db } })).status, 303);
  assert.equal(JSON.parse(stored(db)[0].answers)[0].length, 4000);
});
