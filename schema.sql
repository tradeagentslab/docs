-- The two counter tables in D1. Only "what, when, how many": no IP, no user agent, nothing personal.
-- Apply once (database name: "d1Database" in site.config.json):
--   npx wrangler@4 d1 execute <database> --remote --file=schema.sql

-- Clicks on /go/ links.
CREATE TABLE IF NOT EXISTS clicks (
  day    TEXT    NOT NULL,           -- UTC date, e.g. 2026-10-14
  target TEXT    NOT NULL,           -- where to: signup/binance/en, help-bot/zhs, tool/tradingview ...
  src    TEXT    NOT NULL,           -- the link's "from" value
  n      INTEGER NOT NULL DEFAULT 0, -- how many clicks
  PRIMARY KEY (day, target, src)
);

-- Requests answered with 451 by the regional gate.
CREATE TABLE IF NOT EXISTS blocked (
  day  TEXT    NOT NULL,             -- UTC date
  kind TEXT    NOT NULL,             -- gb-en, cn-account, cn-go
  n    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, kind)
);
