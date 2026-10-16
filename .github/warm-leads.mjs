// Friday warm-leads shortlist (replaces the Cowork "Friday warm-pages GA4 pull", which never
// had a browser in the cloud). Same rules as scripts/warm-pages.mjs:
//   - a business page with engaged visits on 2+ separate days is warm on its own;
//   - a single-day page needs 10s+ average engagement (GA4's own "engaged" bar);
//   - skip claimed (verified) businesses and public/civic pages.
// GA4 auth: keyless Workload Identity Federation (no key file exists), read-only.
// Contacts come from .github/warm-lookup.json (written by build-business-pages --all; public fields only).
// WARM_SKIP (repo SECRET, masked in logs; this repo and its logs are public): comma-separated listing ids already contacted.
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

const L = [];
L.push(`Business pages people spent real time on in the last 4 weeks, from owners who haven't claimed their free page yet. Best leads first.`);
L.push('');
if (!top.length) L.push('No new warm leads this week. Nothing to send.');
top.forEach((o, i) => {
  const l = o.l, fresh = o.lastDate >= weekAgo ? ' · **active this week**' : '';
  L.push(`**${i + 1}. ${l.name}** (${l.cat})`);
  L.push(`${o.days >= 2 ? `Came back on ${o.days} different days` : `One visit, ${Math.round(o.seconds)} seconds of reading`} · last visit ${nice(o.lastDate)} · ${o.views} views${fresh}`);
  const c = [l.website && `[Website](${l.website})`, l.phone, l.ig && `Instagram: ${l.ig}`].filter(Boolean).join(' · ');
  L.push(`[Their page](https://sanmateolocal.com/business/${l.id}.html)${c ? ' · ' + c : ' · no contact info on file'}`);
  L.push('');
});
if (leads.length > top.length) L.push(`Plus ${leads.length - top.length} more lower on the list (ask Code for the full list).`, '');
L.push('**How to send:** use the standard claim invite (subject: "[Business] on San Mateo Local"). Then tell Code who you contacted so they drop off next week\'s list.');
L.push('');
L.push(`_Skipped: ${claimed} already claimed, ${contacted} already contacted, ${civic} parks/libraries/city pages, ${cold} quick bounces${gone ? `, ${gone} removed pages` : ''}. Your own visits are filtered out by Google Analytics._`);

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
