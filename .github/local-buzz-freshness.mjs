// Weekly Local Buzz freshness check — runs in GitHub Actions
// (see .github/workflows/local-buzz-freshness.yml).
//
// Reads the deployed Local Buzz page (local-buzz.html) for the freshness marker
// build-buzz.mjs emits: <!-- BUZZ-FRESH: added=YYYY-MM-DD events=N -->
//   added  = newest "added" date among the live (non-expired) buzz items
//   events = count of live Event-type items
// If nothing fresh has been added in STALE_DAYS, OR there are zero live events, it
// opens a GitHub Issue so Local Buzz gets refreshed. It NEVER edits the site.
//
// Mirrors this-weekend-freshness.mjs. Why this is needed: build-buzz auto-drops expired
// items, so a neglected Local Buzz quietly empties out instead of showing stale content —
// this surfaces that before it happens. (Local Buzz had drifted, found + reconciled 2026-09-19.)
//
// Test locally against any file:  node .github/local-buzz-freshness.mjs path/to/local-buzz.html

import { readFileSync } from 'node:fs';

const STALE_DAYS = 12;   // Buzz carries evergreen items too, so a touch more lenient than This Weekend's 7
const file = process.argv[2] || 'local-buzz.html';

function readMarker(path) {
  let html;
  try { html = readFileSync(path, 'utf8'); } catch { return null; }
  const m = html.match(/<!--\s*BUZZ-FRESH:\s*added=(\S+)\s+events=(\d+)\s*-->/);
  if (!m) return null;
  return { added: m[1], events: parseInt(m[2], 10) };
}

const marker = readMarker(file);
if (!marker) {
  console.log(`No BUZZ-FRESH marker found in ${file}; skipping (no false alarm).`);
  process.exit(0);
}

const now = new Date();
let ageDays = null;
if (marker.added && marker.added !== 'none') {
  ageDays = Math.floor((now.getTime() - Date.parse(marker.added + 'T00:00:00Z')) / 86400000);
}

const staleByAge = ageDays !== null && ageDays >= STALE_DAYS;
const noEvents = marker.events === 0;

if (!staleByAge && !noEvents) {
  console.log(`Local Buzz is current (newest add ${marker.added}, ${ageDays} day(s) old, ${marker.events} live event(s)). Nothing to do.`);
  process.exit(0);
}

const reasonBits = [];
if (noEvents) reasonBits.push('there are **no live events** showing');
if (staleByAge) reasonBits.push(`nothing new has been added in **${ageDays} days**`);
const reason = reasonBits.join(' and ');

const title = noEvents
  ? '🚨 Local Buzz has no live events — add this week\'s happenings'
  : `🚨 Local Buzz is going stale — nothing added in ${ageDays} days`;
const body = [
  '## 🚨 LOCAL BUZZ NEEDS A REFRESH',
  '',
  `**Newest item added:** ${marker.added}${ageDays !== null ? ` (${ageDays} days ago)` : ''}`,
  `**Live events showing:** ${marker.events}`,
  '',
  `Local Buzz looks thin: ${reason}. Because expired items auto-drop, a neglected Buzz page quietly empties out.`,
  '',
  '**Next step:** open Claude Code and say *"refresh Local Buzz"*. Pull this week\'s events (City of San Mateo eNews + DTSM email + DSMA feed), add them to `data/buzz.json` with an `until` date, run `build-buzz.mjs`, and deploy. Marquee/civic one-offs belong here.',
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
const openRes = await fetch(`https://api.github.com/repos/${repo}/issues?state=open&labels=local-buzz-freshness`, {
  headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'buzz-freshness' },
});
if (openRes.ok) {
  const open = await openRes.json();
  if (Array.isArray(open) && open.length) {
    console.log(`A local-buzz-freshness issue is already open (#${open[0].number}); not opening another.`);
    process.exit(0);
  }
}

const res = await fetch(`https://api.github.com/repos/${repo}/issues`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'Content-Type': 'application/json',
    'User-Agent': 'buzz-freshness',
  },
  body: JSON.stringify({ title, body, labels: ['local-buzz-freshness'] }),
});
console.log(res.ok ? 'GitHub issue created.' : `Issue creation failed: ${res.status} ${await res.text()}`);
