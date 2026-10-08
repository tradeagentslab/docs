// Small helpers used by _middleware.js and go/. This file exports no onRequest handler,
// so Cloudflare Pages does not turn it into a page of its own.

// Today's date in UTC, e.g. "2026-10-14".
export function today() {
  return new Date().toISOString().slice(0, 10);
}

// Adds 1 to a counter row in D1 (the SQL does the "insert or add 1").
// No DB binding (local runs, preview deployments): nothing is counted.
// A failed write is logged and dropped. The visitor never waits for it and never sees it fail.
export function bump(context, sql, values) {
  const db = context.env && context.env.DB;
  if (!db) return;
  const job = (async () => {
    await db.prepare(sql).bind(...values).run();
  })().catch((err) => {
    console.error("counter write failed:", err && err.message);
  });
  if (typeof context.waitUntil === "function") context.waitUntil(job);
}

// Headers for the responses these functions make themselves.
// (dist/_headers only covers static files; it does not reach function responses.)
export const HEADERS = {
  "Cache-Control": "no-store",
  "Content-Security-Policy": "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
};
