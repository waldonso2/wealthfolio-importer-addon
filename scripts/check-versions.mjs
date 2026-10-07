// Version line check (see CLAUDE.md "Releasing"): the addon's version follows
// Wealthfolio. Its major.minor is the Wealthfolio/SDK line it is built for, and
// manifest sdkVersion, minWealthfolioVersion and every @wealthfolio/*
// dependency must sit on that same line. Run in CI and before every release.
import { readFileSync } from "node:fs";

const manifest = JSON.parse(readFileSync(new URL("../manifest.json", import.meta.url), "utf-8"));
const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf-8"));

const line = (v) => /^\^?(\d+)\.(\d+)\.\d+/.exec(v ?? "")?.slice(1, 3).join(".") ?? `unparseable "${v}"`;
const expected = line(manifest.version);
const errors = [];
const check = (what, value, exact) => {
  if (exact !== undefined ? value !== exact : line(value) !== expected) {
    errors.push(`${what} is ${JSON.stringify(value)}, expected ${exact ?? `${expected}.x`}`);
  }
};

check("package.json version", pkg.version, manifest.version);
check("manifest sdkVersion", manifest.sdkVersion, `${expected}.0`);
check("manifest minWealthfolioVersion", manifest.minWealthfolioVersion, `${expected}.0`);
for (const [name, range] of Object.entries(manifest.hostDependencies ?? {})) {
  if (name.startsWith("@wealthfolio/")) check(`manifest hostDependencies ${name}`, range, `^${expected}.0`);
}
for (const field of ["dependencies", "devDependencies", "peerDependencies"]) {
  for (const [name, range] of Object.entries(pkg[field] ?? {})) {
    if (name.startsWith("@wealthfolio/")) check(`package.json ${field} ${name}`, range, `^${expected}.0`);
  }
}

if (errors.length) {
  console.error(`Version line ${expected} (from manifest.json version ${manifest.version}) is out of sync:`);
  for (const e of errors) console.error(`  - ${e}`);
  console.error("A new Wealthfolio line means: bump the SDK family, sdkVersion, minWealthfolioVersion and the version to <line>.0 together.");
  process.exit(1);
}
console.log(`Version ${manifest.version} is on Wealthfolio line ${expected}.`);
