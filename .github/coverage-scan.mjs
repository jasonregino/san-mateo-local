// Weekly coverage scan — runs in GitHub Actions (see .github/workflows/coverage-scan.yml).
//
// Each week it sweeps ONE rotating slice of San Mateo businesses from Google Places,
// compares them to the deployed guide (concierge-data.json, which IS committed), and
// opens a GitHub Issue listing local independents that aren't in the guide yet — both
// long-existing gaps AND newly-opened spots that just got a Google listing.
//
// It NEVER edits the site. It only reports. Jason (with Claude Code) verifies and adds
// the good ones — the curation gate stays human.

import { readFileSync } from 'node:fs';

const KEY = process.env.GOOGLE_MAPS_API_KEY;
if (!KEY) { console.log('No GOOGLE_MAPS_API_KEY secret set yet; skipping (no error).'); process.exit(0); }

// San Mateo (city) bounding box.
const BOX = { low: { latitude: 37.50, longitude: -122.40 }, high: { latitude: 37.61, longitude: -122.24 } };

// Weekly rotation — each focus sweeps one slice; over ~6 weeks it covers the whole
// guide, then repeats so newly-opened places get caught within a cycle.
// Each focus has an `accept` test: a result is only kept if its Google type OR name
// actually matches the focus. This drops the generic "Health"/"Store"/"Sports School"
// noise that a plain text search drags in.
const ROTATION = [
  { focus: 'New restaurants, cafes & bars', terms: ['restaurant', 'new restaurant', 'cafe', 'coffee shop', 'bakery', 'bar'], accept: /restaurant|\bcafe\b|café|coffee|bakery|\bbar\b|bistro|\bpub\b|brewery|\bdeli\b|diner|eatery|kitchen|grill|taqueria|pizz|ramen|sushi|boba|creamery|dessert/i },
  { focus: 'Health, fitness & wellness', terms: ['gym', 'fitness studio', 'yoga studio', 'pilates studio', 'chiropractor', 'physical therapy', 'massage therapy', 'med spa', 'acupuncture'], accept: /chiropract|\bgym\b|fitness|yoga|pilates|reformer|physical therap|\bpt\b|massage|bodywork|acupuncture|wellness|med ?spa|medical spa|aesthetic|\bspa\b|crossfit|strength/i },
  { focus: 'Personal services', terms: ['hair salon', 'barber shop', 'nail salon', 'dentist', 'optometrist', 'day spa'], accept: /hair salon|beauty salon|\bsalon\b|barber|\bnail|dentist|dental|orthodont|optometr|optical|eye care|day spa|\bspa\b/i },
  { focus: 'Pets, auto & cleaners', terms: ['veterinarian', 'pet grooming', 'auto repair', 'dry cleaner', 'tailor alterations'], accept: /veterinar|animal hospital|\bvet\b|pet groom|grooming|\bauto|automotive|car repair|body shop|\btire|brake|smog|mechanic|dry clean|cleaners?|tailor|alteration/i },
  { focus: 'Shopping', terms: ['boutique', 'gift shop', 'bookstore', 'florist', 'specialty grocery', 'home goods store'], accept: /boutique|clothing|apparel|\bgift|book ?store|florist|flower|grocery|\bmarket|jewel|\bshoe|furniture|home goods|\btoy|record store|thrift|consignment|\bshop\b/i },
  { focus: 'Things to do', terms: ['art gallery', 'escape room', 'entertainment', 'bowling alley', 'live music venue'], accept: /art gallery|gallery|escape room|amusement|arcade|bowling|music venue|theat|museum|attraction|climbing|axe|pottery|paint/i },
];
const weekNo = Math.floor(Date.now() / 604800000); // weeks since epoch
const pick = ROTATION[weekNo % ROTATION.length];

// National / regional chains to skip (curation moat = independent & local).
const CHAINS = ['starbucks', 'peets', 'philz', 'blue bottle', '7-eleven', 'mcdonald', 'burger king', 'subway', 'jack in the box', 'taco bell', 'chipotle', 'panera', 'jamba', 'supercuts', 'great clips', 'sport clips', 'european wax', 'club pilates', 'orangetheory', '24 hour fitness', 'planet fitness', 'crunch fitness', 'massage envy', 'hand and stone', 'western dental', 'aspen dental', 'lenscrafters', 'warby parker', 'jiffy lube', 'valvoline', 'midas', 'meineke', 'big o tires', 'discount tire', 'les schwab', 'pep boys', 'banfield', 'vca', 'petsmart', 'petco', 'h&r block', 'ups store', 'fedex office', 'cvs', 'walgreens', 'safeway', 'trader joe', 'whole foods', 'target', 'walmart', 'ross dress', 'marshalls', 'tj maxx', 'nordstrom', 'kaiser'];

const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').replace(/\b(the|a|an|of|inc|llc|co)\b/g, ' ').replace(/\s+/g, ' ').trim();

// Baseline: everything already in the guide (concierge-data.json is committed and served).
const baseline = new Set();
try {
  const data = JSON.parse(readFileSync('concierge-data.json', 'utf8'));
  for (const p of (data.places || [])) { const n = norm(p.name); if (n) baseline.add(n); }
  console.log(`Baseline: ${baseline.size} businesses already in the guide.`);
} catch (e) { console.log('Could not read concierge-data.json:', e.message); }
const seen = c => { for (const e of baseline) { if (e === c || (e.length > 6 && c.length > 6 && (e.startsWith(c) || c.startsWith(e)))) return true; } return false; };
const isChain = n => { const x = norm(n); return CHAINS.some(c => x.includes(norm(c))); };

const MASK = 'places.displayName,places.formattedAddress,places.primaryTypeDisplayName,nextPageToken';
async function search(q, token) {
  const body = { textQuery: q + ' in San Mateo, CA', regionCode: 'US', pageSize: 20, locationRestriction: { rectangle: BOX } };
  if (token) body.pageToken = token;
  const r = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': KEY, 'X-Goog-FieldMask': MASK },
    body: JSON.stringify(body),
  });
  return r.json();
}

const found = new Map();
for (const q of pick.terms) {
  let token = null, pages = 0;
  do {
    const j = await search(q, token);
    if (j.error) { console.log('API error for', q, '-', j.error.message); break; }
    for (const p of (j.places || [])) {
      const name = p.displayName?.text; if (!name) continue;
      const addr = (p.formattedAddress || '').replace(', USA', '');
      if (!/San Mateo, CA/i.test(addr)) continue;      // San Mateo city only
      const key = norm(name);
      if (!key || found.has(key)) continue;
      if (seen(key) || isChain(name)) continue;
      const hay = ((p.primaryTypeDisplayName?.text || '') + ' ' + name).toLowerCase();
      if (!pick.accept.test(hay)) continue; // must actually look like this focus
      found.set(key, { name, addr: addr.replace(/, San Mateo, CA.*$/, ''), type: p.primaryTypeDisplayName?.text || '' });
    }
    token = j.nextPageToken; pages++;
    if (token) await new Promise(s => setTimeout(s, 1600));
  } while (token && pages < 3);
  await new Promise(s => setTimeout(s, 150));
}

const list = [...found.values()].sort((a, b) => a.name.localeCompare(b.name));
if (!list.length) { console.log(`Coverage scan (${pick.focus}): nothing new this week. Guide is current.`); process.exit(0); }

const today = new Date().toISOString().slice(0, 10);
const body = [
  `This week's coverage-scan focus: **${pick.focus}**.`,
  '',
  `Found **${list.length}** San Mateo business(es) that look local and independent but aren't in the guide yet:`,
  '',
  ...list.map(b => `- **${b.name}** — ${b.addr}  _(${b.type})_`),
  '',
  '_From Google Places, filtered to San Mateo city + likely-independent. Some may be chains, relocated, or already listed under a slightly different name — verify before adding._',
  '',
  '**Next step:** open Claude Code and say *"run through the coverage finds."* It verifies each one and adds the good ones with your OK. Nothing is added to the site automatically.',
].join('\n');
console.log(body);

const token = process.env.GITHUB_TOKEN, repo = process.env.GITHUB_REPOSITORY;
if (token && repo) {
  const res = await fetch(`https://api.github.com/repos/${repo}/issues`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json', 'User-Agent': 'coverage-scan' },
    body: JSON.stringify({ title: `Coverage scan — ${list.length} to review · ${pick.focus} (${today})`, body, labels: ['coverage-scan'] }),
  });
  console.log(res.ok ? 'GitHub issue created.' : `Issue creation failed: ${res.status} ${await res.text()}`);
} else {
  console.log('\n(Local run — no GITHUB_TOKEN, so no issue was created.)');
}
