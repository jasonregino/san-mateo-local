// San Mateo Local - Conversational Growth Review (owner diagnostic), v2.
//
// A Vercel serverless function at /api/growth-review. Two steps, value BEFORE capture:
//   step "analyze": given a business name (+ optional website + goal), it actually
//     LOOKS at the business (live Google lookup + our directory) and returns a short,
//     specific, HONEST mini-review. No contact info asked yet.
//   step "submit": after the owner has seen findings and opted in, fires the lead ONCE
//     to BCM's GHL "Growth Review - Chat Intake" webhook.
//
// The one-question-at-a-time wizard UX lives on growth-review.html. This endpoint is
// the brain: the real investigation is the product; the wizard is the delivery.
//
// Env: ANTHROPIC_API_KEY (required). GOOGLE_MAPS_API_KEY (optional; enables the live
//      Google lookup, best-effort with graceful fallback). GROWTH_REVIEW_WEBHOOK_URL
//      (optional; falls back to the live BCM endpoint).

const DATA = require('../growth-data.json');
const HAIKU = 'claude-haiku-4-5-20251001';
const MAPS_KEY = process.env.GOOGLE_MAPS_API_KEY;
const WEBHOOK = process.env.GROWTH_REVIEW_WEBHOOK_URL
  || 'https://services.leadconnectorhq.com/hooks/qzIoV5UQJF7FjTNGrv5p/webhook-trigger/1feaabc4-5a8b-42d2-b2bf-904fec5865a2';

// ---- Match the owner's business in our directory ----
const STOP = new Set(['the', 'and', 'of', 'san', 'mateo', 'ca', 'inc', 'llc', 'co', 'studio',
  'cafe', 'coffee', 'shop', 'store', 'bar', 'grill', 'kitchen', 'company', 'salon', 'spa',
  'pilates', 'yoga', 'gym', 'fitness', 'hair', 'nails', 'dental', 'clinic', 'center', 'group',
  'services', 'service', 'restaurant', 'pizza', 'taqueria', 'market', 'deli', 'house', 'bakery',
  'auto', 'repair', 'care', 'a', 'on', 'llp', 'dds', 'md']);
function distinctive(name) {
  return String(name).toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/)
    .filter(w => w.length >= 3 && !STOP.has(w));
}
function matchBusiness(name) {
  const t = ' ' + String(name).toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ') + ' ';
  let best = null, bestScore = 0;
  for (const b of DATA) {
    const dw = distinctive(b.name);
    if (!dw.length) continue;
    const hits = dw.filter(w => t.includes(' ' + w + ' '));
    if (!hits.length) continue;
    const coverage = hits.length / dw.length;
    const strong = (hits.length >= 2 && coverage >= 0.5) || (dw.length === 1 && dw[0].length >= 4);
    if (!strong) continue;
    const score = hits.reduce((s, w) => s + w.length, 0) + hits.length * 2 + coverage * 3;
    if (score > bestScore) { bestScore = score; best = b; }
  }
  return best;
}

// Is what Google resolved ESSENTIALLY the same name the owner typed? We confirm on any
// real difference, not just distant ones, so "Yum yogurt" -> "Yumi Yogurt" still asks
// first. A one-tap confirm on a correct match costs nothing; a silent near-miss costs
// all trust (it would state a stranger's or a near-miss's rating as theirs).
function essentiallySame(a, b) {
  const n = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  a = n(a); b = n(b);
  if (!a || !b) return false;
  if (a === b) return true;
  // they typed a distinctive chunk of the real name ("Ironwood" -> "Ironwood Hair Company")
  if (a.length >= 6 && b.indexOf(a) === 0) return true;
  if (b.length >= 6 && a.indexOf(b) === 0) return true;
  return false;
}
const titleCase = s => String(s || '').replace(/\b\w/g, c => c.toUpperCase());

// ---- Live Google lookup (best-effort; graceful fallback if key/API unavailable) ----
async function googleLookup(name) {
  if (!MAPS_KEY) return { status: 'NO_KEY' };
  try {
    const q = encodeURIComponent(name + ' San Mateo CA');
    const ts = await fetch(`https://maps.googleapis.com/maps/api/place/textsearch/json?query=${q}&key=${MAPS_KEY}`, { signal: AbortSignal.timeout(6000) });
    const tj = await ts.json();
    if (tj.status !== 'OK' || !tj.results || !tj.results.length) return { status: tj.status || 'NOT_FOUND' };
    const pid = tj.results[0].place_id;
    const fields = 'name,rating,user_ratings_total,website,business_status';
    const de = await fetch(`https://maps.googleapis.com/maps/api/place/details/json?place_id=${pid}&fields=${fields}&key=${MAPS_KEY}`, { signal: AbortSignal.timeout(6000) });
    const dj = await de.json();
    if (dj.status !== 'OK') return { status: dj.status };
    const d = dj.result || {};
    return {
      status: 'OK',
      name: d.name || name,
      rating: typeof d.rating === 'number' ? d.rating : null,
      reviews: typeof d.user_ratings_total === 'number' ? d.user_ratings_total : null,
      website: d.website || null,
      businessStatus: d.business_status || null,
    };
  } catch (e) { return { status: 'ERROR' }; }
}

// ---- Assemble the real, honest facts for the model + a deterministic reviewer note ----
function buildFacts(name, ownerWebsite, goal, dir, g) {
  const L = [];
  L.push(`Business the owner named: ${name}`);
  if (goal) L.push(`What they said they want to improve: ${goal}`);
  const noSite = /^(no|none|n\/a|i don'?t|dont|no website|nope)/i.test(String(ownerWebsite || '').trim());
  if (ownerWebsite && !noSite) L.push(`Website the owner gave: ${ownerWebsite}`);
  else if (noSite) L.push(`Owner says they do NOT have a website.`);

  if (g && g.status === 'OK') {
    L.push(`GOOGLE (live, real): found on Google Maps as "${g.name}".`);
    L.push(`- Google rating: ${g.rating != null ? g.rating : 'none yet'}${g.reviews != null ? ` from ${g.reviews} review${g.reviews === 1 ? '' : 's'}` : ''}.`);
    L.push(`- Website linked on their Google listing: ${g.website ? g.website : 'none linked'}.`);
    if (g.businessStatus && g.businessStatus !== 'OPERATIONAL') L.push(`- Google business status: ${g.businessStatus}.`);
  } else if (g && (g.status === 'NOT_FOUND' || g.status === 'ZERO_RESULTS')) {
    L.push(`GOOGLE: could not find a Google Maps listing by that name (may be very new, or listed under a different name). Do not assert they have no Google presence; say you could not find one and it is worth confirming.`);
  } else {
    L.push(`GOOGLE: live lookup unavailable this time. Do NOT claim anything about their Google profile, rating, or reviews.`);
  }

  if (dir) {
    L.push(`SAN MATEO LOCAL: they ARE listed on our guide as ${dir.cat}${dir.type ? ' / ' + titleCase(dir.type) : ''}${dir.area ? ' in ' + dir.area : ''} (page ${dir.detail}).`);
    L.push(`- Website on file with San Mateo Local: ${dir.website ? 'yes' : 'no'}.`);
    L.push(`- Claimed by the owner on SAN MATEO LOCAL (not their Google profile): ${dir.claimed ? 'yes' : 'no'}.`);
    if (dir.reviews) L.push(`- Separate review signal on file (its own source, do not merge with Google's count): ${dir.reviews}.`);
    L.push(`Note: having a San Mateo Local page helps people who search locally find them, but do NOT claim a specific Google search ranking (we do not measure that).`);
  } else {
    L.push(`SAN MATEO LOCAL: they are NOT currently listed on our guide. That is a real, honest visibility gap you may raise gently (they are missing from the local guide people read).`);
  }
  return 'FACTS ABOUT THIS BUSINESS (state ONLY these; never invent beyond them):\n' + L.join('\n');
}

function buildNotes(name, goal, dir, g) {
  const parts = [];
  if (goal) parts.push(`Goal: ${goal}.`);
  if (g && g.status === 'OK') parts.push(`Google: ${g.rating != null ? g.rating + '★' : 'no rating'}${g.reviews != null ? '/' + g.reviews + ' reviews' : ''}, website ${g.website ? 'linked' : 'none'}.`);
  else if (g && (g.status === 'NOT_FOUND' || g.status === 'ZERO_RESULTS')) parts.push('Google: not found by name.');
  parts.push(dir ? `On SML (${dir.cat}${dir.type ? '/' + dir.type : ''}), website on file ${dir.website ? 'yes' : 'no'}, claimed ${dir.claimed ? 'yes' : 'no'}.` : 'Not listed on SML.');
  return ('Chat diagnostic. ' + parts.join(' ')).slice(0, 550);
}

const FINDINGS_SYSTEM = `You are the San Mateo Local growth guide. You have just looked at a local business. Write a short, warm, genuinely HONEST mini-review of how they show up online, based ONLY on the FACTS provided.

WRITE:
- 2 to 4 short observations, each on its own line, each prefixed with a plain checkmark and a space: "✓ ". Do NOT use decorative or colorful emoji (no star, globe, pin, lightbulb); keep it clean and professional.
- Then one final line prefixed with "→ " that begins "The biggest opportunity: " and names the SINGLE highest-impact GROWTH move, chosen by likely REVENUE impact (what brings more customers or gets them found by people ready to buy).
- ABSOLUTE RULE: the "→ The biggest opportunity" line must NEVER be a San Mateo Local action (never "claim", "complete", "get on", or "get listed on" San Mateo Local), for ANY business. That is off-limits for this line. A San Mateo Local action may appear only as a small "✓" observation, and if they are not listed yet, phrase it "get listed on San Mateo Local" (never "get on your listing").
- If after the facts the only thing left is a San Mateo Local action, there is NO major growth gap: for the opportunity line, say plainly they are in strong shape and name the most real non-SML next step, however small (for example "→ The biggest opportunity: you are in good shape online, so the main thing is keeping fresh reviews coming in").
- If this is clearly a national or regional CHAIN (a brand with many locations, like Trader Joe's, Starbucks, McDonald's), do not treat the visitor as running the brand's website or web presence and do not push a San Mateo Local listing; keep it brief and note the Growth Review is really built for independent, locally owned businesses.
- Keep the whole thing tight: a few lines, plain language, no fluff.

HONESTY (this is the entire point, non-negotiable):
- State ONLY what the FACTS say. Never invent a problem, a number, a rating, or a gap to manufacture urgency.
- If something is strong, SAY SO plainly. Balance praise with the real opportunity.
- If Google data is missing or the business was not found, do NOT claim anything about their Google profile.
- Attribute every number to ONE named source and keep it consistent within your reply: a Google review count is Google's, a Yelp signal is Yelp's. Never merge them into one total or restate the same count as if it came from several places.
- Never ASK the owner a question; this step has no reply box, so state everything. If what the owner told you conflicts with what you find (they said no website but one is linked on Google), reconcile it as a gentle STATEMENT, not a question: for example "Your Google listing points to a website; if that is outdated or hard to find, it is worth a look." Never bluntly contradict them.
- When a listing is unclaimed, always say "your San Mateo Local listing" so it is not confused with their Google profile.
- Do not claim a specific search ranking. You may note that having (or missing) a San Mateo Local page affects local discovery.
- You are giving a quick first look, not the full review. Do not ask for their email or any contact info; the page handles that next.

STYLE: warm, local, concrete. No em-dashes. No hype or buzzwords. Speak to the owner directly ("you", "your").`;

async function fireWebhook(input) {
  const digits = String(input.phone || '').replace(/\D/g, '');
  const phone = digits ? (digits.length === 10 ? '+1' + digits : '+' + digits) : '';
  const payload = {
    business_name: input.business_name || '', business_type: input.business_type || '',
    main_concern: input.main_concern || '', chat_notes: input.chat_notes || '',
    first_name: input.first_name || '', email: input.email || '', phone,
    source: 'SML Chat Growth Review',
  };
  const r = await fetch(WEBHOOK, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload), signal: AbortSignal.timeout(8000),
  });
  if (!r.ok) throw new Error('webhook ' + r.status);
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  return Buffer.concat(chunks).toString('utf8');
}
const stripDash = s => String(s).replace(/\s*[—―]\s*/g, ', ');

module.exports = async (req, res) => {
  res.setHeader('x-smc-build', 'gr-7');
  if (req.method !== 'POST') { res.status(405).json({ error: 'POST only' }); return; }

  let body;
  try { body = JSON.parse(await readBody(req)); }
  catch (e) { res.status(400).json({ error: 'bad request' }); return; }

  // ---- STEP: submit the earned lead ----
  if (body.step === 'submit') {
    const business_name = String(body.business_name || '').slice(0, 80).trim();
    const first_name = String(body.first_name || '').slice(0, 60).trim();
    const email = String(body.email || '').slice(0, 254).trim();
    if (!business_name || !first_name || !email) { res.status(400).json({ error: 'missing business_name, first_name, or email' }); return; }
    if (/[<>]/.test(email) || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]{2,}$/.test(email)) { res.status(400).json({ error: 'invalid email' }); return; }
    const dir = matchBusiness(business_name);
    try {
      await fireWebhook({
        business_name, first_name, email,
        business_type: dir ? dir.type : '',
        main_concern: String(body.goal || '').slice(0, 120),
        chat_notes: String(body.notes || '').slice(0, 600),
      });
    } catch (e) { console.error('growth webhook', e.message); } // lead acknowledged; logged for follow-up
    res.status(200).json({ ok: true });
    return;
  }

  // ---- STEP: analyze the business, return honest findings (value before capture) ----
  if (!process.env.ANTHROPIC_API_KEY) { res.status(503).json({ error: 'The growth guide is not switched on yet.' }); return; }
  const confirmed = body.confirmed === true;
  const name = String(body.business_name || '').slice(0, 80).trim();
  const website = String(body.website || '').slice(0, 200).trim();
  const goal = String(body.goal || '').slice(0, 200).trim();
  if (!name) { res.status(400).json({ error: 'no business name' }); return; }

  const g = await googleLookup(name);
  const dirInput = matchBusiness(name);
  // Also match the directory on Google's corrected name, so a typo like "Yum yogurt"
  // still resolves to the real "Yumi Yogurt" listing.
  const dir = dirInput || (g && g.status === 'OK' && g.name ? matchBusiness(g.name) : null);

  // Identity gate: confirm before findings whenever Google resolved to a name that is not
  // ESSENTIALLY what they typed. Fires on near-misses too ("Yum yogurt" -> "Yumi Yogurt"),
  // so a stranger's or a near-miss's numbers are never asserted as theirs without a nod.
  if (!confirmed && g && g.status === 'OK' && g.name && !essentiallySame(name, g.name)) {
    res.status(200).json({ needsConfirm: true, resolvedName: g.name });
    return;
  }

  const facts = buildFacts(name, website, goal, dir, g);
  const notes = buildNotes(name, goal, dir, g);

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: HAIKU, max_tokens: 500,
        system: [{ type: 'text', text: FINDINGS_SYSTEM }],
        messages: [{ role: 'user', content: facts + '\n\nWrite the mini-review now.' }],
      }),
    });
    if (!r.ok) { console.error('anthropic', r.status, await r.text()); res.status(502).json({ error: 'The growth guide had a hiccup. Try again in a moment.' }); return; }
    const data = await r.json();
    const blocks = Array.isArray(data.content) ? data.content : [];
    let findings = stripDash(blocks.filter(b => b && b.type === 'text' && b.text).map(b => b.text).join('\n').trim());
    // H4 guard: the "->" biggest-opportunity line must NEVER pitch San Mateo Local. The
    // model games the prompt by pairing it in ("claim your SML listing AND fix X"), so we
    // deterministically swap any -> line that mentions San Mateo Local for an honest one
    // built from the real data (a website if they lack one, else "you are in good shape").
    const noSiteRe = /^(no|none|n\/a|i don'?t|dont|nope)/i;
    const hasSite = !!(g && g.status === 'OK' && g.website) || !!(dir && dir.website) || (!!website && !noSiteRe.test(website));
    const oppFallback = hasSite
      ? '→ The biggest opportunity: you are in good shape online. Keep fresh reviews coming in and reply to the ones you get, that is what keeps you ahead with local customers.'
      : '→ The biggest opportunity: a simple website, so the people who find you on Google have somewhere to learn more and book.';
    findings = findings.split('\n').map(l => (l.trim().charAt(0) === '→' && /san mateo local/i.test(l)) ? oppFallback : l).join('\n');
    res.status(200).json({ findings: findings || 'I took a look but could not pull much just yet. The full Growth Review will dig in properly.', notes });
  } catch (e) {
    console.error('growth-review error', e.message);
    res.status(500).json({ error: 'The growth guide is having a moment. Try again shortly.' });
  }
};
