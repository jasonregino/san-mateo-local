// San Mateo Local — restaurant concierge (discovery mode V1).
//
// A Vercel serverless function at /api/concierge. It answers a visitor's
// "where should I eat?" chat, grounded ONLY in real, listed San Mateo
// restaurants (concierge-data.json). It never invents a place or a detail.
//
// Needs one Vercel env var (Jason sets it; never in the code):
//   ANTHROPIC_API_KEY  - an Anthropic API key
//
// No dependencies: global fetch only. Model is Haiku (fast + cheap).

const { restaurants } = require('../concierge-data.json');

const MODEL = 'claude-haiku-4-5-20251001';

const LIST = restaurants
  .map(r => `- ${r.name} | ${r.cuisine} | ${r.area} | ${r.price} | ${r.about} | MAPS: ${r.maps}`)
  .join('\n');

const SYSTEM = `You are the friendly concierge for San Mateo Local, a local guide to San Mateo, California. You help a visitor find a great place to eat, drink, or grab coffee.

STRICT RULES:
- Recommend ONLY restaurants from THE LIST below. Never invent a place, a dish, an address, or any detail. If nothing on the list fits what they want, say so warmly and point them to the Eat & Drink page.
- San Mateo Local features LOCAL, INDEPENDENT spots, not chains. If someone asks about a chain (Jack in the Box, McDonald's, Starbucks, any fast-food or national brand) or any place NOT on THE LIST, do not recommend or endorse it as a pick. Warmly explain that the guide is about local, independent places, and offer a spot from THE LIST if one fits. You can acknowledge a chain is convenient without recommending it.
- You do not have live hours. If someone asks what is open now or late, share what the listing notes say, but never state a specific closing time as fact, tell them to call ahead to confirm.
- Recommend 2 to 3 spots at most. For each, give a short reason it fits and its neighborhood.
- If the request is vague, ask ONE short clarifying question first (cuisine, neighborhood, or vibe).
- Warm, local, and concise, like a friend who knows the town. Short sentences.
- No em-dashes. No hype or marketing buzzwords.
- Format each recommendation as a markdown link to its map using the exact MAPS url given for that restaurant, like: [Name](https://maps-url) in Neighborhood, one short reason.

THE LIST (name | cuisine | area | price | about | MAPS url to use for the link):
${LIST}`;

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
      body: JSON.stringify({ model: MODEL, max_tokens: 700, system: SYSTEM, messages: clean }),
    });
    if (!r.ok) {
      console.error('anthropic', r.status, await r.text());
      res.status(502).json({ error: 'The concierge had a hiccup. Try again in a moment.' });
      return;
    }
    const data = await r.json();
    let reply = (data.content && data.content[0] && data.content[0].text) || 'Sorry, I did not catch that. What are you in the mood for?';
    reply = reply.replace(/\s*[—―]\s*/g, ', '); // strip em-dashes (U+2014/2015): the voice rule, enforced even when the model ignores it
    res.status(200).json({ reply });
  } catch (e) {
    console.error('concierge error', e.message);
    res.status(500).json({ error: 'The concierge is having a moment. Try again shortly.' });
  }
};
