// Weekly Events freshness check — runs in GitHub Actions
// (see .github/workflows/events-freshness.yml).
//
// Two things went stale on the Events page before (2026-10-10):
//   1. past events lingering  -> fixed in the page itself: each card carries data-end and
//      hides itself in the browser once it has passed (build-events.mjs).
//   2. the list running thin   -> this job. Nothing adds NEW events automatically.
//
// Every Monday it reads the committed events.html, counts upcoming events, and pulls the
// DSMA downtown calendar to list upcoming events we don't have yet. It opens (or refreshes)
// ONE issue labeled events-freshness, which the Monday Ops Digest emails to Jason.
// It NEVER edits the site. Publish only what Jason/Code verify.
//
// Test locally:  node .github/events-freshness.mjs [path/to/events.html]

import { readFileSync } from 'node:fs';

const MIN_NEXT_14 = 6;         // fewer upcoming events than this in the next two weeks = thin
const DSMA_DAYS = 21;          // how far ahead to look on DSMA's calendar
const DSMA_API = 'https://dsma.org/wp-json/tribe/events/v1/events?per_page=50&status=publish';
const RECURRING = /karaoke|trivia|bingo|happy hour|special|discount|open mic|weekly/i;

const file = process.argv[2] || 'events.html';
let html = '';
try { html = readFileSync(file, 'utf8'); } catch { console.log(`Can't read ${file}; skipping.`); process.exit(0); }

const decode = s => s.replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16))).replace(/&amp;/g, '&').replace(/&#0?39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&#8217;|&#x2019;/g, '’').replace(/&#8211;/g, '–').replace(/<[^>]+>/g, '').trim();
const norm = s => decode(s).toLowerCase().replace(/[’']/g, "'").replace(/\(.*?\)/g, '').replace(/[^a-z0-9' ]+/g, ' ').replace(/\s+/g, ' ').trim();

// Pacific "today" (the runner is UTC).
const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
const plusDays = n => { const d = new Date(today + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const in14 = plusDays(14), inDsma = plusDays(DSMA_DAYS);

// Our events: each card is <a|article class="ev" data-end="YYYY-MM-DD" ...> ... <h3>Name</h3>
const ours = [...html.matchAll(/class="ev" data-end="(\d{4}-\d{2}-\d{2})"[\s\S]*?<h3>([\s\S]*?)<\/h3>/g)]
  .map(m => ({ end: m[1], name: decode(m[2]) }));
const upcoming = ours.filter(e => e.end >= today);
const next14 = upcoming.filter(e => e.end <= in14);
const ourNames = ours.map(e => norm(e.name));
const haveIt = title => {
  const t = norm(title);
  // Same event if one name contains the other, or our name holds the first three
  // meaningful words of theirs ("Boos and Brews on B Street & Trick or Treating" = "BOOs & Brews on B Street").
  const key = t.split(' ').filter(w => w.length > 3 && !['with', 'from', 'your'].includes(w)).slice(0, 3);
  return ourNames.some(n => n.includes(t) || t.includes(n) || (key.length >= 2 && key.every(w => n.split(' ').includes(w))));
};

// DSMA's upcoming events we don't list yet.
let missing = [], recurring = new Set(), dsmaOk = true;
try {
  const r = await fetch(DSMA_API, { headers: { 'User-Agent': 'Mozilla/5.0 (SanMateoLocal events check)' } });
  const data = r.ok ? await r.json() : (dsmaOk = false, { events: [] });
  const seen = new Set();
  for (const ev of data.events || []) {
    const day = String(ev.start_date || '').slice(0, 10);   // DSMA wall-clock date; no timezone math
    if (!day || day < today || day > inDsma) continue;
    const title = decode(ev.title || '');
    const k = norm(title);
    if (!title || seen.has(k)) continue;
    seen.add(k);
    if (RECURRING.test(title)) { recurring.add(title); continue; }
    if (!haveIt(title)) missing.push({ day, title, url: ev.url || '' });
  }
} catch { dsmaOk = false; }
missing.sort((a, b) => a.day.localeCompare(b.day));

const thin = next14.length < MIN_NEXT_14;
console.log(`Upcoming on the page: ${upcoming.length} (next 14 days: ${next14.length}). DSMA not on page: ${missing.length}. Recurring skipped: ${recurring.size}.`);
if (!thin && !missing.length) { console.log('Events page is healthy. Nothing to do.'); process.exit(0); }

const fmt = d => new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
const title = thin
  ? `📅 Events page is thin: ${next14.length} event(s) in the next two weeks`
  : `📅 ${missing.length} downtown event(s) not on the Events page yet`;
const body = [
  `**Checked:** ${today} · **Upcoming on the page:** ${upcoming.length} · **In the next 14 days:** ${next14.length}${thin ? ` (below ${MIN_NEXT_14})` : ''}`,
  '',
  missing.length ? '**On the DSMA calendar, not on our Events page** (verify each before adding):' : '',
  ...missing.slice(0, 15).map(e => `- ${fmt(e.day)}: [${e.title}](${e.url})`),
  missing.length > 15 ? `- ...and ${missing.length - 15} more` : '',
  recurring.size ? `\n_Recurring bar nights/specials skipped (${recurring.size}), e.g. ${[...recurring].slice(0, 3).join('; ')}._` : '',
  dsmaOk ? '' : '\n⚠️ The DSMA calendar could not be read this run, so the missing list may be incomplete.',
  '',
  '**Other sources worth a look:** the City eNews (Thursdays) and the San Mateo Public Library emails in Gmail.',
  '',
  '**Next step:** open Claude Code and say *"update events"*. Code verifies each event at its source, adds the real ones to data/events.json, rebuilds, and deploys. Past events already hide themselves on the live page.',
].filter(x => x !== '').join('\n');

console.log('\n' + title + '\n' + body);

const token = process.env.GITHUB_TOKEN, repo = process.env.GITHUB_REPOSITORY;
if (!token || !repo) { console.log('\n(Local run: no GITHUB_TOKEN, so no issue was created.)'); process.exit(0); }
const H = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json', 'User-Agent': 'events-freshness' };

// One issue at a time: refresh the open one instead of stacking a new one each Monday.
const open = await (await fetch(`https://api.github.com/repos/${repo}/issues?state=open&labels=events-freshness`, { headers: H })).json().catch(() => []);
if (Array.isArray(open) && open.length) {
  const r = await fetch(`https://api.github.com/repos/${repo}/issues/${open[0].number}`, { method: 'PATCH', headers: H, body: JSON.stringify({ title, body }) });
  console.log(r.ok ? `Refreshed issue #${open[0].number}.` : `Issue refresh failed: ${r.status}`);
} else {
  const r = await fetch(`https://api.github.com/repos/${repo}/issues`, { method: 'POST', headers: H, body: JSON.stringify({ title, body, labels: ['events-freshness'] }) });
  console.log(r.ok ? 'GitHub issue created.' : `Issue creation failed: ${r.status} ${await r.text()}`);
}
