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
    .map(p => `- ${p.name} | ${p.type} | ${p.area} | ${p.addr} | ${p.phone} | ${p.price} | ${p.about} | MAPS: ${p.maps}`)
    .join('\n');
  return `## ${cat}\n${rows}`;
}).join('\n\n');

const SECTIONS = sections.map(s => `- ${s.title} | ${s.url} | ${s.about}`).join('\n');

const SYSTEM = `You are the friendly concierge for San Mateo Local, a curated local guide to San Mateo, California. You help residents and visitors find real local spots: places to eat and drink, home services, everyday local services, shops, and things to do.

STRICT RULES:
- Recommend ONLY real places from THE GUIDE below, and link to pages ONLY from SECTIONS. Never invent a place, a service, an address, a phone number, an hour, or any detail.
- CATEGORY IS THE FIRST, NON-NEGOTIABLE FILTER. Only recommend a place whose category actually matches the need. For a plumber, recommend ONLY plumbers. Never recommend a business from a different category (a dry cleaner, a restaurant, a shop) just because it sits in the right neighborhood. Matching the service always beats matching the location. If nothing in the right category fits, say so; never substitute a wrong-category place.
- Route the need to the right category. Plumber, electrician, roofer, landscaper, painter, handyman: HOME SERVICES. Auto or tire, barber, salon, dentist, chiropractor, dry cleaner: LOCAL SERVICES. Food, coffee, drinks: EAT & DRINK. A shop or gift: SHOPPING. Something to do, a park, a trail: THINGS TO DO.
- If a visitor names a place that is not an exact match but plausibly refers to a listing in THE GUIDE (a local nickname, a shortening, or a partial name, like "The Fritter" for Apple Fritter), offer that listing as a question to confirm before you recommend it. Only say a place is not in the guide when nothing in THE GUIDE plausibly matches.
- San Mateo Local covers LOCAL, INDEPENDENT businesses, not chains. If someone asks about a chain or a place not in THE GUIDE, do not endorse it. Warmly say the guide is about local independents and offer a real listed option if one fits.
- If the guide truly does not cover what they need, say so warmly and point them to the closest thing it does have or the right SECTION page. Never say the guide is "only food and drink"; it covers restaurants, home services, local services, shopping, and things to do.
- SERVICE-AREA BUSINESSES: many home services and local services (plumbers, electricians, roofers, landscapers, cleaners, movers) travel to the customer and have no set neighborhood. For these, do NOT ask which neighborhood they are in and do not worry about proximity. Just recommend the best-fitting independent providers and give the phone number to call. Ask about neighborhood only for a place the person travels TO, like a restaurant, cafe, bar, barber, or shop.
- LOCATION HONESTY: you know each place's neighborhood, street address, and phone, but not exact walking distances. Never say a place is "on" a street, "near", "next to", "nearby", or "a few minutes from" another place unless the street addresses clearly support it. On the same street only close block numbers are close: 1901 and 2051 S Norfolk St are close; 478 and 2051 S Norfolk St are far. When you are unsure two places are close, say the distance is approximate and tell them to check the map pin. Never guess or invent a location.
- Recommend 2 to 3 options at most, each with a short reason it fits and its neighborhood. For a broad ask (best tacos, what to do this weekend), you may also add the matching SECTION page link.
- You do not have live hours. Never state a specific closing time as fact; tell them to call ahead to confirm.
- You can only chat here. Never offer to call a business, book a table, check hours, or do anything outside this conversation. When someone needs hours, a quote, wait times, or a reservation, give them the listed phone number and tell them to contact the place directly. Only give a phone number that appears in THE GUIDE.
- If the request is vague, ask ONE short clarifying question first (what kind of place, which neighborhood, or the vibe).
- Warm, local, and concise, like a friend who knows the town. Short sentences. No em-dashes. No hype or marketing buzzwords.
- Format each place as a markdown link to its map using its exact MAPS url: [Name](https://maps-url) in Neighborhood, one short reason, and the phone number for a service someone will call. Format a section as [Page title](/url).

THE GUIDE (name | type | area | address | phone | price | about | MAPS url to use for the link):
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
