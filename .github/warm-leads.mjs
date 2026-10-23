// Friday warm-leads shortlist (replaces the Cowork "Friday warm-pages GA4 pull", which never
// had a browser in the cloud). Same rules as scripts/warm-pages.mjs:
//   - a business page with engaged visits on 2+ separate days is warm on its own;
//   - a single-day page needs 10s+ average engagement (GA4's own "engaged" bar);
//   - skip claimed (verified) businesses and public/civic pages.
// GA4 auth: keyless Workload Identity Federation (no key file exists), read-only.
// Contacts come from .github/warm-lookup.json (written by build-business-pages --all; public fields only).
// WARM_SKIP (repo SECRET, masked in logs; this repo and its logs are public). Master copy: data/warm-skip.json (gitignored, backed up by sync.sh); see its _note for the update command.: comma-separated listing ids already contacted.
// Emails Jason via a throwaway Buttondown draft preview (same as the ops digest). Never touches the site.
import { readFileSync } from 'node:fs';

const TOKEN = process.env.GA_TOKEN;
const BD_KEY = process.env.BUTTONDOWN_API_KEY;
const PREVIEW_TO = 'regino.jason@gmail.com';
const PROPERTY = '544225744';
const MIN_SECONDS = 10;
if (!TOKEN) { console.log('No GA_TOKEN (run in GitHub Actions).'); process.exit(0); }

const lookup = new Map(JSON.parse(readFileSync('.github/warm-lookup.json', 'utf8')).map(l => [l.id, l]));
const skip = new Set((process.env.WARM_SKIP || '').split(',').map(s => s.trim()).filter(Boolean));

const r = await fetch(`https://analyticsdata.googleapis.com/v1beta/properties/${PROPERTY}:runReport`, {
  method: 'POST', headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    dateRanges: [{ startDate: '28daysAgo', endDate: 'yesterday' }],
    dimensions: [{ name: 'pagePath' }, { name: 'date' }],
    metrics: [{ name: 'screenPageViews' }, { name: 'engagedSessions' }, { name: 'userEngagementDuration' }, { name: 'activeUsers' }],
    dimensionFilter: { filter: { fieldName: 'pagePath', stringFilter: { matchType: 'BEGINS_WITH', value: '/business/' } } },
    limit: 100000,
  }),
});
const j = await r.json();
if (!r.ok) { console.error('GA4 error', r.status, JSON.stringify(j).slice(0, 500)); process.exit(1); }

const pages = {};
for (const row of j.rows || []) {
  const m = row.dimensionValues[0].value.match(/^\/business\/([^/?#]+?)(\.html)?$/);
  if (!m) continue;
  const d = row.dimensionValues[1].value; const date = `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
  const [views, engaged, dur, users] = row.metricValues.map(v => +v.value);
  const p = pages[m[1]] ||= { days: new Set(), lastDate: '', views: 0, dur: 0, users: 0 };
  if (engaged > 0) p.days.add(date);
  if (views > 0 && date > p.lastDate) p.lastDate = date;
  p.views += views; p.dur += dur; p.users += users;
}

let claimed = 0, civic = 0, contacted = 0, gone = 0, cold = 0;
const leads = [];
for (const [id, p] of Object.entries(pages)) {
  const l = lookup.get(id);
  if (!l) { gone++; continue; }
  if (l.verified) { claimed++; continue; }
  if (l.civic) { civic++; continue; }
  if (skip.has(id)) { contacted++; continue; }
  const days = p.days.size, seconds = p.users ? p.dur / p.users : 0;
  if (days < 2 && seconds < MIN_SECONDS) { cold++; continue; }
  leads.push({ l, days, lastDate: p.lastDate, views: p.views, seconds });
}
leads.sort((a, b) => b.days - a.days || b.lastDate.localeCompare(a.lastDate) || b.seconds - a.seconds || b.views - a.views);

const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
const weekAgo = new Date(Date.now() - 7 * 86400000).toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
const nice = d => new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const top = leads.slice(0, 10);

// ---- Contact finder (2026-10-23, Jason: "copy-paste messages would be an immense help") ----
// Reads each lead's own website (home + common contact pages) for a public email and an
// Instagram handle. Public info only, never guessed. Results go only to Jason's inbox.
const JUNK = /example|yourname|your@|email@|name@|sentry|wixpress|godaddy|domain\.com|\.(png|jpe?g|gif|svg|webp)$|@2x|@sentry/i;
async function fetchText(url) {
  try {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 8000);
    const r = await fetch(url, { signal: ctl.signal, redirect: 'follow', headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh) Chrome/129' } });
    clearTimeout(t); return r.ok ? await r.text() : '';
  } catch { return ''; }
}
async function findContact(website) {
  const out = { email: '', ig: '' };
  if (!website) return out;
  let base; try { base = new URL(website); } catch { return out; }
  const host = base.hostname.replace(/^www\./, '');
  for (const path of ['', '/contact', '/contact-us', '/pages/contact', '/about']) {
    const html = (await fetchText(new URL(path || '/', base).href)).replace(/&#64;|&commat;/g, '@');
    if (!html) continue;
    const emails = [...new Set((html.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) || []).map(e => e.toLowerCase()))].filter(e => !JUNK.test(e));
    if (!out.email && emails.length) out.email = emails.find(e => e.endsWith('@' + host)) || emails[0];
    if (!out.ig) { const m = html.match(/instagram\.com\/([A-Za-z0-9_.]{2,30})/); if (m && !/^(p|reel|explore|accounts|sharer)$/i.test(m[1])) out.ig = '@' + m[1]; }
    if (out.email && out.ig) break;
  }
  return out;
}
for (const o of top) Object.assign(o, await findContact(o.l.website));
for (const o of top) if (!o.ig && o.l.ig) o.ig = o.l.ig.startsWith('@') ? o.l.ig : '@' + String(o.l.ig).replace(/^.*instagram\.com\//, '').replace(/\/.*$/, '');

const page = l => `https://sanmateolocal.com/business/${l.id}.html`;
const why = o => `${o.days >= 2 ? `Came back on ${o.days} different days` : `One visit, ${Math.round(o.seconds)} seconds of reading`} · last visit ${nice(o.lastDate)}${o.lastDate >= weekAgo ? ' · **active this week**' : ''}`;
const emailBody = l => [
  'Hi there,',
  'Jason here, I run San Mateo Local, a local guide to independent businesses in San Mateo.',
  `I noticed ${l.name}'s page has been getting a little interest on the site, so I wanted to reach out and let you know you can claim it for free. Claiming adds a verified check mark, lets you add your logo and photos, and keep your hours and other details current. San Mateo Lock Works, downtown since 1927, just claimed theirs, and so did Hiptwist Fitness, whose grand opening we featured on the homepage and in Local Buzz. They were pretty thrilled with the response.`,
  ...(l.website ? ["Your listing also links straight to your website, so it's another place people find you and a link back to your site from an established local guide."] : []),
  `Here's the page:<br>${l.name} on San Mateo Local: ${page(l)}`,
  'There\'s a "Claim it free" link right at the top of the page. It only takes a minute or two, and there\'s no cost.',
  `Either way, glad to have ${l.name} on the guide!`,
  'Jason Regino<br>Founder · San Mateo Local<br>(650) 260-8084<br>jason@sanmateolocal.com · sanmateolocal.com',
].map(x => '> ' + x).join('\n>\n');
const shortMsg = l => `> Hi, this is Jason with San Mateo Local, the local guide for San Mateo. ${l.name} has a page on the site and it's been getting looked up lately. It's free to claim so you can add your own photos, hours, and a booking or call link. Here's the page: ${page(l)}. Just reply here if you'd like a hand.`;

const byEmail = top.filter(o => o.email), byIg = top.filter(o => !o.email && o.ig), byPhone = top.filter(o => !o.email && !o.ig);
const L = [];
L.push(`Business pages people spent real time on in the last 4 weeks, from owners who haven't claimed their free page yet. Messages are ready to copy and paste.`);
L.push('');
if (!top.length) L.push('No new warm leads this week. Nothing to send.');
if (byEmail.length) {
  L.push(`## Ready to email (${byEmail.length})`, '');
  byEmail.forEach(o => {
    L.push(`### ${o.l.name}`, `${why(o)} · [their page](${page(o.l)})`, '', `**To:** ${o.email}  `, `**Subject:** ${o.l.name} on San Mateo Local`, '', emailBody(o.l), '');
  });
}
if (byIg.length) {
  L.push(`## Send as an Instagram DM (${byIg.length})`, 'No email on their website. Open their Instagram, tap Message, and paste:', '');
  byIg.forEach(o => { L.push(`### ${o.l.name}`, `${why(o)} · Instagram: [${o.ig}](https://instagram.com/${o.ig.slice(1)})`, '', shortMsg(o.l), ''); });
}
if (byPhone.length) {
  L.push(`## Phone or website form only (${byPhone.length})`, 'No email or Instagram found. Text the number, or paste into the contact form on their site:', '');
  byPhone.forEach(o => {
    const c = [o.l.phone, o.l.website && `[website](${o.l.website})`].filter(Boolean).join(' · ') || 'no contact info on file';
    L.push(`### ${o.l.name}`, `${why(o)} · ${c}`, '', shortMsg(o.l), '');
  });
}
if (leads.length > top.length) L.push(`Plus ${leads.length - top.length} more lower on the list (ask Code for the full list).`, '');
L.push("**After you send:** tell Code who you contacted so they drop off next week's list.");
L.push('');
L.push(`_Skipped: ${claimed} already claimed, ${contacted} already contacted, ${civic} parks/libraries/city pages, ${cold} quick bounces${gone ? `, ${gone} removed pages` : ''}. Emails and Instagram handles come from each business's own website. Your own visits are filtered out by Google Analytics._`);

const subject = top.length ? `Warm leads for Friday: ${top.length} business${top.length === 1 ? '' : 'es'} to invite (${nice(today)})` : `Warm leads for Friday: none this week (${nice(today)})`;
const body = L.join('\n');
// Logs are PUBLIC on this repo: print counts only, never business names. The list goes to Jason's inbox.
console.log(`${leads.length} warm leads (${top.length} in the email). Skipped: ${claimed} claimed, ${contacted} contacted, ${civic} civic, ${cold} bounces, ${gone} removed.`);
if (process.env.LOCAL_PREVIEW) console.log('\nSUBJECT: ' + subject + '\n\n' + body);
if (!BD_KEY) { console.log('No BUTTONDOWN_API_KEY: dry run, nothing emailed.'); process.exit(0); }

const BD = 'https://api.buttondown.com/v1/emails';
const H = { Authorization: `Token ${BD_KEY}`, 'Content-Type': 'application/json' };
const c = await fetch(BD, { method: 'POST', headers: H, body: JSON.stringify({ subject, body, status: 'draft' }) });
const cj = await c.json().catch(() => ({}));
if (!c.ok) { console.error('Draft create failed:', c.status, JSON.stringify(cj)); process.exit(1); }
const s = await fetch(`${BD}/${cj.id}/send-draft`, { method: 'POST', headers: H, body: JSON.stringify({ recipients: [PREVIEW_TO] }) });
if (!s.ok) { console.error('Preview send failed:', s.status, await s.text()); process.exit(1); }
console.log(`\nEmailed to ${PREVIEW_TO}.`);
const del = await fetch(`${BD}/${cj.id}`, { method: 'DELETE', headers: H });
console.log(del.ok ? 'Throwaway draft deleted.' : `Note: draft not deleted (${del.status}), harmless.`);
