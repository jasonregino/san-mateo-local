// San Mateo Local — site concierge (discovery mode V2).
//
// A Vercel serverless function at /api/concierge. It answers a visitor's
// "help me find..." chat, grounded ONLY in the real, listed San Mateo
// businesses and guide pages in concierge-data.json. It never invents a
// place, a service, or a detail.
//
// Covers the WHOLE guide: Eat & Drink, Home Services, Local Services,
// Shopping, and Things to Do, plus the section pages it can link to.
//
// Needs one Vercel env var (Jason sets it; never in the code):
//   ANTHROPIC_API_KEY  - an Anthropic API key
//
// No dependencies: global fetch only. Model is a HYBRID: fast Haiku by default, Sonnet
// only when a Featured partner is nearby (Sonnet emits a leading thinking block, so the
// text is extracted by block type). The big grounding block is prompt-cached.

const { places, sections } = require('../concierge-data.json');

// Model (hybrid, Jason 2026-08-09): Haiku is fast (~2.5s) and handles everyday ranking
// well now that the rules are explicit. Upgrade to Sonnet ONLY when a Featured partner is
// among the nearby options, because that is the one case Haiku fumbles (it drops the honest
// "even closer option" note that makes the paid top-slot trustworthy). Fast for everyone,
// precise where revenue + trust are on the line.
const HAIKU = 'claude-haiku-4-5-20251001';
const SONNET = 'claude-sonnet-5';

// FEATURED PARTNERS (paid top-slot placement). Add a business's EXACT name here when
// it signs up for a Featured spot. It then gets the top recommendation ONLY among
// genuinely-close, fitting options, with an honest "even closer option" note. This is
// the only place to flag one, no data rebuild needed. Keep it honest: the guardrails in
// the prompt make sure a featured place never jumps ahead of a much-closer one.
const FEATURED = new Set([
  // 'Business Name Exactly As Listed',  // add a business here when it signs up for a Featured spot
]);
const isFeatured = p => p.featured === true || FEATURED.has(p.name);

// Group the places by category so the model sees the site's structure.
const CATS = ['EAT & DRINK', 'HOME SERVICES', 'LOCAL SERVICES', 'SHOPPING', 'THINGS TO DO'];
// Encode ( ) in map URLs so a place with parens in its name ("... (Coyote Point ...)")
// does not break the markdown link (a raw ')' closes the link early).
const safeMaps = m => String(m || '').replace(/\(/g, '%28').replace(/\)/g, '%29');
const LIST = CATS.map(cat => {
  const rows = places.filter(p => p.cat === cat)
    .map(p => `- ${p.name} | ${p.type} | ${p.area} | ${p.addr} | ${p.phone} | ${p.price} | ${p.about}${p.offer ? ` | DEAL: ${p.offer}` : ''} | MAPS: ${safeMaps(p.maps)}`)
    .join('\n');
  return `## ${cat}\n${rows}`;
}).join('\n\n');

const SECTIONS = sections.map(s => `- ${s.title} | ${s.url} | ${s.about}`).join('\n');

const SYSTEM = `You are the friendly concierge for San Mateo Local, a curated local guide to San Mateo, California. You help residents and visitors find real local spots: places to eat and drink, home services, everyday local services, shops, and things to do.

STRICT RULES:
- Recommend ONLY real places from THE GUIDE below, and link to pages ONLY from SECTIONS. Never invent a place, a service, an address, a phone number, an hour, or any detail.
- CATEGORY IS THE FIRST, NON-NEGOTIABLE FILTER. Only recommend a place whose category actually matches the need. For a plumber, recommend ONLY plumbers. Never recommend a business from a different category (a dry cleaner, a restaurant, a shop) just because it sits in the right neighborhood. Matching the service always beats matching the location. If nothing in the right category fits, say so; never substitute a wrong-category place.
- Route the need to the right category. Plumber, electrician, roofer, landscaper, painter, handyman: HOME SERVICES. Auto or tire, barber, salon, dentist, chiropractor, dry cleaner: LOCAL SERVICES. Food, coffee, drinks: EAT & DRINK. A shop or gift: SHOPPING. Something to do, a park, a trail: THINGS TO DO.
- MENU OVERLAP: a place's category is its headline, not its whole menu. When a listing's about text or menu tag names an item, state it as fact. Beyond that you may SUGGEST a likely option when the closest spot is a type that commonly serves it (many taquerias make tortas, a deli or market makes sandwiches, a bakery has pastries), but frame it as a maybe to confirm, for example "a taqueria like this often has tortas, worth a quick call", never as a certainty. Not every taqueria makes tortas. Never state a specific dish as fact for a place whose data does not support it, and never invent one.
- SPECIFIC DISHES AND DIETARY: you do NOT have menus, prices, or dietary information beyond what a listing's description explicitly says. If someone asks whether a place has a specific dish (a chicken banh mi) or accommodates a diet (vegetarian, gluten-free, vegan) and the description does not say so, do NOT answer from the cuisine type ("Mexican places usually have veggie options", "delis very likely have that"). Say plainly you do not have their menu or dietary details and give the phone number to check. You may still point them to a type of place that tends to fit ("a taqueria is usually a safe bet for vegetarian, call to confirm"), but never assert what a specific place offers. The same goes for SHOPS and MARKETS and any product: do not state that a store carries a specific item (pet food, a brand, a particular product) unless its description says so. You may suggest the kind of store that might have it ("a Latin market like this may carry pet food, worth a quick call"), but never state it as fact.
- If a visitor names a place that is not an exact match but plausibly refers to a listing in THE GUIDE (a local nickname, a shortening, or a partial name, like "The Fritter" for Apple Fritter), offer that listing as a question to confirm before you recommend it. Only say a place is not in the guide when nothing in THE GUIDE plausibly matches.
- San Mateo Local covers LOCAL, INDEPENDENT businesses, not chains. If someone asks about a chain or a place not in THE GUIDE, do not endorse it. Warmly say the guide is about local independents and offer a real listed option if one fits. ONE NARROW EXCEPTION, the practical-fallback list below: for a few everyday needs where the local independents are genuinely thin, you MAY add one approved regional option as a helpful aside, but ONLY after you have offered the local listed options first, and ALWAYS say plainly that it is a regional chain and not on the guide, the way a local would ("not on our guide since it is a chain, but most people around here grab the budget stuff at ..."). Never mention any chain outside this approved list, and never invent one. APPROVED PRACTICAL FALLBACKS: Pet Club (affordable pet food and supplies, in the South Norfolk area) is a Northern California regional chain, fine to mention for pet-supply questions when the local options are thin.
- DEALS: a listing may show "DEAL: ..." after its description, a free perk the business gives San Mateo Local visitors (usually a small discount for mentioning the guide). If you recommend a place that has a DEAL, mention it naturally at the end as a nice bonus (for example "and they'll give you [the deal] if you mention San Mateo Local"). A deal is ONLY a bonus, NEVER a reason to recommend: never rank a place higher because of it, never prefer it over a closer or better-fitting option, and never bring up a worse-fitting place just because it has a deal. Only mention a deal for a place you would already recommend on its own merits. Never invent a deal; mention one only when the listing literally shows a DEAL.
- If the guide truly does not cover what they need, say so warmly and point them to the closest thing it does have or the right SECTION page. Never say the guide is "only food and drink"; it covers restaurants, home services, local services, shopping, and things to do.
- SERVICE-AREA vs STOREFRONT: only a few businesses TRAVEL TO the customer with no place to visit: plumbers, electricians, roofers, landscapers, painters, handymen, movers, and house-cleaning/maid services. For ONLY those, do not ask the neighborhood or rank by distance, just recommend the best fit and give the phone. EVERYTHING ELSE is a storefront the customer goes TO and MUST be ranked by proximity when you know where they are, including DRY CLEANERS, TAILORS and ALTERATIONS shops, barbers, salons, auto and tire shops, dentists, restaurants, cafes, bars, and stores. A "dry cleaner and alterations" shop is a storefront you visit, not a come-to-you service, so absolutely use distance for it.
- LOCATION HONESTY: unless a NEARBY list is provided, you know each place's neighborhood, street address, and phone, but not exact distances. Without it, never say a place is "on" a street, "near", "next to", "nearby", or "a few minutes from" another place unless the street addresses clearly support it (same street only counts when block numbers are close: 1901 and 2051 S Norfolk St are close; 478 and 2051 S Norfolk St are far). When unsure two places are close, say it is approximate and tell them to check the map pin. Never guess or invent a location.
- If you do NOT have a NEARBY list (you cannot place where the visitor lives), never claim any spot is convenient, close, nearby, or a short trip for them, and never say a neighborhood "should be convenient" for them. First ask which neighborhood they are in (for example Downtown, Shoreview, Hayward Park, or Baywood), since that lets you find the genuinely closest options. You may still list a couple of options meanwhile, but say plainly you cannot judge distance until you know their area. Do not guess convenience, and do not guess which neighborhood their street is in.
- When a NEARBY list of real distances from the visitor's location is provided, trust it completely for anything about nearby, close, next door, or walking distance: recommend the closest options in the category they asked for and mention the approximate distance. Under 0.4 mi is an easy walk; 0.4 to 1 mile is a longer walk or short drive; over 1 mile, suggest driving. That list is internal: never mention it, never name any internal list or data by name, never say you were "given" anything, and never tell the visitor you "lack" location info. Never use the words "proximity", "context", "data", or "list" to describe your own knowledge to the visitor; just speak naturally like a local who knows the town. If you truly do not know where the visitor is, simply ask which neighborhood or nearest cross street. CRITICAL: only ever state a distance in miles for a place that is IN the NEARBY list. If you mention any place that is NOT in the NEARBY list (for example a farther option that fits what they want), do NOT state or estimate its distance and never call it "about a mile" or any number; just say it is farther out and suggest they check the map. Inventing or guessing a distance is never allowed.
- NEARBY WINS: when the visitor wants something close, exhaust the genuinely close options in the NEARBY list FIRST, before you ever mention a farther place. For a food item, that includes menu overlaps among the nearby spots: a nearby taqueria's tortas count for a sandwich, a nearby deli or market does sandwiches, a nearby bakery or cafe has pastries. Look through the whole NEARBY list for anything that fits. Only bring up a place beyond the nearby list when nothing close fits at all, and then say clearly it is farther. Never reach across town for a "perfect name match" when a close spot also has what they want.
- Recommend 2 to 3 options at most, each with a short reason it fits and its neighborhood. For a broad ask (best tacos, what to do this weekend), you may also add the matching SECTION page link.
- You do NOT have live hours or open/closed status. Never say a place is "open now", "closed", "open late", or state any hours as fact, even if a listing blurb hints at it. Instead say something like "check their hours before you go". If someone asks what is open right now, explain you cannot see live hours and suggest they call the place or check the map.
- You can only chat here. Never offer to call a business, book a table, check hours, or do anything outside this conversation. When someone needs hours, a quote, wait times, or a reservation, give them the listed phone number and tell them to contact the place directly. Only give a phone number that appears in THE GUIDE. If a place has NO phone in the guide, do not write a call line at all and never write a placeholder like "call them at (no phone listed)"; instead give the address and say to stop by, or suggest looking them up on Google.
- If the request is vague, ask ONE short clarifying question first (what kind of place, which neighborhood, or the vibe).
- Warm, local, and concise, like a friend who knows the town. Short sentences. No em-dashes. No hype or marketing buzzwords.
- Format each place as a markdown link to its map: [Name] followed by the exact MAPS url shown for that place in THE GUIDE, in parentheses, then its Neighborhood, one short reason, and the phone number for a service someone will call. Format a section as [Page title] then its /url in parentheses. ALWAYS use the real MAPS url copied from the data. NEVER write a placeholder like "https://maps-url", and NEVER narrate a correction or your own process to the visitor (no "wait, let me use the real one", no "let me fix that"); just write the finished, clean answer.

THE GUIDE (name | type | area | address | phone | price | about | optional DEAL (a free perk, only if shown) | MAPS url to use for the link):
${LIST}

SECTIONS (guide pages you may link as [title](/url)):
${SECTIONS}`;

// ---- Proximity: rank by REAL distance when we can tell where the visitor is ----
const coordPlaces = places.filter(p => typeof p.lat === 'number' && typeof p.lng === 'number');

function haversineMi(aLat, aLng, bLat, bLng) {
  const R = 3958.8, toRad = d => d * Math.PI / 180;
  const dLat = toRad(bLat - aLat), dLng = toRad(bLng - aLng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.asin(Math.min(1, Math.sqrt(s)));
}

// Base neighborhood -> centroid, so "I'm in Shoreview" becomes a real map anchor.
const centroids = (() => {
  const groups = {};
  for (const p of coordPlaces) {
    if (!p.area) continue;
    const key = p.area.toLowerCase().replace(/\(.*?\)/g, '').trim(); // "Downtown (B St)" -> "downtown"
    if (key) (groups[key] = groups[key] || []).push(p);
  }
  return Object.entries(groups).map(([key, ps]) => ({
    key,
    lat: ps.reduce((s, p) => s + p.lat, 0) / ps.length,
    lng: ps.reduce((s, p) => s + p.lng, 0) / ps.length,
  })).sort((a, b) => b.key.length - a.key.length); // prefer the most specific name match
})();

const NBHD_ALIASES = [{ say: '25th ave', key: '25th avenue' }];

// Words too generic to identify a place by, so "Norfolk Auto" still matches
// "Norfolk Auto Service", a lone "restaurant" never anchors anything, and a
// common phrase like "how about" never latches onto a business named that.
const NAME_STOP = new Set([
  // business-name filler
  'the', 'and', 'of', 'san', 'mateo', 'ca', 'inc', 'llc', 'co',
  'service', 'services', 'restaurant', 'cafe', 'coffee', 'shop', 'store', 'bar', 'grill',
  'kitchen', 'company', 'taqueria', 'pizza', 'market', 'deli', 'house', 'gourmet',
  // everyday query words a visitor types (must never be an anchor signal)
  'how', 'about', 'near', 'nearby', 'good', 'great', 'best', 'place', 'places', 'where',
  'some', 'something', 'need', 'want', 'looking', 'find', 'get', 'there', 'here', 'have',
  'open', 'right', 'now', 'today', 'tonight', 'this', 'that', 'area', 'spot', 'spots',
  'food', 'eat', 'drink', 'close', 'closest', 'option', 'options', 'around', 'you', 'tell',
  'please', 'thanks', 'grab', 'bite', 'from', 'for', 'with', 'any', 'anything']);

// How strongly the visitor's text names this place. Requires TWO distinctive words
// so a food word ("sandwiches") never anchors on a business named for it ("Village
// Sandwich"); a real reference like "Norfolk Auto" has two and still matches.
function anchorScore(name, text) {
  const words = name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ')
    .filter(w => w.length >= 3 && !NAME_STOP.has(w));
  if (words.length < 2) return 0;
  const matched = words.filter(w => text.includes(w));
  if (matched.length >= 2) return 100 + matched.reduce((s, w) => s + w.length, 0);
  return 0;
}

// Detect a location in ONE message: a listed place they named, or a neighborhood.
function anchorFromText(raw) {
  const text = String(raw || '').toLowerCase();

  let best = null, bestScore = 0; // a specific listed place ("near Norfolk Auto")
  for (const p of coordPlaces) {
    const s = anchorScore(p.name, text);
    if (s > bestScore) { bestScore = s; best = p; }
  }
  if (best) return { label: best.name, lat: best.lat, lng: best.lng };

  for (const a of NBHD_ALIASES) {                          // a neighborhood ("I'm in Shoreview")
    if (text.includes(a.say)) {
      const c = centroids.find(c => c.key === a.key);
      if (c) return { label: 'the ' + a.key + ' area', lat: c.lat, lng: c.lng };
    }
  }
  for (const c of centroids) {
    if (c.key.length >= 5 && text.includes(c.key)) return { label: 'the ' + c.key + ' area', lat: c.lat, lng: c.lng };
  }
  return null;
}

// A street or place the visitor typed that is not a listing or known neighborhood
// (e.g. "Echo Avenue"). Read in original case so the geocoder has the real name.
const LOC_FILLER = new Set(['anywhere', 'somewhere', 'close', 'closest', 'near', 'nearby',
  'to', 'by', 'around', 'right', 'off', 'next', 'the', 'a', 'an', 'on', 'in', 'at', 'is',
  'are', 'there', 'any', 'i', 'im', 'need', 'want', 'looking', 'for', 'me', 'my', 'get',
  'find', 'something', 'place', 'places', 'good', 'great', 'best', 'can', 'you', 'do', 'up']);
function cleanPhrase(p) {
  const w = String(p).trim().replace(/[?.!,]+$/, '').split(/\s+/);
  while (w.length > 1 && LOC_FILLER.has(w[0].toLowerCase().replace(/[^a-z]/g, ''))) w.shift();
  return w.join(' ').trim();
}
function extractLocationPhrase(raw) {
  const t = String(raw || '');
  // Prefer the "...on/near/live on <place>" pattern FIRST: it isolates just the
  // street name. The bare street-suffix matcher below would otherwise greedily
  // swallow the lead-in words ("I live on Patricia Ave" -> "live on patricia ave"),
  // which no exact lookup can resolve.
  const prep = t.match(/\b(?:closest to|close to|near|right by|next to|over on|live on|i'?m on|i am on|i live on|on|at|by|around|off|called)\s+(?:\d+\s+)?([A-Za-z][A-Za-z0-9'. ]{2,28})/i);
  if (prep) {
    const p = cleanPhrase(prep[1].replace(/\b(where|what|which|is|are|can|could|please|do|you|there|any|anything|open|now|looking|for|and|but|the|a|an)\b.*$/i, ''));
    if (p.length >= 3) return { phrase: p, confident: true }; // explicit "on/near <place>" = they mean THIS place
  }
  const street = t.match(/\b([A-Za-z0-9]+(?:\s+[A-Za-z0-9]+){0,3}\s+(?:Ave|Avenue|St|Street|Blvd|Boulevard|Rd|Road|Dr|Drive|Way|Ln|Lane|Ct|Court|Pl|Place|Hwy|Highway|Real|Parkway|Pkwy|Circle|Cir|Terrace|Ter)\.?)\b/i);
  if (street) { const c = cleanPhrase(street[1]); if (c.length >= 3) return { phrase: c, confident: false }; } // bare suffix match, weaker (can be "cross street")
  return null;
}

// Built-in gazetteer of every named San Mateo street (built offline by
// scripts/build-streets.mjs from OpenStreetMap). Looked up instantly and
// reliably, instead of calling a live geocoder that Vercel's IPs get throttled
// on ~60% of the time. Rebuild after boundary/street changes; it rarely changes.
const { streets: STREETS, long: LONG_ARR } = require('../streets.json');
const LONG_STREETS = new Set(LONG_ARR || []); // known streets too long to anchor from a midpoint (El Camino etc.)
const SUF = { avenue: 'ave', av: 'ave', ave: 'ave', street: 'st', st: 'st', boulevard: 'blvd', blvd: 'blvd', road: 'rd', rd: 'rd', drive: 'dr', dr: 'dr', lane: 'ln', ln: 'ln', court: 'ct', ct: 'ct', place: 'pl', pl: 'pl', way: 'way', circle: 'cir', cir: 'cir', terrace: 'ter', ter: 'ter', parkway: 'pkwy', pkwy: 'pkwy', highway: 'hwy', hwy: 'hwy', real: 'real' };
const DIRW = { north: 'n', south: 's', east: 'e', west: 'w', n: 'n', s: 's', e: 'e', w: 'w' };
const SUFSET = new Set(Object.values(SUF));
const DIRSET = new Set(Object.values(DIRW));
function normStreet(name) {
  const w = String(name).toLowerCase().replace(/[.,]/g, '').replace(/\s+/g, ' ').trim().split(' ');
  if (SUF[w[w.length - 1]]) w[w.length - 1] = SUF[w[w.length - 1]];
  if (w.length > 1 && DIRW[w[0]]) w[0] = DIRW[w[0]];
  return w.join(' ');
}
// Look a typed street up in the gazetteer, trying the full name then the same
// shorter forms the build script keyed on (drop suffix, drop direction).
function streetLookup(phrase) {
  let words = normStreet(phrase).split(' ').filter(Boolean);
  if (words.length > 1 && /^\d+$/.test(words[0])) words = words.slice(1); // drop a leading house number ("957 patricia" -> "patricia")
  // Try the phrase, then drop trailing words one at a time, so "patricia ave at the
  // moment" -> "patricia ave" and "el camino real near hillsdale" -> "el camino real".
  for (let len = words.length; len >= 1; len--) {
    const w = words.slice(0, len);
    const q = w.join(' ');
    if (STREETS[q]) return STREETS[q];
    if (w.length > 1 && SUFSET.has(w[w.length - 1]) && STREETS[w.slice(0, -1).join(' ')]) return STREETS[w.slice(0, -1).join(' ')];
    if (w.length > 1 && DIRSET.has(w[0]) && STREETS[w.slice(1).join(' ')]) return STREETS[w.slice(1).join(' ')];
    if (LONG_STREETS.has(q)) return 'LONG'; // known street, too long to anchor
  }
  return null;
}

// Geocode a typed location to coordinates, once. The gazetteer answers first;
// a live OpenStreetMap (Nominatim) call is only a rare fallback for anything not
// in it. Clamped to the San Mateo area so a same-named street elsewhere never matches.
const geoCache = new Map();
const ST_SUFFIX = /\b(ave|avenue|st|street|blvd|boulevard|rd|road|dr|drive|way|ln|lane|ct|court|pl|place|hwy|highway|real|parkway|pkwy|circle|cir|terrace|ter)\.?$/i;
async function geocodeOnce(q) {
  try {
    const url = 'https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=us&q='
      + encodeURIComponent(q + ', San Mateo, California');
    const r = await fetch(url, {
      headers: { 'User-Agent': 'SanMateoLocal/1.0 (jason@sanmateolocal.com)' },
      signal: AbortSignal.timeout(4000),
    });
    if (!r.ok) return null;
    const j = await r.json();
    if (!Array.isArray(j) || !j.length) return null;
    const lat = +j[0].lat, lng = +j[0].lon;
    const inSanMateo = /,\s*san mateo\s*,/i.test(j[0].display_name || ''); // the CITY, not just "San Mateo County"
    if (inSanMateo && lat >= 37.51 && lat <= 37.60 && lng >= -122.36 && lng <= -122.25) return { lat, lng };
    return null;
  } catch (e) { return null; }
}
async function geocodeLocation(query) {
  const key = query.toLowerCase();
  if (geoCache.has(key)) return geoCache.get(key);
  // 1) Gazetteer first: instant, reliable, no network. Covers 750+ San Mateo streets.
  let result = streetLookup(query);
  // A known-but-too-long street (El Camino): don't geocode it live (that would pin an
  // arbitrary point on a 5-mile street). Signal LONG so the guide asks for a cross street.
  if (result === 'LONG') { geoCache.set(key, 'LONG'); return 'LONG'; }
  // 2) Rare fallback for anything not in the gazetteer: a live lookup. If it already
  // has a street suffix, one call; a bare name tries the common street types.
  if (!result) {
    const variants = ST_SUFFIX.test(query.trim()) ? [query] : [query + ' Ave', query + ' St', query + ' Dr', query + ' Blvd'];
    for (const v of variants) { result = await geocodeOnce(v); if (result) break; }
  }
  geoCache.set(key, result);
  return result;
}

// Injected when we genuinely cannot place the visitor, so the model stops fabricating.
const NO_LOCATION = `NO LOCATION: you could not place where the visitor is, so for THIS reply you have NO distances and NO neighborhood for them. Hard rules: never call any place close, nearby, convenient, "your best bet", or "a short drive", never state OR ESTIMATE a distance in miles or minutes for ANY place (not "0.34 mi", not "0.00 mi", not "about a mile", not "a 7-minute drive"), never give two places the same made-up distance, never say a place is "right here" or "at your location", and never name or guess which neighborhood their street is in. If they want something nearby, tell them plainly you cannot judge distance yet and ask which neighborhood they are in (Downtown, Shoreview, Hayward Park, Baywood, San Mateo Park, North Central, Los Prados, Bay Meadows, Hillsdale), or, if they named a long street like El Camino Real, ask for a nearby cross street or landmark so you can pin them down; you may still offer a couple of solid options meanwhile. If they are NOT asking about proximity, just recommend good options normally.`;

// Where is the visitor? The most recent location they gave, carried across turns.
// First a listed place or known neighborhood; if none, a street/place they typed,
// geocoded live. The most recent location of any kind wins.
async function detectAnchor(clean) {
  for (const m of [...clean].reverse()) {
    if (m.role !== 'user') continue;
    const known = anchorFromText(m.content);
    if (known) return known;
    const loc = extractLocationPhrase(m.content);
    if (loc) {
      const geo = await geocodeLocation(loc.phrase);
      if (geo && geo.lat) return { label: loc.phrase, lat: geo.lat, lng: geo.lng };
      // A known street too long to anchor (El Camino): stop and let NO_LOCATION ask
      // for a cross street, rather than guess a midpoint.
      if (geo === 'LONG') return null;
      // They clearly named a place ("on B Street") we could not map. Do NOT fall
      // back to an OLDER street from earlier in the chat, that answers the wrong
      // location. Stop so NO_LOCATION asks them to clarify THIS one. A weak
      // suffix-only guess ("cross street") is allowed to fall through.
      if (loc.confident) return null;
    }
    // A short bare reply that IS a known street ("Newbridge", "Beacon", "957 Patricia"),
    // with no "on/near" cue. Gazetteer-only (no live geocode), and only when the whole
    // message is short, so an ordinary sentence never accidentally matches a street word.
    const bareWords = cleanPhrase(m.content).split(' ').filter(Boolean);
    if (bareWords.length >= 1 && bareWords.length <= 3) {
      const bare = streetLookup(bareWords.join(' '));
      if (bare && bare.lat) return { label: bareWords.join(' '), lat: bare.lat, lng: bare.lng };
      if (bare === 'LONG') return null;
    }
  }
  return null;
}

// Is a Featured partner within reach of the visitor? If so, this reply uses the smarter
// (slower) model so the paid top-slot and its honest "even closer" note are exactly right.
function featuredNear(anchor) {
  return !!anchor && coordPlaces.some(p => isFeatured(p) && haversineMi(anchor.lat, anchor.lng, p.lat, p.lng) <= 1.5);
}

function proximityBlock(anchor) {
  const ranked = coordPlaces
    .map(p => ({ p, mi: haversineMi(anchor.lat, anchor.lng, p.lat, p.lng) }))
    .sort((a, b) => a.mi - b.mi);
  let near = ranked.filter(r => r.mi <= 1.5).slice(0, 24);
  if (near.length < 8) near = ranked.slice(0, 12); // sparse area: just take the nearest dozen
  const lines = near.map((r, i) => `${i + 1}. ${isFeatured(r.p) ? '[FEATURED PARTNER] ' : ''}${r.p.name} | ${r.p.cat} | ${r.p.type || r.p.cat} | ${r.mi.toFixed(2)} mi | ${(r.p.about || '').replace(/\s+/g, ' ').trim()}`).join('\n');
  return `NEARBY LIST (internal, from ${anchor.label}; each line is: number. name | category | type | REAL distance in miles | description). It is ALREADY SORTED closest-first: line 1 is the closest place, and distance only increases down the list. This is the ONLY source of truth for anything about close, nearby, near me, walking distance, or "closest". Never mention this list or name any internal data; just speak like a local who knows the town. You ALREADY know where the visitor is (${anchor.label}); do NOT ask them for their neighborhood or nearest cross street again, just give the closest options with confidence. IMPORTANT: even if EARLIER in this same conversation you said you could not place them or could not calculate distance, that is no longer true, you CAN now. Do not repeat that you cannot judge distance, do not tell them to check the map themselves, and do not apologize for not knowing, just answer with the real distances below.

HOW TO ANSWER A NEARBY REQUEST:
1. Match what they asked for to BOTH the type AND the description, NOT just the name. The description is what a place actually offers: if it names the item, that place fits, even if the type does not (Aldo's Pizza "also serves sandwiches" fits a sandwich ask; Ay Caray's "tortas (Mexican sandwiches)" fits; a cleaner whose description says "alterations" does alterations). Also, a dedicated deli, a taqueria, or a food market can do a sandwich, and a bakery or cafe has pastries, even if not spelled out. A SHOPPING place absolutely counts as a real food option WHEN its description names the prepared food it makes (a Mexican market whose description says "on-site taqueria serving tacos and burritos" IS a taco spot, a bakery counter has pastries), so include it and rank it by distance like anything else, even if it is the closest. Only refuse to treat a place as a food spot when it is a liquor store, convenience store, or general grocery whose description does NOT say it makes that food, a corner "deli" license is not a sandwich counter. When they ask for a SPECIFIC food or item (pizza, sushi, a burger, coffee, a haircut), the place you lead with MUST actually provide THAT, do not stretch a nearby place to fit: a donut and ice cream shop is NOT a pizza spot, and never call a place "a [pizza/sushi/etc] spot" when its type and description say otherwise. If the closest places do not serve what they asked for, do not force them, just name the closest ones that genuinely DO, even if they are a little farther, and you can add "the closest food to you is X, but for actual pizza your nearest is Y". READ every nearby line's description before answering.
2. STRICT ORDER: walk DOWN the list from line 1 and pick the first 2 or 3 that fit. Present them in that same order. The place you name FIRST must be the lowest-numbered one that fits, and you must NEVER present a higher-numbered place above a lower-numbered one that also fits. Only ever call something "the closest" if no lower-numbered line also fits. Before you send your answer, double check the one you called closest truly has the smallest distance among the ones you named.
3. Copy each distance EXACTLY as written on its line (for example "0.21 mi"); never round it to a different number, average it, or invent one. (Two places genuinely near each other CAN show the same distance, that is fine, just copy what the line says.) NEVER say a place is "0.00 mi", "right here", "at your location", or "where you are", the visitor is NEAR these places, not standing inside one.
4. Under 0.4 mi is an easy walk; 0.4 to 1 mi a longer walk or short drive; over 1 mi, suggest driving.
5. Only places ON this list have a known distance. NEVER present a place that is not on this list as close, convenient, nearby, or a short drive, and NEVER state or guess a distance for an off-list place. If the only real fit is far, say plainly it is a drive and to check the map. Inventing or estimating a distance is never allowed.
6. FEATURED PARTNERS (be transparent): a line tagged [FEATURED PARTNER] is a San Mateo Local featured business. WHEN a featured place genuinely fits what they asked for AND is close (within about 0.5 mi), give it the FIRST recommendation with its full, appealing description, and say plainly it is "a San Mateo Local featured spot" so the visitor knows it is a promoted pick. THEN, if another fitting place is even closer, name it honestly right after, for example "and if you want something a touch closer, [name] is [x] mi away." GUARDRAILS you must NEVER break: do not lead with a featured place that does not fit the request or is not close; never put a featured place ahead of a fitting place that is MORE THAN 0.2 mi closer (in that case lead with the closer place and you may mention the featured one second); feature at most ONE place per answer. If no featured place both fits and is close, ignore the tag completely and answer purely by distance. The honesty is the point: a featured pick is only ever worth showing because the guide is trusted.

${lines}`;
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  return Buffer.concat(chunks).toString('utf8');
}

module.exports = async (req, res) => {
  res.setHeader('x-smc-build', 'gaz-18'); // lightweight deploy marker for quick "which build is live" checks
  if (req.method !== 'POST') { res.status(405).json({ error: 'POST only' }); return; }
  if (!process.env.ANTHROPIC_API_KEY) { res.status(503).json({ error: 'The concierge is not switched on yet.' }); return; }

  let messages, coords = null;
  try {
    const body = JSON.parse(await readBody(req));
    messages = Array.isArray(body.messages) ? body.messages : null;
    const c = body.coords; // GPS from "use my location", only trusted if it is inside the San Mateo area
    if (c && typeof c.lat === 'number' && typeof c.lng === 'number'
        && c.lat >= 37.50 && c.lat <= 37.61 && c.lng >= -122.40 && c.lng <= -122.24) {
      coords = { lat: c.lat, lng: c.lng };
    }
  } catch (e) { res.status(400).json({ error: 'bad request' }); return; }
  if (!messages || !messages.length) { res.status(400).json({ error: 'no messages' }); return; }

  // Keep only role + content, cap the history and each message so it stays cheap and safe.
  const clean = messages.slice(-12).map(m => ({
    role: m.role === 'assistant' ? 'assistant' : 'user',
    content: String(m.content || '').slice(0, 1000),
  })).filter(m => m.content);
  if (!clean.length) { res.status(400).json({ error: 'no messages' }); return; }

  // The big grounding block is identical every call, so cache it. When we can tell
  // where the visitor is, append a small, per-call block of real computed distances.
  // GPS coords (from "use my location") are the most reliable anchor for "near me"
  // asks and skip all street-name guessing. An explicit place in the LATEST message
  // still wins (they are asking about somewhere else on purpose); if text detection
  // finds nothing, fall back to GPS.
  const gpsAnchor = coords ? { label: 'your location', lat: coords.lat, lng: coords.lng } : null;
  const lastUser = [...clean].reverse().find(m => m.role === 'user');
  const lastNamesPlace = lastUser && (anchorFromText(lastUser.content) || extractLocationPhrase(lastUser.content));
  let anchor;
  if (gpsAnchor && !lastNamesPlace) anchor = gpsAnchor;
  else anchor = (await detectAnchor(clean)) || gpsAnchor;
  const system = [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }];
  system.push({ type: 'text', text: anchor ? proximityBlock(anchor) : NO_LOCATION });
  const model = featuredNear(anchor) ? SONNET : HAIKU; // fast Haiku by default, precise Sonnet only near a Featured partner

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model,
        max_tokens: 1500,
        system,
        messages: clean,
      }),
    });
    if (!r.ok) {
      console.error('anthropic', r.status, await r.text());
      res.status(502).json({ error: 'The concierge had a hiccup. Try again in a moment.' });
      return;
    }
    const data = await r.json();
    // Find the TEXT block: Sonnet emits a leading `thinking` block, so the answer is
    // not content[0]. Join all text blocks in case there is more than one.
    const textBlocks = Array.isArray(data.content) ? data.content.filter(b => b && b.type === 'text' && b.text) : [];
    let reply = textBlocks.map(b => b.text).join('\n').trim() || 'Sorry, I did not catch that. What are you looking for?';
    reply = reply.replace(/\s*[—―]\s*/g, ', '); // strip em-dashes (U+2014/2015): the voice rule, enforced even when the model ignores it
    res.status(200).json({ reply });
  } catch (e) {
    console.error('concierge error', e.message);
    res.status(500).json({ error: 'The concierge is having a moment. Try again shortly.' });
  }
};
