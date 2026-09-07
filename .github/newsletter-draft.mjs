// Weekly newsletter draft — runs in GitHub Actions (.github/workflows/newsletter-draft.yml).
//
// Every Thursday morning it assembles the week's San Mateo happenings — new posts on
// the site, Downtown San Mateo events, and city news + upcoming City Council meetings —
// creates that issue as a DRAFT in Buttondown, and emails Jason a preview of it.
//
// It NEVER sends to subscribers. Jason reads the Thursday preview and, if it's good,
// clicks Send in Buttondown himself. Do nothing = nothing goes out (the safe default).
//
// No mailbox credentials live here. City + DSMA items come from public feeds, and the
// single secret (BUTTONDOWN_API_KEY) does both jobs: it creates the draft AND sends the
// preview (Buttondown's send-draft endpoint delivers a copy to any address, subscriber
// or not). No Gmail, no Resend, no SMTP.
//
// Heartbeat: it runs and emails Jason every Thursday, even on a light week, so a broken
// job can't hide as a slow news week — if no preview arrives, something's wrong.
//
// Run locally with no key to see the assembled issue printed (a safe dry run):
//   node .github/newsletter-draft.mjs

import { readFileSync } from 'node:fs';

const SITE = 'https://sanmateolocal.com';
const PREVIEW_TO = 'regino.jason@gmail.com';   // where the Thursday preview lands
const BD_KEY = process.env.BUTTONDOWN_API_KEY || '';
const BD_API = 'https://api.buttondown.com/v1/emails';

const DSMA_API = 'https://dsma.org/wp-json/tribe/events/v1/events?per_page=50&status=publish';
const CITY_NEWS_RSS = 'https://www.cityofsanmateo.org/RSSFeed.aspx?ModID=1&CID=Latest-News-Announcements-1';
const CITY_COUNCIL_RSS = 'https://www.cityofsanmateo.org/RSSFeed.aspx?ModID=58&CID=City-Council-Meetings-14';

const DAYS_NEW = 7;      // a post counts as "new" if its lastmod is within this window
const DAYS_AHEAD = 16;   // events within this window count as "upcoming"
const UA = { 'User-Agent': 'san-mateo-local-newsletter' };

function decodeEntities(s) {
  return String(s || '')
    .replace(/<!\[CDATA\[|\]\]>/g, '')
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&apos;/g, "'").replace(/&nbsp;/g, ' ')
    .trim();
}

function fmtDay(ms) {
  return new Date(ms).toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', timeZone: 'America/Los_Angeles',
  });
}

// --- Recent site posts, from the committed sitemap + committed post HTML ------------
function pageMeta(slug) {
  let html = '';
  try { html = readFileSync(slug, 'utf8'); } catch { return { title: slug, dek: '' }; }
  const t = html.match(/<title>([^<]*)<\/title>/i);
  const d = html.match(/<meta\s+name=["']description["']\s+content=["']([^"']*)["']/i)
        || html.match(/<meta\s+property=["']og:description["']\s+content=["']([^"']*)["']/i);
  let title = t ? decodeEntities(t[1]) : slug;
  title = title.replace(/\s*[|·–—-]\s*San Mateo Local.*$/i, '').trim();  // drop the site suffix
  return { title, dek: d ? decodeEntities(d[1]) : '' };
}

function recentPosts() {
  let xml;
  try { xml = readFileSync('sitemap.xml', 'utf8'); } catch { return []; }
  const blog = (xml.split('<!-- BLOG:START -->')[1] || '').split('<!-- BLOG:END -->')[0];
  const re = /<loc>([^<]+)<\/loc><lastmod>([^<]+)<\/lastmod>/g;
  const cutoff = Date.now() - DAYS_NEW * 864e5;
  const out = [];
  let m;
  while ((m = re.exec(blog))) {
    const url = m[1];
    if (new Date(m[2]).getTime() < cutoff) continue;
    const slug = url.replace(SITE + '/', '').replace(/\/$/, '');
    if (!slug || slug === 'guides.html') continue;   // skip the blog index itself
    const meta = pageMeta(slug);
    out.push({ url, title: meta.title, dek: meta.dek });
  }
  return out;
}

// --- Downtown San Mateo events, from the public DSMA events API ---------------------
async function dsmaEvents() {
  let data;
  try {
    const r = await fetch(DSMA_API, { headers: UA });
    if (!r.ok) return [];
    data = await r.json();
  } catch { return []; }
  const now = Date.now(), horizon = now + DAYS_AHEAD * 864e5;
  const out = [];
  for (const ev of (data.events || [])) {
    const start = new Date(String(ev.start_date || '').replace(' ', 'T')).getTime();
    if (!start || start < now || start > horizon) continue;
    out.push({ title: decodeEntities(ev.title), when: start, url: ev.url || '' });
  }
  out.sort((a, b) => a.when - b.when);
  const seen = new Set(), deduped = [];   // a recurring event lists once per day; keep the soonest
  for (const e of out) {
    const key = e.title.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(e);
  }
  return deduped.slice(0, 6);
}

// --- City news + council meetings, from the public city RSS feeds -------------------
async function rssItems(url, limit) {
  let xml;
  try {
    const r = await fetch(url, { headers: UA });
    if (!r.ok) return [];
    xml = await r.text();
  } catch { return []; }
  const out = [];
  const re = /<item>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = re.exec(xml)) && out.length < limit) {
    const block = m[1];
    const pick = (tag) => {
      const mm = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
      return mm ? decodeEntities(mm[1].replace(/<[^>]+>/g, '')) : '';
    };
    const title = pick('title');
    if (title) out.push({ title, link: pick('link') });
  }
  return out;
}

// --- Assemble the issue in the proven format (## headings, never bold) --------------
function buildBody({ posts, events, news, council }) {
  const L = [];
  L.push('Hi there,', '');
  L.push("Here's what's worth knowing around San Mateo this week.", '');

  if (news.length) {
    L.push('## City news');
    for (const n of news) L.push(n.link ? `- [${n.title}](${n.link})` : `- ${n.title}`);
    L.push('');
  }
  if (council.length) {
    L.push('## Upcoming City Council');
    for (const c of council) L.push(c.link ? `- [${c.title}](${c.link})` : `- ${c.title}`);
    L.push('');
  }
  if (events.length) {
    L.push('## Downtown happenings');
    for (const e of events) {
      const label = e.url ? `[${e.title}](${e.url})` : e.title;
      L.push(`- ${fmtDay(e.when)}: ${label}`);
    }
    L.push('');
  }
  if (posts.length) {
    L.push('## New on the site');
    for (const p of posts) L.push(`- [${p.title}](${p.url})${p.dek ? `. ${p.dek}` : ''}`);
    L.push('');
  }
  if (!news.length && !council.length && !events.length && !posts.length) {
    L.push('Light week, nothing major to flag. Back next Friday.', '');
  }

  L.push('## Think you know your hometown?');
  L.push(`Twenty questions, no Googling. [Take the quiz](${SITE}/quiz.html).`, '');
  L.push("That's the week. Thanks for reading, and feel free to reply anytime. I read every one.", '');
  L.push('Jason', 'San Mateo Local');
  return L.join('\n');
}

function buildSubject({ news, events, posts }) {
  const bits = [];
  if (news[0]) bits.push(news[0].title);
  if (events[0]) bits.push(events[0].title);
  else if (posts[0]) bits.push(posts[0].title);
  if (!bits.length) return `San Mateo Local, this week (${fmtDay(Date.now())})`;
  const subj = 'This week in San Mateo: ' + bits.slice(0, 2).join(', ');
  return subj.length > 120 ? subj.slice(0, 117) + '...' : subj;
}

// --- Run ---------------------------------------------------------------------------
const posts = recentPosts();
const [events, news, council] = await Promise.all([
  dsmaEvents(),
  rssItems(CITY_NEWS_RSS, 3),
  rssItems(CITY_COUNCIL_RSS, 3),
]);

const subject = buildSubject({ news, events, posts });
const body = buildBody({ posts, events, news, council });

console.log(`Assembled: ${posts.length} post(s), ${events.length} event(s), ${news.length} news item(s), ${council.length} council item(s).`);

if (!BD_KEY) {
  console.log('\nNo BUTTONDOWN_API_KEY set — dry run. The assembled issue is below.\n');
  console.log('SUBJECT: ' + subject + '\n');
  console.log(body);
  process.exit(0);
}

// 1) Create the draft (never sends to subscribers — status: draft).
let draftId;
try {
  const r = await fetch(BD_API, {
    method: 'POST',
    headers: { Authorization: `Token ${BD_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ subject, body, status: 'draft' }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { console.error('Draft create failed:', r.status, JSON.stringify(j)); process.exit(1); }
  draftId = j.id;
  console.log('Buttondown draft created:', draftId);
} catch (e) { console.error('Draft create error:', e.message); process.exit(1); }

// 2) Email Jason a preview of that draft (recipient need not be a subscriber).
try {
  const r = await fetch(`${BD_API}/${draftId}/send-draft`, {
    method: 'POST',
    headers: { Authorization: `Token ${BD_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ recipients: [PREVIEW_TO] }),
  });
  if (!r.ok) { console.error('Preview send failed:', r.status, await r.text()); process.exit(1); }
  console.log(`Preview sent to ${PREVIEW_TO}. Review it, then click Send in Buttondown to publish.`);
} catch (e) { console.error('Preview send error:', e.message); process.exit(1); }
