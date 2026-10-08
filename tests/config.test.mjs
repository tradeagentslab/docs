// site.config.json is the one place that holds the project's name, addresses and links.
// These tests keep it that way, so a rename means editing that file (plus two lines in
// wrangler.toml, which can't read JSON).

import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { test } from "node:test";
import { ROOT } from "../build.mjs";
import config from "../site.config.json" with { type: "json" };

const FIELDS = [
  "brand", "domain", "site", "email", "githubOrg", "github", "discord",
  "npm", "cli", "mcp", "campaign", "pagesProject", "d1Database",
];

// Files allowed to contain the name: the config itself, the npm lock file, and wrangler.toml
// (checked against the config below).
const ALLOWED = new Set(["site.config.json", "package-lock.json", "wrangler.toml"]);
const SKIP_DIRS = new Set(["node_modules", "dist", ".git", ".wrangler"]);

// Strings that would give the name away, worked out from the config itself so the check keeps
// working after a rename: the brand with and without spaces, coined CamelCase words in it
// (like "FooBar" in "FooBar Lab"), the domain without its ending, the GitHub org, the npm scope
// and the Pages project.
function nameTokens(c) {
  const coined = c.brand.split(/\s+/).filter((word) => /^[A-Z][a-z0-9]+[A-Z]/.test(word));
  const tokens = [
    c.brand,
    c.brand.replace(/\s+/g, ""),
    ...coined,
    c.domain.split(".")[0],
    c.githubOrg,
    c.npm.replace(/^@/, "").split("/")[0],
    c.pagesProject,
  ];
  return [...new Set(tokens.map((t) => t.toLowerCase()))].filter((t) => t.length >= 4);
}

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) yield* walk(path);
    } else if (entry.isFile()) {
      yield path;
    }
  }
}

// Reads `key = "value"` from wrangler.toml.
function tomlValue(toml, key) {
  return new RegExp(`^\\s*${key}\\s*=\\s*"([^"]*)"`, "m").exec(toml)?.[1];
}

test("site.config.json has every field, and the fields agree with each other", () => {
  for (const key of FIELDS) assert.ok(typeof config[key] === "string" && config[key].length > 0, key);
  assert.equal(config.site, `https://${config.domain}`);
  assert.ok(config.github.startsWith(`https://github.com/${config.githubOrg}/`));
  assert.match(config.email, /^[^@\s]+@[^@\s]+\.[^@\s]+$/);
  // Goes into URLs and into the Telegram start parameter (A-Z a-z 0-9 _ - only).
  assert.match(config.campaign, /^[a-z0-9_-]{1,20}$/);
});

test("wrangler.toml repeats the Pages project and D1 names from site.config.json", async () => {
  const toml = await readFile(join(ROOT, "wrangler.toml"), "utf8");
  assert.equal(tomlValue(toml, "name"), config.pagesProject);
  assert.equal(tomlValue(toml, "database_name"), config.d1Database);
});

test("the name appears nowhere outside site.config.json (and the lock file and wrangler.toml)", async () => {
  const tokens = nameTokens(config);
  assert.ok(tokens.length > 0);
  const configText = (await readFile(join(ROOT, "site.config.json"), "utf8")).toLowerCase();
  for (const token of tokens) assert.ok(configText.includes(token), `token "${token}" should come from the config`);

  const found = [];
  for await (const path of walk(ROOT)) {
    const rel = relative(ROOT, path);
    if (ALLOWED.has(rel)) continue;
    const text = (await readFile(path, "utf8")).toLowerCase();
    for (const token of tokens) if (text.includes(token)) found.push(`${rel}: "${token}"`);
  }
  assert.deepEqual(found, [], "move these into site.config.json and use {{placeholders}}");
});
