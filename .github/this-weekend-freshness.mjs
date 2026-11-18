// "This Weekend" freshness check — runs in GitHub Actions on Monday and Wednesday
// (see .github/workflows/this-weekend-freshness.yml).
//
// Reads the homepage (index.html) for the This Weekend post's date (the data-tw-date
// attribute on .latest-lead, emitted by build-blog.mjs). A This Weekend post covers the
// first weekend on or after its date, and goes stale the moment that Sunday ends. If the
// post's weekend is already over (Pacific time), it opens a GitHub Issue so a new one gets
// written for the upcoming weekend. It NEVER edits the site — it only reports.
//
// This is the "reminder" layer. The "self-healing" layer is the browser-side guard in
// index.html (and ig.html), which hides the lead from the Monday after its weekend. Same
// rule, same single source of truth (data-tw-date), so the layers never disagree.
//
// Test locally against any file:  node .github/this-weekend-freshness.mjs path/to/index.html

import { readFileSync } from 'node:fs';

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

// All dates are plain YYYY-MM-DD calendar days, handled as UTC midnights so no clock drift.
const fmt = (d) => d.toISOString().slice(0, 10);
const day = (ymd) => new Date(ymd + 'T00:00:00Z');
const sundayOnOrAfter = (d) => { const x = new Date(d); x.setUTCDate(x.getUTCDate() + (7 - x.getUTCDay()) % 7); return x; };

const today = day(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date()));
const postSun = sundayOnOrAfter(day(twDate));
const ageDays = Math.round((today - day(twDate)) / 86400000);

if (today <= postSun) {
  console.log(`This Weekend is current (${twDate}, covers the weekend ending ${fmt(postSun)}). Nothing to do.`);
  process.exit(0);
}

// Upcoming weekend (Saturday + Sunday), for the alert.
const sun = sundayOnOrAfter(today);
const sat = new Date(sun); sat.setUTCDate(sun.getUTCDate() - 1);

const title = `🚨 This Weekend needs updating — the post covers a weekend that already ended (${fmt(postSun)})`;
const body = [
  '## 🚨 THIS WEEKEND NEEDS UPDATE',
  '',
  `**Current post date:** ${twDate} (${ageDays} days old, weekend ended ${fmt(postSun)})`,
  `**Upcoming weekend:** ${fmt(sat)} to ${fmt(sun)}`,
  '',
  'The homepage "This Weekend" post is about a weekend that is already over. The browser guard hides it from the Monday after its weekend, so visitors never see it as current, but the homepage should have a post for the upcoming weekend instead of an empty spot. Aim to publish by Thursday.',
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
