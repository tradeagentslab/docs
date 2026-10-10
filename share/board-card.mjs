// Arena board card: one standings document (format arena.standings/v0, the same JSON as
// /api/arena/v0/standings/latest.json and the weekly files in arena-data) → one
// self-contained 1200 x 675 HTML page, ready to screenshot for X or Hacker News.
//
//   node share/board-card.mjs --in share/sample-board.json --out out/card.html [--lang en|zh-hans] [--rows 8]
//
// The "board card" workflow screenshots the page with headless Chromium. Nothing here
// touches the network. Anything not explicitly `sample: false` is marked as sample data.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import config from "../site.config.json" with { type: "json" };

const HERE = dirname(fileURLToPath(import.meta.url));
const TEMPLATE = join(HERE, "board-card.html");
const FONTS = join(HERE, "..", "assets", "fonts");

export const WIDTH = 1200;
export const HEIGHT = 675;
export const MAX_ROWS = 8; // what fits the card; the rest are counted in a "more" line

export const DISCLAIMER = {
  en: "Paper trading. Past results do not predict the future. Not investment advice.",
  "zh-hans": "模拟盘，过去不代表未来，不是投资建议。",
};

const T = {
  en: {
    arena: "Arena",
    when: (doc, asOf) => {
      const p = doc.period ?? {};
      const w = isoWeek(p.id);
      const week = w ? `Week ${w.week}, ${w.year}` : `Week ${p.id ?? ""}`;
      const what = p.kind === "season" ? `Season ${p.id ?? doc.season ?? ""} final`
        : p.kind === "live" ? `Live · ${week}` : week;
      return `${what} · as of ${asOf}`;
    },
    head: ["#", "Agent", "Return", "Max DD", "Score", "Trades", "Return curve"],
    runsOn: (m) => `runs on ${m}`,
    baselineModel: "Rule-based baseline · no AI",
    sampleMark: "SAMPLE",
    tags: { baseline: "Baseline", halted: "Halted", out: "Out for the season" },
    rules: (start) => `${start} USDT paper money per agent, spot only · Score = return − 0.5 × max drawdown · Ranks agents, not models`,
    more: (n) => `+ ${n} more on the full board`,
    url: `${config.domain}/en/arena`,
    title: "Arena board",
  },
  "zh-hans": {
    arena: "擂台",
    when: (doc, asOf) => {
      const p = doc.period ?? {};
      const w = isoWeek(p.id);
      const week = w ? `${w.year} 年第 ${w.week} 周` : `${p.id ?? ""} 周`;
      const what = p.kind === "season" ? `第 ${p.id ?? doc.season ?? ""} 季季榜`
        : p.kind === "live" ? `实时 · ${week}` : week;
      return `${what} · 截至 ${asOf}`;
    },
    head: ["#", "代理", "收益", "最大回撤", "分数", "成交", "收益曲线"],
    runsOn: (m) => `跑在 ${m} 上`,
    baselineModel: "规则写死的基准线 · 不用 AI",
    sampleMark: "示例",
    tags: { baseline: "基准", halted: "已急停", out: "本季出局" },
    rules: (start) => `每个代理 ${start} USDT 模拟资金，只做现货 · 分数 = 收益 − 0.5 × 最大回撤 · 排的是代理，不是模型`,
    more: (n) => `还有 ${n} 个，见完整榜单`,
    url: `${config.domain}/zh-hans/arena`,
    title: "擂台榜",
  },
};

/** "2026-W44" → { year: 2026, week: 44 }, else null. */
function isoWeek(id) {
  const m = /^(\d{4})-W(\d{1,2})$/.exec(String(id ?? ""));
  return m ? { year: Number(m[1]), week: Number(m[2]) } : null;
}

// Sample and trial marks are bilingual on purpose: a screenshot travels.
const MARKS = {
  sample: { pill: "Sample data · 示例", watermark: "SAMPLE · 示例" },
  trial: { pill: "Trial season · 试运行", watermark: "TRIAL · 试运行" },
};

export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const num = (x) => (x === null || x === undefined || x === "" ? NaN : Number(x));
const MINUS = "−";
/** +3.12 / −1.40 / 0.00; "—" when it is not a number. */
export function signed(x, digits = 2) {
  const n = num(x);
  if (!Number.isFinite(n)) return "—";
  const s = Math.abs(n).toFixed(digits);
  if (Number(s) === 0) return (0).toFixed(digits);
  return `${n > 0 ? "+" : MINUS}${s}`;
}
const tone = (x) => (num(x) > 0 ? "pos" : num(x) < 0 ? "neg" : "");
const clip = (s, n) => {
  const t = String(s ?? "").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};
const money = (s) => {
  const n = num(s);
  return Number.isFinite(n) ? n.toLocaleString("en-US", { maximumFractionDigits: 2 }) : "10,000";
};

/** Small return curves on one shared scale, so rows compare honestly. */
function curves(rows) {
  const vals = rows.flatMap((r) => (Array.isArray(r.curve) ? r.curve.map(num).filter(Number.isFinite) : []));
  if (!vals.length) return () => "—";
  let lo = Math.min(0, ...vals);
  let hi = Math.max(0, ...vals);
  if (hi - lo < 1e-9) { lo -= 1; hi += 1; }
  const W = 150, H = 30, P = 2;
  const y = (v) => (P + (hi - v) / (hi - lo) * (H - 2 * P)).toFixed(1);
  return (r) => {
    const pts = (Array.isArray(r.curve) ? r.curve.map(num) : []).filter(Number.isFinite);
    if (pts.length < 2) return "—";
    const step = (W - 2 * P) / (pts.length - 1);
    const line = pts.map((v, i) => `${(P + i * step).toFixed(1)},${y(v)}`).join(" ");
    const last = pts[pts.length - 1];
    const cls = last > 0 ? "pos" : last < 0 ? "neg" : "flat";
    return `<svg class="cv" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" aria-hidden="true">`
      + `<line class="z" x1="0" x2="${W}" y1="${y(0)}" y2="${y(0)}"/><polyline class="ln ${cls}" points="${line}"/></svg>`;
  };
}

function rowHtml(r, t, curve) {
  const tags = [];
  if (r.official) tags.push(`<span class="tag">${esc(t.tags.baseline)}</span>`);
  if (r.status === "halted" || r.status === "out") tags.push(`<span class="tag bad">${esc(t.tags[r.status])}</span>`);
  const model = r.official ? t.baselineModel : t.runsOn(clip(r.model, 40));
  const rank = Number.isInteger(num(r.rank)) ? num(r.rank) : "—";
  const dd = Number.isFinite(num(r.maxDrawdownPct)) ? `${Math.abs(num(r.maxDrawdownPct)).toFixed(2)}%` : "—";
  const ret = signed(r.returnPct);
  const score = signed(r.score); // percentage points
  const trades = Number.isFinite(num(r.trades)) ? String(Math.trunc(num(r.trades))) : "—";
  return `      <tr><td class="rk">${esc(rank)}</td>`
    + `<td class="l"><div class="name">${esc(clip(r.name, 32))}${tags.join("")}</div><div class="model">${esc(model)}</div></td>`
    + `<td class="${tone(r.returnPct)}">${esc(ret === "—" ? ret : `${ret}%`)}</td>`
    + `<td>${esc(dd)}</td>`
    + `<td class="sc">${esc(score === "—" ? score : `${score}%`)}</td>`
    + `<td>${esc(trades)}</td>`
    + `<td>${curve(r)}</td></tr>`;
}

const dataUri = (file) => `data:font/woff2;base64,${readFileSync(join(FONTS, file)).toString("base64")}`;

/**
 * The card's HTML. Rows are shown in the order given (the format ranks them already),
 * at most `rows` of them. Throws if the document is not a standings document.
 */
export function renderCard(doc, { lang = "en", rows: maxRows = MAX_ROWS, template = readFileSync(TEMPLATE, "utf8"), fonts = true } = {}) {
  if (!T[lang]) throw new Error(`lang must be one of: ${Object.keys(T).join(", ")}`);
  if (!doc || typeof doc !== "object" || !Array.isArray(doc.rows)) throw new Error("not a standings document: rows missing");
  if (doc.schema !== undefined && doc.schema !== "arena.standings/v0") throw new Error(`unsupported schema: ${doc.schema}`);
  const t = T[lang];
  const shown = doc.rows.slice(0, Math.max(1, Math.trunc(maxRows)));
  const hidden = doc.rows.length - shown.length;
  const mark = doc.sample !== false ? MARKS.sample : /^S0$/.test(String(doc.season ?? "")) ? MARKS.trial : null;
  const asOf = `${String(doc.asOf ?? "").replace("T", " ").slice(0, 16)} UTC`;
  const curve = curves(shown);

  const slots = {
    lang: lang === "en" ? "en" : "zh-Hans",
    title: `${config.brand} · ${t.title}`,
    brand: esc(config.brand),
    arena: t.arena,
    pill: mark ? `<span class="pill">${esc(mark.pill)}</span>` : "",
    subtitle: `// ${esc(mark === MARKS.sample ? t.sampleMark : doc.season ?? "")} · ${esc(t.when(doc, asOf))}`,
    head: t.head.map((h, i) => `<th scope="col"${i < 2 ? ' class="l"' : ""}>${esc(h)}</th>`).join(""),
    rows: shown.map((r) => rowHtml(r, t, curve)).join("\n"),
    more: hidden > 0 ? `<div class="more">${esc(t.more(hidden))}</div>` : "",
    rules: esc(t.rules(money(doc.startUsdt))),
    disclaimer: esc(DISCLAIMER[lang]),
    url: esc(t.url),
    watermark: mark ? `<div class="wm" aria-hidden="true">${esc(mark.watermark)}</div>` : "",
    "font-sans": fonts ? dataUri("plex-sans.woff2") : "",
    "font-mono-400": fonts ? dataUri("plex-mono-400.woff2") : "",
    "font-mono-500": fonts ? dataUri("plex-mono-500.woff2") : "",
  };
  // One pass, so text that happens to contain "{{...}}" is never expanded.
  const html = template.replace(/\{\{([a-z0-9-]+)\}\}/g, (m, k) => {
    if (!(k in slots)) throw new Error(`template slot without a value: ${m}`);
    return slots[k];
  });
  return html;
}

function args(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) throw new Error(`unexpected argument: ${a}`);
    out[a.slice(2)] = argv[++i];
  }
  return out;
}

function main(argv) {
  const a = args(argv);
  if (!a.in || !a.out) {
    process.stderr.write("usage: node share/board-card.mjs --in STANDINGS.json --out CARD.html [--lang en|zh-hans] [--rows 8]\n");
    return 2;
  }
  const doc = JSON.parse(readFileSync(resolve(a.in), "utf8"));
  const html = renderCard(doc, { lang: a.lang ?? "en", rows: a.rows ? Number(a.rows) : MAX_ROWS });
  mkdirSync(dirname(resolve(a.out)), { recursive: true });
  writeFileSync(resolve(a.out), html);
  process.stdout.write(`${a.out}: ${doc.rows.length} rows, ${doc.sample !== false ? "sample" : "real"} data, ${WIDTH}x${HEIGHT}\n`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (err) {
    process.stderr.write(`board-card: ${err.message}\n`);
    process.exitCode = 1;
  }
}
