import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { DISCLAIMER, HEIGHT, MAX_ROWS, renderCard, signed, WIDTH } from "../share/board-card.mjs";

const sample = JSON.parse(readFileSync(new URL("../share/sample-board.json", import.meta.url), "utf8"));
const real = (over = {}) => ({ ...sample, sample: false, ...over });
const bodyRows = (html) => [...html.matchAll(/<tr><td class="rk">(.*?)<\/td><td class="l"><div class="name">(.*?)<\/div><div class="model">(.*?)<\/div>/g)]
  .map((m) => ({ rank: m[1], name: m[2], model: m[3] }));

test("sample input is a standings document with baselines and agents", () => {
  assert.equal(sample.schema, "arena.standings/v0");
  assert.equal(sample.sample, true);
  assert.ok(sample.rows.some((r) => r.official) && sample.rows.some((r) => !r.official));
  sample.rows.forEach((r, i) => assert.equal(r.rank, i + 1));
  for (const r of sample.rows) assert.equal(r.score, Math.round((r.returnPct - 0.5 * r.maxDrawdownPct) * 100) / 100, r.name);
});

test("the card shows the first rows in rank order and counts the rest", () => {
  const html = renderCard(sample, { fonts: false });
  const rows = bodyRows(html);
  assert.equal(rows.length, MAX_ROWS);
  assert.deepEqual(rows.map((r) => r.rank), ["1", "2", "3", "4", "5", "6", "7", "8"]);
  assert.match(rows[0].name, /^example-a/);
  assert.match(html, /\+ 1 more on the full board/);
  assert.match(html, /<td class="pos">\+3\.12%<\/td><td>2\.41%<\/td><td class="sc">\+1\.92%<\/td><td>14<\/td>/);
  assert.match(html, /<td class="neg">−4\.10%<\/td>/);
  const all = renderCard(sample, { fonts: false, rows: 20 });
  assert.equal(bodyRows(all).length, sample.rows.length);
  assert.doesNotMatch(all, /class="more"/);
});

test("the disclaimer is always there, in each language", () => {
  assert.equal(DISCLAIMER.en, "Paper trading. Past results do not predict the future. Not investment advice.");
  for (const lang of ["en", "zh-hans"]) {
    for (const doc of [sample, real()]) {
      const html = renderCard(doc, { lang, fonts: false });
      assert.ok(html.includes(`<span class="disclaimer">${DISCLAIMER[lang]}</span>`), lang);
    }
  }
  assert.ok(renderCard(sample, { lang: "zh-hans", fonts: false }).includes("模拟盘，过去不代表未来，不是投资建议。"));
});

test("sample data is marked sample / 示例; only sample: false is unmarked", () => {
  for (const doc of [sample, { ...sample, sample: undefined }, { ...sample, sample: "false" }]) {
    const html = renderCard(doc, { fonts: false });
    assert.match(html, /<span class="pill">Sample data · 示例<\/span>/);
    assert.match(html, /<div class="wm" aria-hidden="true">SAMPLE · 示例<\/div>/);
  }
  const html = renderCard(real(), { fonts: false });
  assert.doesNotMatch(html, /class="pill"|class="wm"/);
  assert.match(renderCard(real({ season: "S0" }), { fonts: false }), /Trial season · 试运行/);
  assert.match(renderCard(sample, { fonts: false }), /<div class="sub">\/\/ SAMPLE · Week 44, 2026 · as of 2026-11-02 00:00 UTC<\/div>/);
  assert.match(renderCard(sample, { lang: "zh-hans", fonts: false }), /<div class="sub">\/\/ 示例 · 2026 年第 44 周 · 截至 2026-11-02 00:00 UTC<\/div>/);
  assert.match(html, /<div class="sub">\/\/ S1 · Week 44, 2026 · /);
  const live = real({ period: { kind: "live", id: "2026-W05" } });
  assert.match(renderCard(live, { fonts: false }), /\/\/ S1 · Live · Week 5, 2026 · /);
  assert.match(renderCard(live, { lang: "zh-hans", fonts: false }), /\/\/ S1 · 实时 · 2026 年第 5 周 · /);
});

test("ranks agents, not models: the model sits under the agent, baselines say no AI", () => {
  const html = renderCard(sample, { fonts: false });
  assert.match(html, /<th scope="col" class="l">Agent<\/th>/);
  assert.doesNotMatch(html, /<th[^>]*>Model<\/th>/);
  assert.match(html, /Ranks agents, not models/);
  const rows = bodyRows(html);
  const hold = rows.find((r) => r.name.startsWith("Hold"));
  assert.match(hold.name, /<span class="tag">Baseline<\/span>/);
  assert.equal(hold.model, "Rule-based baseline · no AI");
  assert.equal(rows[0].model, "runs on Model A");
  const zh = renderCard(sample, { lang: "zh-hans", fonts: false });
  assert.match(zh, /排的是代理，不是模型/);
  assert.match(zh, /<div class="model">跑在 Model A 上<\/div>/);
  assert.match(zh, /<th scope="col" class="l">代理<\/th>/);
  assert.match(rows.find((r) => r.name.startsWith("example-d")).name, /<span class="tag bad">Halted<\/span>/);
});

test("everything from the data is escaped, and slots are filled once", () => {
  const doc = real({
    season: "<i>S1</i>",
    rows: [
      { rank: 1, name: "<script>alert(1)</script>", model: `a "b" & 'c'`, official: false, returnPct: 1, maxDrawdownPct: 1, score: 0.5, trades: 1, status: "active", curve: [0, 1] },
      { rank: 2, name: "{{rows}}", model: "{{disclaimer}}", official: false, returnPct: "x", maxDrawdownPct: null, score: undefined, trades: "?", status: "out" },
    ],
  });
  const html = renderCard(doc, { fonts: false });
  assert.doesNotMatch(html, /<script>|<i>S1/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /a &quot;b&quot; &amp; &#39;c&#39;/);
  assert.match(html, /&lt;i&gt;S1&lt;\/i&gt;/);
  assert.match(html, /<div class="name">\{\{rows\}\}<span class="tag bad">Out for the season<\/span><\/div><div class="model">runs on \{\{disclaimer\}\}<\/div>/);
  assert.match(html, /<td class="">—<\/td><td>—<\/td><td class="sc">—<\/td><td>—<\/td><td>—<\/td>/);
});

test("one self-contained 1200 x 675 page: no scripts, no outside links, every slot filled", () => {
  const html = renderCard(sample);
  assert.equal(WIDTH, 1200);
  assert.equal(HEIGHT, 675);
  assert.match(html, /width: 1200px; height: 675px;/);
  assert.doesNotMatch(html, /\{\{[a-z0-9-]+\}\}/);
  assert.doesNotMatch(html, /<script|<link|<img|@import/i);
  assert.doesNotMatch(html, /(src|href)=["']?https?:/i);
  assert.match(html, /url\("data:font\/woff2;base64,/);
});

test("bad input is refused", () => {
  assert.throws(() => renderCard(null, { fonts: false }), /rows missing/);
  assert.throws(() => renderCard({ ...sample, schema: "other/v9" }, { fonts: false }), /unsupported schema/);
  assert.throws(() => renderCard(sample, { lang: "fr", fonts: false }), /lang must be/);
});

test("signed numbers use a real minus sign and never show −0.00", () => {
  assert.equal(signed(1.915), "+1.92");
  assert.equal(signed(-0.5), "−0.50");
  assert.equal(signed(-0.001), "0.00");
  assert.equal(signed("abc"), "—");
});
