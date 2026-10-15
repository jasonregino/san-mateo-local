// Monthly page-view report for verified businesses (step 1: proves GA4 access works).
// Runs in GitHub Actions with a short-lived Google token from keyless Workload Identity
// Federation (no key file exists). Reads GA4 property 544225744, read-only.
// Views exclude known bots (GA4 does this automatically). Zeros are reported honestly.
import { readFileSync } from 'node:fs';

const TOKEN = process.env.GA_TOKEN;
const PROPERTY = '544225744';
if (!TOKEN) { console.log('No GA_TOKEN (run in GitHub Actions).'); process.exit(0); }

const listings = JSON.parse(readFileSync('.github/verified-pages.json', 'utf8'));
const body = {
  dateRanges: [{ startDate: '30daysAgo', endDate: 'yesterday' }],
  dimensions: [{ name: 'pagePath' }],
  metrics: [{ name: 'screenPageViews' }, { name: 'activeUsers' }],
  dimensionFilter: { filter: { fieldName: 'pagePath', stringFilter: { matchType: 'BEGINS_WITH', value: '/business/' } } },
  limit: 5000,
};
const r = await fetch(`https://analyticsdata.googleapis.com/v1beta/properties/${PROPERTY}:runReport`, {
  method: 'POST', headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});
const j = await r.json();
if (!r.ok) { console.error('GA4 error', r.status, JSON.stringify(j).slice(0, 500)); process.exit(1); }
const byId = {};
for (const row of j.rows || []) {
  const m = row.dimensionValues[0].value.match(/^\/business\/([^/?#]+?)(\.html)?$/);
  if (!m) continue;
  const id = m[1];
  byId[id] = byId[id] || { views: 0, people: 0 };
  byId[id].views += +row.metricValues[0].value; byId[id].people += +row.metricValues[1].value;
}
console.log(`GA4 access OK. ${Object.keys(byId).length} business pages had views in the last 30 days.\n`);
console.log('Verified businesses, last 30 days (views / people):');
for (const l of listings) { const v = byId[l.id] || { views: 0, people: 0 }; console.log(`  ${l.name}: ${v.views} views / ${v.people} people`); }
