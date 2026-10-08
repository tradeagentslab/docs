// Regional gate. Runs before every request to the site.
//
// Cloudflare tells us the visitor's country in request.cf.country. Visitors from mainland
// China get HTTP 451 and a one-line page for every request: pages, files, /go/ links and
// /api/ alike (2026-10-09). Everyone else passes through; exchanges handle their own regions.
//
// We count blocks per day and kind in D1 (table "blocked"), nothing else: no IP, no person.

import { boardPage, withBoard } from "./_board.js";
import { HEADERS, bump, today } from "./_shared.js";

const NOTICES = {
  CN: { lang: "zh-Hans", lines: ["本站不向中国大陆提供服务。"] },
};

// Lower-cases the path, decodes %xx and squeezes repeated slashes,
// so /EN/ACCOUNT/ or /%65n/account/ can't slip past the rules below.
export function normalPath(url) {
  let path = new URL(url).pathname;
  try {
    path = decodeURIComponent(path);
  } catch {
    // Broken %-encoding: check the path as it is.
  }
  return path.toLowerCase().replace(/\/{2,}/g, "/");
}

// Which block applies ("cn"), or null for none. The path no longer matters: the whole site
// is closed to mainland China. Kept as a function so the counter keeps its "kind".
export function blockKind(country, path) {
  return country === "CN" ? "cn" : null;
}

function notice(country) {
  const { lang, lines } = NOTICES[country];
  const html = `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${lines[0]}</title>
</head>
<body>
${lines.map((line) => `<p>${line}</p>`).join("\n")}
</body>
</html>
`;
  return new Response(html, {
    status: 451,
    headers: { ...HEADERS, "Content-Type": "text/html; charset=utf-8" },
  });
}

export async function onRequest(context) {
  const { request } = context;
  const country = request.cf && request.cf.country;
  const path = normalPath(request.url);
  const kind = blockKind(country, path);
  if (!kind) {
    const lang = boardPage(path);
    const res = await context.next();
    return lang ? withBoard(res, lang) : res;
  }

  bump(
    context,
    "INSERT INTO blocked (day, kind, n) VALUES (?, ?, 1) ON CONFLICT (day, kind) DO UPDATE SET n = n + 1",
    [today(), kind],
  );
  return notice(country);
}
