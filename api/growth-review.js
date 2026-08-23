// San Mateo Local — Conversational Growth Review (owner diagnostic).
//
// A Vercel serverless function at /api/growth-review. It runs a warm, HONEST
// diagnostic chat with a local BUSINESS OWNER: understands their business,
// recognizes it from the San Mateo Local directory when it can, points at ONE
// genuine gap (never an invented one), offers the free Business Growth Review,
// captures the lead, and fires it ONCE to BCM's GHL pipeline.
//
// Two front doors, one pipeline: this and the plain form both feed the same
// "Business Growth Review" pipeline in GHL. BCM built the webhook seam.
//
// Env: ANTHROPIC_API_KEY (required, same key as the concierge).
//      GROWTH_REVIEW_WEBHOOK_URL (optional; falls back to the live BCM endpoint).
// No dependencies: global fetch only.

const DATA = require('../growth-data.json');
const HAIKU = 'claude-haiku-4-5-20251001';

// BCM's live "Growth Review - Chat Intake" inbound webhook (not a secret; overridable via env).
const WEBHOOK = process.env.GROWTH_REVIEW_WEBHOOK_URL
  || 'https://services.leadconnectorhq.com/hooks/qzIoV5UQJF7FjTNGrv5p/webhook-trigger/1feaabc4-5a8b-42d2-b2bf-904fec5865a2';

// ---- Business name matcher: recognize the owner's business in the directory ----
// Generic words that never identify a specific business on their own.
const STOP = new Set(['the', 'and', 'of', 'san', 'mateo', 'ca', 'inc', 'llc', 'co', 'studio',
  'cafe', 'coffee', 'shop', 'store', 'bar', 'grill', 'kitchen', 'company', 'salon', 'spa',
  'pilates', 'yoga', 'gym', 'fitness', 'hair', 'nails', 'dental', 'clinic', 'center', 'group',
  'services', 'service', 'restaurant', 'pizza', 'taqueria', 'market', 'deli', 'house', 'bakery',
  'auto', 'repair', 'care', 'a', 'on', 'llp', 'dds', 'md']);
function distinctive(name) {
  return String(name).toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/)
    .filter(w => w.length >= 3 && !STOP.has(w));
}
// Match the business the owner named across their messages. Requires a strong,
// specific hit so a generic phrase ("a coffee shop") never latches onto a listing.
function matchBusiness(userText) {
  const t = ' ' + String(userText).toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ') + ' ';
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

function directoryBlock(b) {
  if (!b) {
    return `DIRECTORY: No confident San Mateo Local match yet for the business named. If the owner has clearly given their business name and you still find nothing, it may simply not be listed on San Mateo Local yet, which is itself an honest visibility gap worth mentioning gently ("I'm not finding you on San Mateo Local yet"). Confirm rather than assert, and never claim any other gap you cannot see. Ask what they already have (a website? Google reviews?) and diagnose only from what they tell you.`;
  }
  return `DIRECTORY MATCH (what San Mateo Local actually has on file for this business; use ONLY this plus what the owner tells you, never invent beyond it):
- Name: ${b.name}  (their San Mateo Local page: ${b.detail})
- Category / type: ${b.cat}${b.type ? ' / ' + b.type : ''}
- Neighborhood: ${b.area || 'not recorded'}
- Website on file with us: ${b.website ? 'yes' : 'no'}
- Hours listed with us: ${b.hours ? 'yes' : 'no'}
- Review signal on file: ${b.reviews ? b.reviews : 'none on file'}
- Listing claimed by the owner: ${b.claimed ? 'yes' : 'no'}
- Premium page with us: ${b.premium ? 'yes' : 'no'}
Read this honestly: name a gap ONLY where the data shows one (for example "no website on file", "your listing isn't claimed yet", "no reviews on file"). If it looks solid, say so plainly ("you're actually in good shape here") and point at a real opportunity instead of inventing a flaw. Remember this is only what SAN MATEO LOCAL has; you cannot see their live site, real review count, or Google ranking, so frame it as "what I can see on San Mateo Local" or ask.`;
}

const SYSTEM = `You are the San Mateo Local growth guide: a warm, genuinely honest assistant that helps a local BUSINESS OWNER take a quick look at how their business shows up online, then offers them a free Business Growth Review.

KEEP YOUR JOB THIS NARROW: understand their business -> give ONE honest, useful observation -> offer the free Growth Review -> capture their email (and phone if offered) -> submit. You are NOT a salesperson and NOT a general chatbot. Do not pitch specific products, prices, or packages. The free Growth Review (a short, no-pressure look done by a real local person) is the ONLY thing you offer.

THE FLOW, ONE QUESTION AT A TIME. Never ask two things at once. Never open with "what's your email?". Warm, plain, short sentences.
1. Greet warmly and ask what kind of business they run.
2. Ask the business name.
3. You may be given a DIRECTORY MATCH. If matched, say you found them ("I found ARTYV Studio here on San Mateo Local"). If not, that may be an honest visibility gap (they're not on the guide yet); confirm gently.
4. Ask what they most want to improve, and offer simple choices as chips.
5. Give ONE genuinely useful, HONEST observation, tied to what you actually know (see HONESTY).
6. Offer the free Business Growth Review as the natural next step: a short, honest write-up of how they show up online and the highest-value thing to fix, done by a local, free, no obligation.
7. If they say yes, ask their first name and email (one at a time). You may then ask for a phone number, but it's optional.
8. As soon as you have the business name, their first name, and an email (or a phone), call the submit_lead tool ONCE. Then give a clear CLOSING message that leaves no doubt the chat is finished: thank them by first name, confirm their free Growth Review is submitted, say what happens next and when (a local reviews how they show up online and emails it within about five business days), and that there is nothing more they need to do right now. Make it a clean wrap-up, not an open-ended question, and do not ask anything further after this.

HONESTY, the whole point and non-negotiable:
- NEVER invent a problem to create urgency. Only name a gap the DIRECTORY MATCH data shows, or that the owner tells you about.
- If their listing looks strong, SAY SO: "you're actually doing well here." Then point at a legitimate opportunity, not a manufactured flaw.
- Legit gaps you MAY raise when the data supports them: not on San Mateo Local at all, no website on file, listing not claimed, no reviews on file, weak local or AI-search visibility.
- You cannot see their live website, real review count, or Google ranking. Speak only from what San Mateo Local shows and what they say. Frame it as "what I can see on San Mateo Local," or ask.

CHIPS: when you offer a small set of choices, end that message with one line exactly like:
[[CHIPS: More calls | More Google reviews | Get found in search | More leads | More appointments | Not sure]]
Use the choices that fit (for the "what to improve" question, and for a yes/no like [[CHIPS: Yes, send it | Maybe later]]). The visitor sees these as tappable buttons. Use chips only when offering a small choice, not on every message.

SUBMIT: call submit_lead only ONCE, only after they opted into the review and you have their email (or phone). Put a short, factual chat_notes summary of what the diagnostic found so the reviewer has context. Do not tell the visitor about tools or webhooks.

STYLE: warm, local, concise. Short sentences. No em-dashes. No hype, no buzzwords. One question per message.`;

const SUBMIT_TOOL = {
  name: 'submit_lead',
  description: 'Send the captured Growth Review lead to the pipeline. Call ONCE, only after the owner opted into the free review and gave an email (or phone).',
  input_schema: {
    type: 'object',
    properties: {
      business_name: { type: 'string', description: 'The business name as the owner gave it' },
      business_type: { type: 'string', description: 'What kind of business, e.g. Plumber, Pilates studio' },
      main_concern: { type: 'string', description: 'The goal they chose, e.g. More calls' },
      chat_notes: { type: 'string', description: '2 to 3 sentence factual summary of what the diagnostic found, for the reviewer' },
      first_name: { type: 'string' },
      email: { type: 'string' },
      phone: { type: 'string', description: 'E.164 if given, else empty' },
    },
    required: ['business_name', 'first_name', 'email'],
  },
};

async function fireWebhook(input) {
  const digits = String(input.phone || '').replace(/\D/g, '');
  const phone = digits ? (digits.length === 10 ? '+1' + digits : '+' + digits) : '';
  const payload = {
    business_name: input.business_name || '',
    business_type: input.business_type || '',
    main_concern: input.main_concern || '',
    chat_notes: input.chat_notes || '',
    first_name: input.first_name || '',
    email: input.email || '',
    phone,
    source: 'SML Chat Growth Review',
  };
  const r = await fetch(WEBHOOK, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(8000),
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
  res.setHeader('x-smc-build', 'gr-1');
  if (req.method !== 'POST') { res.status(405).json({ error: 'POST only' }); return; }
  if (!process.env.ANTHROPIC_API_KEY) { res.status(503).json({ error: 'The growth guide is not switched on yet.' }); return; }

  let messages;
  try {
    const body = JSON.parse(await readBody(req));
    messages = Array.isArray(body.messages) ? body.messages : null;
  } catch (e) { res.status(400).json({ error: 'bad request' }); return; }
  if (!messages || !messages.length) { res.status(400).json({ error: 'no messages' }); return; }

  const clean = messages.slice(-14).map(m => ({
    role: m.role === 'assistant' ? 'assistant' : 'user',
    content: String(m.content || '').slice(0, 1000),
  })).filter(m => m.content);
  if (!clean.length) { res.status(400).json({ error: 'no messages' }); return; }

  const userText = clean.filter(m => m.role === 'user').map(m => m.content).join(' ');
  const match = matchBusiness(userText);
  const system = [
    { type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } },
    { type: 'text', text: directoryBlock(match) },
  ];

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ model: HAIKU, max_tokens: 900, system, messages: clean, tools: [SUBMIT_TOOL] }),
    });
    if (!r.ok) {
      console.error('anthropic', r.status, await r.text());
      res.status(502).json({ error: 'The growth guide had a hiccup. Try again in a moment.' });
      return;
    }
    const data = await r.json();
    const blocks = Array.isArray(data.content) ? data.content : [];
    const textOut = blocks.filter(b => b && b.type === 'text' && b.text).map(b => b.text).join('\n').trim();
    const toolUse = blocks.find(b => b && b.type === 'tool_use' && b.name === 'submit_lead');

    if (toolUse) {
      const input = toolUse.input || {};
      const hasContact = input.email || input.phone;
      if (input.business_name && input.first_name && hasContact) {
        try { await fireWebhook(input); }
        catch (e) { console.error('growth webhook', e.message); } // lead still acknowledged; logged for follow-up
        const who = input.first_name ? input.first_name : 'there';
        const reply = stripDash(textOut) ||
          `You're all set, ${who}. Your free Growth Review is submitted. A local will take a look at how ${input.business_name || 'your business'} shows up online and email it to you within about five business days. Nothing more you need to do right now. Talk soon!`;
        res.status(200).json({ reply, done: true });
        return;
      }
      // Model tried to submit without enough info: nudge it forward instead of firing.
      res.status(200).json({ reply: stripDash(textOut) || 'Before I send this over, what is the best email to reach you at?' });
      return;
    }

    let reply = stripDash(textOut) || 'Sorry, I did not catch that. What kind of business do you run?';
    let chips = null;
    const cm = reply.match(/\[\[CHIPS:\s*([^\]]+)\]\]/i);
    if (cm) {
      chips = cm[1].split('|').map(s => s.trim()).filter(Boolean).slice(0, 6);
      reply = reply.replace(/\[\[CHIPS:[^\]]+\]\]/i, '').trim();
    }
    res.status(200).json({ reply, chips });
  } catch (e) {
    console.error('growth-review error', e.message);
    res.status(500).json({ error: 'The growth guide is having a moment. Try again shortly.' });
  }
};
