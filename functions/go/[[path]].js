// Links out of the site. Every outbound link goes through /go/: we add 1 to a counter for
// (day, target, source), then send the visitor on with a 302. No IP, no user agent,
// nothing about the person is stored.
//
//   /go/signup/binance?l=<lang>&from=<id>  -> sign-up guide on fairrebate.com (okx: same, but no pt-br)
//   /go/help-bot?l=<code>&from=<id>          -> the help bot on Telegram
//   /go/tool/<name>?from=<page>            -> the address for <name> in targets.json
//
// "from" must be 1-40 characters of a-z 0-9 _ - (lower-cased first). Anything else is not
// counted and travels on as "bad". Unknown targets get the site's 404 page.
// (Visitors from CN never reach signup/ or help-bot: _middleware.js answers 451 first.)

import config from "../../site.config.json" with { type: "json" };
import { HEADERS, bump, today } from "../_shared.js";
import targets from "./targets.json" with { type: "json" };

// Languages of the sign-up guides, per exchange.
const SIGNUP = {
  binance: ["zh-hans", "zh-hant", "en", "es", "pt-br"],
  okx: ["zh-hans", "zh-hant", "en", "es"],
};

// Language codes the help bot understands.
const BOT_LANGS = ["zhs", "zht", "en", "es", "pt"];

const ID = /^[a-z0-9_-]{1,40}$/;

// Link previews (a link pasted into Telegram, Discord, X…) fetch the address once.
// Those are not people clicking, so they are not counted. The user agent is only
// looked at here, never stored.
const PREVIEW_BOT = /TelegramBot|Discordbot|Twitterbot|Slackbot|facebookexternalhit|WhatsApp|LinkedInBot|SkypeUriPreview|Applebot|bingbot|Googlebot|\bbot\b|crawler|spider/i;

export function isPreviewBot(userAgent) {
  return PREVIEW_BOT.test(String(userAgent ?? ""));
}

// A clean source id, or null if it doesn't pass.
export function cleanId(raw) {
  const id = String(raw ?? "").toLowerCase();
  return ID.test(id) ? id : null;
}

// Telegram's start parameter may be at most 64 characters; the id gets cut to fit.
export function botStart(lang, id) {
  const head = `${lang}_${config.campaign}-`;
  return head + id.slice(0, Math.max(0, 64 - head.length));
}

// Works out where a /go/ address leads: { location, target, src }, or null if we don't know it.
// src is the clean "from" value, or null when it was missing or bad (then nothing is counted).
export function resolveGo(url) {
  const u = new URL(url);
  const [first, kind, name, extra] = u.pathname.toLowerCase().split("/").filter(Boolean);
  if (first !== "go" || extra !== undefined) return null;

  const src = cleanId(u.searchParams.get("from"));
  const id = src ?? "bad";
  const lang = (u.searchParams.get("l") ?? "").toLowerCase();

  if (kind === "signup" && Object.hasOwn(SIGNUP, name ?? "") && SIGNUP[name].includes(lang)) {
    return {
      location: `https://fairrebate.com/${lang}/signup/${name}/?utm_campaign=${config.campaign}&utm_content=${id}`,
      target: `signup/${name}/${lang}`,
      src,
    };
  }
  if (kind === "help-bot" && name === undefined && BOT_LANGS.includes(lang)) {
    return {
      location: `https://t.me/FairRebateBot?start=${botStart(lang, id)}`,
      target: `help-bot/${lang}`,
      src,
    };
  }
  if (kind === "tool" && Object.hasOwn(targets, name ?? "")) {
    return { location: targets[name], target: `tool/${name}`, src };
  }
  return null;
}

async function handle(context, count) {
  const hit = resolveGo(context.request.url);
  // Not one of ours: hand over to the static site, which answers with 404.html.
  if (!hit) return context.next();

  if (count && hit.src && !isPreviewBot(context.request.headers.get("user-agent"))) {
    bump(
      context,
      "INSERT INTO clicks (day, target, src, n) VALUES (?, ?, ?, 1) ON CONFLICT (day, target, src) DO UPDATE SET n = n + 1",
      [today(), hit.target, hit.src],
    );
  }
  return new Response(null, { status: 302, headers: { ...HEADERS, Location: hit.location } });
}

// GET counts the click. HEAD (link checkers) only gets the redirect.
export const onRequestGet = (context) => handle(context, true);
export const onRequestHead = (context) => handle(context, false);
