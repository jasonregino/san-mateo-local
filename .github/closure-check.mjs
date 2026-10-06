// Monthly closure check: runs in GitHub Actions on the 1st (see workflows/closure-check.yml).
//
// Asks Google about every listed business by its exact Place ID (.github/place-ids.json,
// built locally by scripts/build-place-ids.mjs) and opens one Issue listing any that
// Google marks permanently or temporarily closed, or that Google no longer knows.
// It NEVER edits the site. Jason approves every change with Claude Code.
//
// Cost: one Place Details call per business per month (~1,050), inside Google's free
// monthly allowance for this lookup. That is why it runs monthly, not weekly.
import { readFileSync } from 'node:fs';
const KEY = process.env.GOOGLE_MAPS_API_KEY;
if (!KEY) { console.error('Missing GOOGLE_MAPS_API_KEY'); process.exit(1); }
const limit = process.argv.includes('--limit') ? +process.argv[process.argv.indexOf('--limit') + 1] : Infinity;
const map = JSON.parse(readFileSync('.github/place-ids.json', 'utf8')).places;
const sleep = ms => new Promise(r => setTimeout(r, ms));

const closed = [], temp = [], gone = [], errors = [];
let checked = 0;
for (const [id, p] of Object.entries(map)) {
  if (!p.placeId) continue;
  if (checked >= limit) break;
  checked++;
  let r;
  try {
    r = await fetch(`https://places.googleapis.com/v1/places/${p.placeId}`, {
      headers: { 'X-Goog-Api-Key': KEY, 'X-Goog-FieldMask': 'businessStatus,displayName' },
    });
  } catch (e) { errors.push(`${p.name}: network`); continue; }
  if (r.status === 404) { gone.push({ id, ...p }); continue; }
  if (!r.ok) {
    const body = (await r.text()).slice(0, 160);
    if (r.status === 403) { console.error('Google refused the key (billing?):', body); process.exit(1); }
    errors.push(`${p.name}: ${r.status}`); continue;
  }
  const j = await r.json();
  if (j.businessStatus === 'CLOSED_PERMANENTLY') closed.push({ id, ...p });
  else if (j.businessStatus === 'CLOSED_TEMPORARILY') temp.push({ id, ...p });
  await sleep(60);
}
const unmatched = Object.entries(map).filter(([, p]) => !p.placeId);

const line = x => `- **${x.name}** ([page](https://www.sanmateolocal.com/business/${x.id}.html))`;
const parts = [];
if (closed.length) parts.push(`### Permanently closed, per Google: ${closed.length}`, '', ...closed.map(line), '');
if (temp.length) parts.push(`### Temporarily closed, per Google: ${temp.length}`, '', ...temp.map(line), '');
if (gone.length) parts.push(`### Google no longer has a listing: ${gone.length}`, '', '_Often means closed or merged. Worth a look._', '', ...gone.map(line), '');
const findings = closed.length + temp.length + gone.length;
const today = new Date().toISOString().slice(0, 10);
const body = [
  findings ? `The monthly closure check asked Google about **${checked}** listed businesses. **${findings}** need a look:` : `The monthly closure check asked Google about **${checked}** listed businesses. **None are marked closed.**`,
  '',
  ...parts,
  unmatched.length ? `<details><summary>${unmatched.length} listings could not be matched to a Google place (often a wrong or outdated address on our side)</summary>\n\n${unmatched.map(([id, p]) => `- ${p.name}: Google suggests ${p.unmatched}`).join('\n')}\n</details>\n` : '',
  errors.length ? `_${errors.length} lookups errored and were skipped._\n` : '',
  '**Next step:** open Claude Code and say *"run through the closure check."* Closures get double-checked before anything changes on the site. Nothing is removed automatically.',
].join('\n');
console.log(body);

const token = process.env.GITHUB_TOKEN, repo = process.env.GITHUB_REPOSITORY;
if (token && repo) {
  const res = await fetch(`https://api.github.com/repos/${repo}/issues`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json', 'User-Agent': 'closure-check' },
    body: JSON.stringify({ title: `Monthly closure check: ${findings} to review (${today})`, body, labels: ['closure-check'] }),
  });
  console.log(res.ok ? 'GitHub issue created.' : `Issue creation failed: ${res.status} ${await res.text()}`);
} else console.log('\n(Local run, no GITHUB_TOKEN, so no issue was created.)');
