-- The tables in D1. Counters keep only "what, when, how many"; talk_replies keeps only the
-- answers someone typed into the interview form. No IP, no user agent, no name, no cookie.
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
  kind TEXT    NOT NULL,             -- cn (whole site, from 2026-10-09); earlier: cn-account, cn-go, gb-en
  n    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, kind)
);

-- Replies to the interview form (/<lang>/talk/, functions/talk/send.js). Read only from the
-- private bot repo's manual workflow, never printed in this public repo's logs.
CREATE TABLE IF NOT EXISTS talk_replies (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  day     TEXT    NOT NULL,          -- UTC date; at most 200 rows a day
  lang    TEXT    NOT NULL,          -- zh-hans or en
  answers TEXT    NOT NULL           -- JSON array of 8 strings (empty string = skipped)
);
