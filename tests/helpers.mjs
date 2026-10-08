// Test helpers: a stand-in for Cloudflare D1, and a way to play a request through the
// Pages Functions the way Cloudflare does. Nothing here touches the network.

import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import * as middleware from "../functions/_middleware.js";
import * as go from "../functions/go/[[path]].js";
import config from "../site.config.json" with { type: "json" };

export { today } from "../functions/_shared.js";

// D1 stand-in: an in-memory SQLite database built from the real schema.sql,
// so the SQL in the functions runs for real.
export function fakeD1() {
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync(new URL("../schema.sql", import.meta.url), "utf8"));
  return {
    prepare: (sql) => ({
      bind: (...values) => ({
        run: async () => {
          db.prepare(sql).run(...values);
          return { success: true };
        },
      }),
    }),
    // For the tests: read rows back as plain objects.
    rows: (sql) => db.prepare(sql).all().map((row) => ({ ...row })),
  };
}

// A D1 that always fails.
export function brokenD1() {
  return {
    prepare() {
      throw new Error("D1 is down");
    },
  };
}

// The static files behind the functions. Nothing lives under /go/, so Cloudflare would
// answer those with the 404 page; anything else stands for a page that exists.
function staticSite(request) {
  const { pathname } = new URL(request.url);
  if (pathname.startsWith("/go/")) return new Response("404 page", { status: 404 });
  return new Response(`static ${pathname}`, { status: 200 });
}

// Sends one request through the site like Cloudflare Pages: _middleware.js first, then
// go/[[path]].js for /go/ addresses, then the static files. "country" becomes
// request.cf.country. Waits for counter writes before returning the response.
export async function visit(path, { country, env = {}, method = "GET", userAgent } = {}) {
  const request = new Request(config.site + path, { method, headers: userAgent ? { "user-agent": userAgent } : {} });
  Object.defineProperty(request, "cf", { value: country ? { country } : {} });

  const pending = [];
  const context = (next) => ({ request, env, params: {}, data: {}, next, waitUntil: (p) => pending.push(p) });
  const goHandler = method === "HEAD" ? go.onRequestHead : go.onRequestGet;
  const afterMiddleware = async () =>
    new URL(request.url).pathname.startsWith("/go/")
      ? goHandler(context(async () => staticSite(request)))
      : staticSite(request);

  const response = await middleware.onRequest(context(afterMiddleware));
  await Promise.all(pending);
  return response;
}
