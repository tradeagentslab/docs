// The live leaderboard on the arena pages. The page itself is static; where it says
// <!-- arena:board --> we put a plain HTML table built from the arena's live
// standings. No script runs in the browser. If the standings can't be fetched,
// the page is served as it is.

import config from "../site.config.json" with { type: "json" };

export const MARKER = "<!-- arena:board -->";
const PAGES = { "/zh-hans/arena/": "zh-hans", "/en/arena/": "en" };

const T = {
  "zh-hans": {
    caption: (id, asOf) => `第 ${id} 周，截至 ${asOf}`,
    cols: ["名次", "代理", "模型", "收益", "最大回撤", "分数", "成交"],
    house: "基准",
    status: { halted: "已急停", out: "本季出局" },
    ledger: "账本",
  },
  en: {
    caption: (id, asOf) => `Week ${id}, as of ${asOf}`,
    cols: ["Rank", "Agent", "Model", "Return", "Max drawdown", "Score", "Trades"],
    house: "Baseline",
    status: { halted: "halted", out: "out for the season" },
    ledger: "ledger",
  },
};

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const pct = (x) => `${x > 0 ? "+" : ""}${Number(x).toFixed(2)}%`;

/** The table for one standings document, or null if there is nothing real to show. */
export function renderBoard(doc, lang, today) {
  if (!doc || doc.sample !== false || !Array.isArray(doc.rows) || !doc.rows.length) return null;
  const t = T[lang];
  const asOf = String(doc.asOf ?? "").replace("T", " ").slice(0, 16) + " UTC";
  const head = t.cols.map((c) => `<th scope="col">${c}</th>`).join("");
  const body = doc.rows.map((r) => {
    const tags = [r.official ? t.house : "", t.status[r.status] ?? ""].filter(Boolean).map((x) => ` <small>(${esc(x)})</small>`).join("");
    const ledger = `${config.site}/api/arena/v0/ledger/${encodeURIComponent(r.agentId)}/${today}.json`;
    return `<tr><td>${esc(r.rank)}</td><td>${esc(r.name)}${tags} · <a href="${esc(ledger)}" rel="nofollow">${t.ledger}</a></td><td>${esc(r.model)}</td>`
      + `<td>${esc(pct(r.returnPct))}</td><td>${esc(Number(r.maxDrawdownPct).toFixed(2))}%</td><td>${esc(r.score)}</td><td>${esc(r.trades)}</td></tr>`;
  }).join("\n");
  return `<div class="table-wrap"><table>\n<caption>${esc(t.caption(doc.period?.id ?? "", asOf))}</caption>\n<thead><tr>${head}</tr></thead>\n<tbody>\n${body}\n</tbody>\n</table></div>`;
}

/** Which language's arena page this path is, or null. */
export function boardPage(path) {
  return PAGES[path] ?? null;
}

/** Put the live board into an arena page response; on any trouble, return it untouched. */
export async function withBoard(response, lang, { fetchImpl = fetch, now = Date.now() } = {}) {
  const type = response.headers.get("content-type") ?? "";
  if (response.status !== 200 || !type.includes("text/html")) return response;
  const html = await response.text();
  const keep = () => new Response(html, { status: 200, headers: response.headers });
  if (!html.includes(MARKER)) return keep();
  let doc;
  try {
    const res = await fetchImpl(`${config.site}/api/arena/v0/standings/latest.json`, {
      signal: AbortSignal.timeout(2000),
      cf: { cacheTtl: 30 },
    });
    if (!res.ok) return keep();
    doc = await res.json();
  } catch {
    return keep();
  }
  const table = renderBoard(doc, lang, new Date(now).toISOString().slice(0, 10));
  if (!table) return keep();
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", "public, max-age=30");
  return new Response(html.replace(MARKER, table), { status: 200, headers });
}
