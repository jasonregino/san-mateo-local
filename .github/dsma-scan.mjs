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

// ---- "Welcome to the neighborhood" lines from DSMA's monthly newsletters ----
// The newsletters are ordinary WordPress posts, and each one names the businesses
// that opened downtown that month. This is the best new-openings source we have
// (it replaced an unattended Cowork scan that could not reach Yelp or Maps).
// Only recent newsletters are read, so a month's openings are reported for a few
// weeks and then stop, instead of resurfacing every Monday forever.
const WELCOME_DAYS = 60;
// The welcome line is followed directly by the next section heading.
const NEXT_SECTION = /\s(City of San Mateo|Boos and Brews|HEAD WEST|Dine & Discover|Save the Date|DSMA Updates)\b/;

async function fetchWelcomes() {
  const after = new Date(Date.now() - WELCOME_DAYS * 864e5).toISOString().slice(0, 19);
  let posts = [];
  try {
    const res = await fetch(`https://dsma.org/wp-json/wp/v2/posts?per_page=10&after=${after}&_fields=date,title,link,content`,
      { headers: { 'User-Agent': 'san-mateo-local-scan' } });
    if (res.ok) posts = await res.json();
  } catch (e) { /* network hiccup: report nothing rather than guess */ }
  const found = new Map(); // normalized -> { name, month, link }
  for (const p of Array.isArray(posts) ? posts : []) {
    const text = decodeEntities(String(p.content?.rendered || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ');
    const m = text.match(/welcome to the neighbou?rhood:\s*(.{0,300})/i);
    if (!m) continue;
    let seg = m[1];
    const cut = seg.search(NEXT_SECTION);
    if (cut >= 0) seg = seg.slice(0, cut);
    // Names that contain commas ("Derek Wong, DDS") are separated with semicolons.
    const parts = (seg.includes(';') ? seg.split(';') : seg.split(',')).map((x) => x.replace(/\s+/g, ' ').trim()).filter(Boolean);
    for (const name of parts) {
      if (name.split(' ').length > 7) continue; // ran into body text: skip rather than report junk
      const norm = normalize(name);
      if (norm.length > 2 && !found.has(norm)) found.set(norm, { name, month: decodeEntities(p.title?.rendered || ''), link: p.link });
    }
  }
  return found;
}

function skipList() {
  try { return new Set(JSON.parse(readFileSync('.github/scan-skip.json', 'utf8')).skip.map((x) => normalize(x.name))); }
  catch (e) { return new Set(); }
}

const events = await fetchEvents();
if (!events.length) console.log('DSMA events API returned no events; checking newsletters only.');

const names = collectNames(events);
const guide = guideText();
const guideNoSpace = guide.replace(/ /g, '');

// Whole-word match, so a short name can't hide inside a longer word. The squashed
// "no spaces" comparison (Porter House == Porterhouse) only runs for multi-word
// names: with spaces stripped, a short name like "DoHo" turns up by accident
// ("do home") and the business silently drops out of the report.
const guidePadded = ' ' + guide + ' ';
const inGuide = (norm) => guidePadded.includes(' ' + norm + ' ') ||
  (norm.includes(' ') && norm.replace(/ /g, '').length >= 8 && guideNoSpace.includes(norm.replace(/ /g, '')));

const newSpots = [];
const skipEarly = skipList();
for (const [norm, disp] of names) {
  if (inGuide(norm) || skipEarly.has(norm)) continue;
  newSpots.push(disp);
}
newSpots.sort((a, b) => a.localeCompare(b));

const skip = skipList();
const welcomes = [];
for (const [norm, w] of await fetchWelcomes()) {
  if (skip.has(norm)) continue;
  if (inGuide(norm)) continue;
  welcomes.push(w);
}

if (!newSpots.length && !welcomes.length) {
  console.log('DSMA scan: nothing new this week. Guide is current.');
  process.exit(0);
}

const today = new Date().toISOString().slice(0, 10);
const body = [
  ...(welcomes.length ? [
    `### New openings: ${welcomes.length} business(es) DSMA welcomed that are not in the guide`,
    '',
    ...welcomes.map((w) => `- **${w.name}** (${w.month}, [newsletter](${w.link}))`),
    '',
    '_From the "Welcome to the neighborhood" line in DSMA newsletters from the last 60 days. Chains we have already declined are skipped (see `.github/scan-skip.json`)._',
    '',
  ] : []),
  ...(newSpots.length ? [
    `### Event venues and organizers: ${newSpots.length} name(s) not in the guide yet`,
    '',
    ...newSpots.map((n) => `- ${n}`),
    '',
    '_Raw matches from DSMA event venues and organizers. Some may be chains, event spaces, or already listed under a slightly different name._',
    '',
  ] : []),
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
      title: `DSMA weekly scan — ${welcomes.length + newSpots.length} to review (${welcomes.length} new opening(s)) (${today})`,
      body,
      labels: ['dsma-scan'],
    }),
  });
  console.log(res.ok ? 'GitHub issue created.' : `Issue creation failed: ${res.status} ${await res.text()}`);
} else {
  console.log('\n(Local run — no GITHUB_TOKEN, so no issue was created.)');
}
