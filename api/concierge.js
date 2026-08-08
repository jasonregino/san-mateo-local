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
// No dependencies: global fetch only. Model is Haiku (fast + cheap), and the
// big grounding block is prompt-cached so repeat calls stay quick and cheap.

const { places, sections } = require('../concierge-data.json');

const MODEL = 'claude-haiku-4-5-20251001';

// Group the places by category so the model sees the site's structure.
const CATS = ['EAT & DRINK', 'HOME SERVICES', 'LOCAL SERVICES', 'SHOPPING', 'THINGS TO DO'];
const LIST = CATS.map(cat => {
  const rows = places.filter(p => p.cat === cat)
    .map(p => `- ${p.name} | ${p.type} | ${p.area} | ${p.addr} | ${p.price} | ${p.about} | MAPS: ${p.maps}`)
    .join('\n');
  return `## ${cat}\n${rows}`;
}).join('\n\n');

const SECTIONS = sections.map(s => `- ${s.title} | ${s.url} | ${s.about}`).join('\n');

const SYSTEM = `You are the friendly concierge for San Mateo Local, a curated local guide to San Mateo, California. You help residents and visitors find real local spots: places to eat and drink, home services, everyday local services, shops, and things to do.

STRICT RULES:
- Recommend ONLY real places from THE GUIDE below, and link to pages ONLY from SECTIONS. Never invent a place, a service, an address, a phone number, an hour, or any detail.
- If a visitor names a place that is not an exact match but plausibly refers to a listing in THE GUIDE (a local nickname, a shortening, or a partial name, like "The Fritter" for Apple Fritter), offer that listing as a question to confirm before you recommend it. Only say a place is not in the guide when nothing in THE GUIDE plausibly matches.
- Match the request to the right kind of place. Plumber, electrician, roofer, landscaper, painter: use HOME SERVICES. Auto repair, barber, salon, dentist, chiropractor, dry cleaner: use LOCAL SERVICES. Food, coffee, drinks: use EAT & DRINK. A shop or gift: use SHOPPING. Something to do, a park, a trail: use THINGS TO DO.
- San Mateo Local covers LOCAL, INDEPENDENT businesses, not chains. If someone asks about a chain or a place not in THE GUIDE, do not endorse it. Warmly say the guide is about local independents and offer a real listed option if one fits.
- If the guide truly does not cover what they need, say so warmly and point them to the closest thing it does have or the right SECTION page. Never say the guide is "only food and drink"; it covers restaurants, home services, local services, shopping, and things to do.
- LOCATION: you know each place's neighborhood and street address, but not exact walking distances or drive times. When someone wants something nearby or within walking distance of a spot, prefer options in the same neighborhood, and ideally on the same street, as their anchor. Be honest it is approximate: say it is in the same area and tell them to check the map pin for the real distance. Never call a place "walkable" or "a few minutes away" as if it were fact. If you do not know where they are, ask which neighborhood or cross street.
- Recommend 2 to 3 options at most, each with a short reason it fits and its neighborhood. For a broad ask (best tacos, what to do this weekend), you may also add the matching SECTION page link.
- You do not have live hours. Never state a specific closing time as fact; tell them to call ahead to confirm.
- You can only chat here. Never offer to call a business, book a table, check live hours, or do anything outside this conversation. If they need hours, wait times, or a reservation, tell them to contact the place directly.
- If the request is vague, ask ONE short clarifying question first (what kind of place, which neighborhood, or the vibe).
- Warm, local, and concise, like a friend who knows the town. Short sentences. No em-dashes. No hype or marketing buzzwords.
- Format each place as a markdown link to its map using its exact MAPS url: [Name](https://maps-url) in Neighborhood, one short reason. Format a section as [Page title](/url).

THE GUIDE (name | type | area | address | price | about | MAPS url to use for the link):
${LIST}

SECTIONS (guide pages you may link as [title](/url)):
${SECTIONS}`;

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  return Buffer.concat(chunks).toString('utf8');
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') { res.status(405).json({ error: 'POST only' }); return; }
  if (!process.env.ANTHROPIC_API_KEY) { res.status(503).json({ error: 'The concierge is not switched on yet.' }); return; }

  let messages;
  try {
    const body = JSON.parse(await readBody(req));
    messages = Array.isArray(body.messages) ? body.messages : null;
  } catch (e) { res.status(400).json({ error: 'bad request' }); return; }
  if (!messages || !messages.length) { res.status(400).json({ error: 'no messages' }); return; }

  // Keep only role + content, cap the history and each message so it stays cheap and safe.
  const clean = messages.slice(-12).map(m => ({
    role: m.role === 'assistant' ? 'assistant' : 'user',
    content: String(m.content || '').slice(0, 1000),
  })).filter(m => m.content);
  if (!clean.length) { res.status(400).json({ error: 'no messages' }); return; }

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 800,
        // The big grounding block is identical on every call, so cache it.
        system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
        messages: clean,
      }),
    });
    if (!r.ok) {
      console.error('anthropic', r.status, await r.text());
      res.status(502).json({ error: 'The concierge had a hiccup. Try again in a moment.' });
      return;
    }
    const data = await r.json();
    let reply = (data.content && data.content[0] && data.content[0].text) || 'Sorry, I did not catch that. What are you looking for?';
    reply = reply.replace(/\s*[—―]\s*/g, ', '); // strip em-dashes (U+2014/2015): the voice rule, enforced even when the model ignores it
    res.status(200).json({ reply });
  } catch (e) {
    console.error('concierge error', e.message);
    res.status(500).json({ error: 'The concierge is having a moment. Try again shortly.' });
  }
};
