// Monthly feature-proof report: views on each free owner feature (story page + business page)
// since it went live, so we know when there is enough proof to sell the Local Story Package.
// Feature list: .github/features.json (public names/slugs only). Private notes + owner quotes
// live in data/feature-tracker.md (gitignored, backed up by sync.sh).
// GA4 auth: keyless Workload Identity Federation, read-only. Emails Jason via a throwaway
// Buttondown draft preview (same as warm leads). Logs are PUBLIC: counts only, never names.
import { readFileSync } from 'node:fs';

const TOKEN = process.env.GA_TOKEN;
const BD_KEY = process.env.BUTTONDOWN_API_KEY;
const PREVIEW_TO = 'regino.jason@gmail.com';
const PROPERTY = '544225744';
if (!TOKEN) { console.log('No GA_TOKEN (run in GitHub Actions).'); process.exit(0); }

const features = JSON.parse(readFileSync('.github/features.json', 'utf8'));
const earliest = features.map(f => f.since).sort()[0];

// pagePath x date, so each feature only counts views from its own go-live date on.
const r = await fetch(`https://analyticsdata.googleapis.com/v1beta/properties/${PROPERTY}:runReport`, {
  method: 'POST', headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    dateRanges: [{ startDate: earliest, endDate: 'yesterday' }],
    dimensions: [{ name: 'pagePath' }, { name: 'date' }],
    metrics: [{ name: 'screenPageViews' }, { name: 'activeUsers' }],
    limit: 100000,
  }),
});
const j = await r.json();
if (!r.ok) { console.error('GA4 error', r.status, JSON.stringify(j).slice(0, 500)); process.exit(1); }

const norm = p => p.replace(/[?#].*$/, '').replace(/\.html$/, '').replace(/\/$/, '');
const rows = (j.rows || []).map(x => ({
  path: norm(x.dimensionValues[0].value),
  day: x.dimensionValues[1].value.replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3'),
  views: +x.metricValues[0].value,
}));
const recentFrom = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
const count = (path, since) => {
  let all = 0, last30 = 0;
  for (const x of rows) if (x.path === path && x.day >= since) { all += x.views; if (x.day >= recentFrom) last30 += x.views; }
  return { all, last30 };
};

const nice = d => new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const L = [`Views on each free owner feature, from the day it went live through yesterday.`, ''];
let total = 0;
for (const f of features) {
  const biz = count(`/business/${f.business}`, f.since);
  L.push(`**${f.name}** (live since ${nice(f.since)})`);
  if (f.story) {
    const st = count(`/${f.story}`, f.since);
    total += st.all;
    L.push(`- Story: ${st.all} views total, ${st.last30} in the last 30 days (https://www.sanmateolocal.com/${f.story}.html)`);
  }
  total += biz.all;
  L.push(`- Business page: ${biz.all} views total, ${biz.last30} in the last 30 days`, '');
}
L.push(`Add these to data/feature-tracker.md, or just tell Claude "update the feature tracker".`);
L.push(`Note: GA4 may count your own visits too, so treat small numbers as approximate.`);

const subject = `Feature views: ${features.length} features, ${total} views so far`;
console.log(`${features.length} features, ${total} total views.`);
if (process.env.LOCAL_PREVIEW) console.log('\n' + L.join('\n'));
if (!BD_KEY) { console.log('No BUTTONDOWN_API_KEY: dry run, nothing emailed.'); process.exit(0); }

const BD = 'https://api.buttondown.com/v1/emails';
const H = { Authorization: `Token ${BD_KEY}`, 'Content-Type': 'application/json' };
const c = await fetch(BD, { method: 'POST', headers: H, body: JSON.stringify({ subject, body: L.join('\n'), status: 'draft' }) });
const cj = await c.json().catch(() => ({}));
if (!c.ok) { console.error('Draft create failed:', c.status, JSON.stringify(cj)); process.exit(1); }
const s = await fetch(`${BD}/${cj.id}/send-draft`, { method: 'POST', headers: H, body: JSON.stringify({ recipients: [PREVIEW_TO] }) });
if (!s.ok) { console.error('Preview send failed:', s.status, await s.text()); process.exit(1); }
console.log(`Emailed to ${PREVIEW_TO}.`);
const del = await fetch(`${BD}/${cj.id}`, { method: 'DELETE', headers: H });
console.log(del.ok ? 'Throwaway draft deleted.' : `Note: draft not deleted (${del.status}), harmless.`);
