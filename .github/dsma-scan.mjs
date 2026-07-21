// Weekly DSMA scan — runs in GitHub Actions (see .github/workflows/dsma-scan.yml).
//
// Pulls upcoming Downtown San Mateo events from The Events Calendar REST API,
// collects the business names (venues + organizers), diffs them against the
// deployed guide (the repo's built *.html files), and opens a GitHub Issue listing
// anything that is not already in the guide.
//
// It NEVER edits the site. It only reports. Jason (with Claude Code) verifies and
// adds the good ones — the curation gate stays human.

import { readFileSync, readdirSync } from 'node:fs';

const API = 'https://dsma.org/wp-json/tribe/events/v1/events?per_page=50&status=publish';

function decodeEntities(s) {
  return String(s || '')
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&apos;/g, "'").replace(/&nbsp;/g, ' ');
}

function normalize(s) {
  return decodeEntities(s)
    .toLowerCase()
    .replace(/&|\band\b/g, ' ')                 // "Y Salon & Spa" == "Y Salon Spa"
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(the|at|a|an|of|in|san|mateo|downtown|llc|inc)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Public spaces that are not independent businesses to list (normalized keys).
const IGNORE = new Set([
  'central park', 'fitzgerald field', 'b street', 'san mateo county event center',
  'san mateo city hall', 'city hall', 'draper university', 'san mateo public library',
  'central park music series',
].map(normalize));

// Event organizers / associations / member clubs — not businesses to list.
const ORGISH = /\b(association|chamber of commerce|society|league|coalition|foundation|council|reading room|office of arts|activities league|social club|arboretum)\b/i;
// Street-closure "venues" like "B Street between 1st and 2nd avenues".
const STREET = /\bbetween\b.*\b(ave|avenue|st|street|blvd)/i;

async function fetchEvents() {
  const out = [];
  let url = API;
  for (let page = 0; page < 6 && url; page++) {
    let res;
    try {
      res = await fetch(url, { headers: { 'User-Agent': 'san-mateo-local-scan' } });
    } catch (e) { break; }
    if (!res.ok) break;
    const data = await res.json();
    if (Array.isArray(data.events)) out.push(...data.events);
    url = data.next_rest_url || null;
  }
  return out;
}

function collectNames(events) {
  const names = new Map(); // normalized -> display
  const remember = (raw) => {
    const disp = decodeEntities(String(raw || '')).trim();
    if (!disp || ORGISH.test(disp) || STREET.test(disp)) return;
    const norm = normalize(disp);
    if (norm && norm.length > 2 && !IGNORE.has(norm) && !names.has(norm)) names.set(norm, disp);
  };
  for (const ev of events) {
    if (ev.venue && ev.venue.venue) remember(ev.venue.venue);
    const orgs = Array.isArray(ev.organizer) ? ev.organizer : (ev.organizer ? [ev.organizer] : []);
    for (const o of orgs) if (o && o.organizer) remember(o.organizer);
  }
  return names;
}

function guideText() {
  let text = '';
  for (const f of readdirSync('.').filter((f) => f.endsWith('.html'))) {
    try { text += ' ' + readFileSync(f, 'utf8'); } catch (e) { /* skip */ }
  }
  return normalize(text);
}

const events = await fetchEvents();
if (!events.length) {
  console.log('DSMA API returned no events; skipping (no false alarms).');
  process.exit(0);
}

const names = collectNames(events);
const guide = guideText();
const guideNoSpace = guide.replace(/ /g, '');

const newSpots = [];
for (const [norm, disp] of names) {
  if (guide.includes(norm)) continue;                          // already listed
  if (guideNoSpace.includes(norm.replace(/ /g, ''))) continue; // spacing variant (Porter House == Porterhouse)
  newSpots.push(disp);
}
newSpots.sort((a, b) => a.localeCompare(b));

if (!newSpots.length) {
  console.log('DSMA scan: nothing new this week. Guide is current.');
  process.exit(0);
}

const today = new Date().toISOString().slice(0, 10);
const body = [
  `The weekly DSMA scan found **${newSpots.length}** name(s) tied to Downtown San Mateo events that are not in the guide yet:`,
  '',
  ...newSpots.map((n) => `- ${n}`),
  '',
  '_Raw matches from DSMA event venues and organizers. Some may be chains, event spaces, or already listed under a slightly different name._',
  '',
  '**Next step:** open Claude Code and say *"run through the new DSMA finds."* It verifies each one (real? independent? in the coverage area?) and adds the good ones with your OK. Nothing is added to the site automatically.',
].join('\n');

console.log(body);

const token = process.env.GITHUB_TOKEN;
const repo = process.env.GITHUB_REPOSITORY;
if (token && repo) {
  const res = await fetch(`https://api.github.com/repos/${repo}/issues`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'User-Agent': 'dsma-scan',
    },
    body: JSON.stringify({
      title: `DSMA weekly scan — ${newSpots.length} new spot(s) to review (${today})`,
      body,
      labels: ['dsma-scan'],
    }),
  });
  console.log(res.ok ? 'GitHub issue created.' : `Issue creation failed: ${res.status} ${await res.text()}`);
} else {
  console.log('\n(Local run — no GITHUB_TOKEN, so no issue was created.)');
}
