import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
const files = execSync("git ls-files src eslint.config.mjs next.config.ts", { encoding: "utf8" })
  .split("\n").filter((f) => /\.(tsx?|css|mjs)$/.test(f));
// Unambiguous "this text describes a previous state of the code".
const M = /\b(used to|use to be|previously|no longer|originally|there used to|had been|stopped being|was (?:deleted|removed|replaced|reverted|dropped|renamed|the third|two)|were (?:deleted|removed|replaced|dropped|two drifting|87%)|three attempts|first two|second attempt|third attempt|reverted|regressed|it used|which used|R2's|R3a|R4-|Wave \d|the old |old block|before this|before the fix|is gone|are gone|was gone|has gone|now carries|now says|now reads)\b/i;
const hits = [];
for (const f of files) {
  const lines = readFileSync(f, "utf8").split("\n");
  let inBlock = false;
  lines.forEach((line, i) => {
    let isC = inBlock;
    const o = (line.match(/\/\*/g) || []).length, c = (line.match(/\*\//g) || []).length;
    if (!inBlock && o > 0) isC = true;
    if (o > c) inBlock = true; else if (c > 0) inBlock = false;
    if (/^\s*(\/\/|\*)/.test(line)) isC = true;
    if (isC && M.test(line)) hits.push([f, i + 1, line.trim().slice(0, 130)]);
  });
}
const byFile = {};
for (const [f, ln, t] of hits) (byFile[f] ||= []).push(`${ln}: ${t}`);
const sorted = Object.entries(byFile).sort((a, b) => b[1].length - a[1].length);
for (const [f, hs] of sorted) console.log(`${String(hs.length).padStart(3)}  ${f}`);
console.log(`\nTOTAL ${hits.length} lines in ${sorted.length} files`);
