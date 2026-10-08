import assert from "node:assert/strict";
import { test } from "node:test";
import { boardPage, MARKER, renderBoard, withBoard } from "../functions/_board.js";

const doc = {
  schema: "arena.standings/v0", sample: false, asOf: "2026-11-02T00:00:00.000Z", period: { id: "2026-W44" },
  rows: [
    { rank: 1, agentId: "tal-grok", name: "Grok", model: "Grok 4", official: true, returnPct: 3.12, maxDrawdownPct: 2.41, score: 1.92, trades: 14, status: "active" },
    { rank: 2, agentId: "x-bot", name: "<b>X</b>", model: "m & n", official: false, returnPct: -30.5, maxDrawdownPct: 31, score: -46, trades: 9, status: "out" },
  ],
};
const page = (body) => new Response(`<html><body>${body}</body></html>`, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
const api = (status, body) => async () => ({ ok: status === 200, status, json: async () => body });

test("the table escapes names, marks house agents and agents that are out", () => {
  const html = renderBoard(doc, "zh-hans", "2026-11-02");
  assert.match(html, /Grok <small>\(基准\)<\/small>/);
  assert.match(html, /&lt;b&gt;X&lt;\/b&gt; <small>\(本季出局\)<\/small>/);
  assert.match(html, /m &amp; n/);
  assert.match(html, /\+3\.12%/);
  assert.match(html, /-30\.50%/);
  assert.match(html, /ledger\/tal-grok\/2026-11-02\.json/);
  assert.match(renderBoard(doc, "en", "2026-11-02"), /Baseline/);
});

test("sample or empty standings are never shown", () => {
  assert.equal(renderBoard({ ...doc, sample: true }, "en", "x"), null);
  assert.equal(renderBoard({ ...doc, rows: [] }, "en", "x"), null);
  assert.equal(renderBoard(null, "en", "x"), null);
});

test("the trial season S0 is never shown; real seasons are", () => {
  assert.equal(renderBoard({ ...doc, season: "S0" }, "en", "x"), null);
  assert.notEqual(renderBoard({ ...doc, season: "S1" }, "en", "x"), null);
});

test("only the two arena pages get a board", () => {
  assert.equal(boardPage("/zh-hans/arena/"), "zh-hans");
  assert.equal(boardPage("/en/arena/"), "en");
  assert.equal(boardPage("/en/run/"), null);
});

test("the board replaces the marker; any trouble leaves the page as it was", async () => {
  const ok = await withBoard(page(`a ${MARKER} b`), "en", { fetchImpl: api(200, doc) });
  const text = await ok.text();
  assert.match(text, /<table>/);
  assert.ok(!text.includes(MARKER));
  assert.equal(ok.headers.get("cache-control"), "public, max-age=30");

  for (const fetchImpl of [api(404, {}), api(200, { ...doc, sample: true }), async () => { throw new Error("timeout"); }]) {
    const res = await withBoard(page(`a ${MARKER} b`), "en", { fetchImpl });
    assert.equal(res.status, 200);
    assert.ok((await res.text()).includes(MARKER));
  }
  const noMarker = await withBoard(page("plain"), "en", { fetchImpl: api(200, doc) });
  assert.equal(await noMarker.text(), "<html><body>plain</body></html>");
});
