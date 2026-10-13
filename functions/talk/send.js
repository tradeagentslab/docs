// The interview form on /<lang>/talk/ posts here (plain HTML form, no JavaScript).
//
// We store one row per reply in D1 (table talk_replies): the UTC day, the page language and
// the 8 answers. Nothing else: no IP, no user agent, no cookies, no name.
//
//   honeypot "website" filled      -> 303 to the thanks page, nothing stored (a bot)
//   an answer over 4000 characters -> 400, short page: go back and shorten it
//   every answer empty             -> 303 back to the form
//   200 replies already today      -> 429, short page: full today, email us instead
//   otherwise                      -> store, 303 to /<lang>/talk/thanks/
//
// No DB binding (preview, local): nothing is stored, the visitor still lands on the thanks page.
// Reading the replies happens in a private repo's manual workflow, never in a public log.
// (Visitors from CN never get here: _middleware.js answers 451 first.)

import config from "../../site.config.json" with { type: "json" };
import { HEADERS, today } from "../_shared.js";

export const QUESTIONS = 8;
export const MAX_CHARS = 4000;
export const DAILY_CAP = 200;
const LANGS = ["zh-hans", "en"];
// Far more than 8 full answers, even %-encoded Chinese; anything bigger is not from our form.
const MAX_BODY = 512 * 1024;

const TEXT = {
  "zh-hans": {
    htmlLang: "zh-Hans",
    tooLong: `有一题超过 ${MAX_CHARS} 字。请按浏览器的“返回”，改短后再提交。`,
    full: `今天的回答收满了。请明天再来，或者发邮件到 ${config.email}。`,
    failed: `没有存上，请稍后再试，或者发邮件到 ${config.email}。`,
    bad: "这次提交不像是从问卷页发来的，请回到问卷页再试。",
    back: "回到问卷页",
  },
  en: {
    htmlLang: "en",
    tooLong: `One answer is over ${MAX_CHARS} characters. Please use your browser's Back button, shorten it and send again.`,
    full: `We've had all the replies we can take today. Please come back tomorrow, or email ${config.email}.`,
    failed: `Your answers weren't saved. Please try again later, or email ${config.email}.`,
    bad: "That didn't look like our form. Please go back to the form and try again.",
    back: "Back to the form",
  },
};

const formPath = (lang) => `/${lang}/talk/`;

function redirect(path) {
  return new Response(null, { status: 303, headers: { ...HEADERS, Location: path } });
}

// A short page with one line and a link back to the form.
function page(status, lang, key) {
  const t = TEXT[lang];
  const html = `<!doctype html>
<html lang="${t.htmlLang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${t[key]}</title>
</head>
<body>
<p>${t[key]}</p>
<p><a href="${formPath(lang)}">${t.back}</a></p>
</body>
</html>
`;
  return new Response(html, { status, headers: { ...HEADERS, "Content-Type": "text/html; charset=utf-8" } });
}

// Characters as people count them (an emoji is one, not two).
const length = (text) => [...text].length;

export async function onRequest(context) {
  const { request } = context;
  if (request.method !== "POST") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: { ...HEADERS, Allow: "POST", "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  const type = (request.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  const body = type === "application/x-www-form-urlencoded" ? await request.text() : null;
  if (body === null || body.length > MAX_BODY) return page(400, "en", "bad");
  const form = new URLSearchParams(body);

  const lang = LANGS.includes(form.get("lang")) ? form.get("lang") : "en";
  if ((form.get("website") || "").trim()) return redirect(`/${lang}/talk/thanks/`);

  // Browsers send line breaks as \r\n but count them as one character for maxlength.
  const answers = Array.from({ length: QUESTIONS }, (_, i) => (form.get(`q${i + 1}`) || "").replace(/\r\n?/g, "\n").trim());
  if (answers.some((a) => length(a) > MAX_CHARS)) return page(400, lang, "tooLong");
  if (answers.every((a) => !a)) return redirect(formPath(lang));

  const db = context.env && context.env.DB;
  if (db) {
    const day = today();
    try {
      const row = await db.prepare("SELECT COUNT(*) AS n FROM talk_replies WHERE day = ?").bind(day).first();
      if (row && row.n >= DAILY_CAP) return page(429, lang, "full");
      await db
        .prepare("INSERT INTO talk_replies (day, lang, answers) VALUES (?, ?, ?)")
        .bind(day, lang, JSON.stringify(answers))
        .run();
    } catch (err) {
      console.error("talk reply not saved:", err && err.message);
      return page(503, lang, "failed");
    }
  }
  return redirect(`/${lang}/talk/thanks/`);
}
