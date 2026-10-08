// Regional gate. Runs before every request to the site.
//
// Cloudflare tells us the visitor's country in request.cf.country:
//   GB: no English pages (/en/ and everything under it).
//   CN: no "open an account" pages (/zh-hans/account/, /en/account/),
//       and none of the sign-up or help-bot links (/go/signup/..., /go/help-bot).
// Those requests get HTTP 451 and a one-line page. Everything else passes through.
//
// We count blocks per day and kind in D1 (table "blocked"), nothing else: no IP, no person.

import { boardPage, withBoard } from "./_board.js";
import { HEADERS, bump, today } from "./_shared.js";

const NOTICES = {
  GB: { lang: "en", lines: ["This page is not available in the United Kingdom."] },
  CN: { lang: "zh-Hans", lines: ["本页不向中国大陆提供服务。", "This page is not available in mainland China."] },
};

// "/en" covers /en, /en/ and /en/anything, but not /english.
function within(path, prefix) {
  return path === prefix || path.startsWith(`${prefix}/`);
}

// Lower-cases the path, decodes %xx and squeezes repeated slashes,
// so /EN/ or /%65n/ can't slip past the rules below.
export function normalPath(url) {
  let path = new URL(url).pathname;
  try {
    path = decodeURIComponent(path);
  } catch {
    // Broken %-encoding: check the path as it is.
  }
  return path.toLowerCase().replace(/\/{2,}/g, "/");
}

// Which block applies ("gb-en", "cn-account", "cn-go"), or null for none.
export function blockKind(country, path) {
  if (country === "GB" && within(path, "/en")) return "gb-en";
  if (country === "CN") {
    if (within(path, "/zh-hans/account") || within(path, "/en/account")) return "cn-account";
    if (within(path, "/go/signup") || within(path, "/go/help-bot")) return "cn-go";
  }
  return null;
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
