// Weekly "This Weekend" freshness check — runs in GitHub Actions
// (see .github/workflows/this-weekend-freshness.yml).
//
// Reads the deployed homepage (index.html) for the This Weekend post's date
// (the data-tw-date attribute on .latest-lead, emitted by build-blog.mjs). If that
// date is STALE_DAYS or more old, it opens a GitHub Issue so the homepage lead gets
// refreshed. It NEVER edits the site — it only reports.
//
// This is the "reminder" layer. The "self-healing" layer is the browser-side guard in
// index.html, which hides the lead on load once it passes STALE_DAYS. Same threshold,
// same single source of truth (data-tw-date), so the two layers never disagree.
//
// Test locally against any file:  node .github/this-weekend-freshness.mjs path/to/index.html

import { readFileSync } from 'node:fs';

const STALE_DAYS = 7;
const file = process.argv[2] || 'index.html';

function readTwDate(path) {
  let html;
  try { html = readFileSync(path, 'utf8'); } catch { return null; }
  const m = html.match(/data-tw-date="(\d{4}-\d{2}-\d{2})"/);
  return m ? m[1] : null;
}

const twDate = readTwDate(file);
if (!twDate) {
  console.log(`No data-tw-date found in ${file}; skipping (no false alarm).`);
  process.exit(0);
}

const now = new Date();
const t = Date.parse(twDate + 'T00:00:00Z');
const ageDays = Math.floor((now.getTime() - t) / 86400000);

if (ageDays < STALE_DAYS) {
  console.log(`This Weekend is current (${twDate}, ${ageDays} day(s) old). Nothing to do.`);
  process.exit(0);
}

// Upcoming weekend (next Saturday + Sunday), for the alert.
function nextSaturday(d) {
  const x = new Date(d);
  const add = (6 - x.getUTCDay() + 7) % 7 || 7; // days until the next Saturday (at least 1)
  x.setUTCDate(x.getUTCDate() + add);
  return x;
}
const sat = nextSaturday(now);
const sun = new Date(sat); sun.setUTCDate(sat.getUTCDate() + 1);
const fmt = (d) => d.toISOString().slice(0, 10);

const title = `🚨 This Weekend needs updating — homepage lead is ${ageDays} days old`;
const body = [
  '## 🚨 THIS WEEKEND NEEDS UPDATE',
  '',
  `**Current post date:** ${twDate} (${ageDays} days old)`,
  `**Upcoming weekend:** ${fmt(sat)} to ${fmt(sun)}`,
  '',
  `The homepage "This Weekend" lead has not been refreshed in ${STALE_DAYS}+ days. The browser guard auto-hides it once it passes ${STALE_DAYS} days, so visitors never see stale info — but the homepage should have a current lead instead of an empty spot.`,
  '',
  '**Next step:** open Claude Code and say *"run the San Mateo refresh"* (or *"update This Weekend"*). Pull this week\'s events (DSMA feed + farmers markets + any active music series), update the this-weekend post, rebuild, and deploy.',
].join('\n');

console.log(title);
console.log(body);

const token = process.env.GITHUB_TOKEN;
const repo = process.env.GITHUB_REPOSITORY;
if (!token || !repo) {
  console.log('\n(Local run — no GITHUB_TOKEN, so no issue was created.)');
  process.exit(0);
}

// Dedup: don't stack a second freshness alert if one is already open.
const openRes = await fetch(`https://api.github.com/repos/${repo}/issues?state=open&labels=this-weekend-freshness`, {
  headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'tw-freshness' },
});
if (openRes.ok) {
  const open = await openRes.json();
  if (Array.isArray(open) && open.length) {
    console.log(`A this-weekend-freshness issue is already open (#${open[0].number}); not opening another.`);
    process.exit(0);
  }
}

const res = await fetch(`https://api.github.com/repos/${repo}/issues`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'Content-Type': 'application/json',
    'User-Agent': 'tw-freshness',
  },
  body: JSON.stringify({ title, body, labels: ['this-weekend-freshness'] }),
});
console.log(res.ok ? 'GitHub issue created.' : `Issue creation failed: ${res.status} ${await res.text()}`);
