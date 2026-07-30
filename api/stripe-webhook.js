// Stripe -> Notion "don't leak a free placement" safety net.
//
// When a San Mateo Local subscription is CANCELED in Stripe, this creates a
// High-priority "To Do" task in the Notion Master Task List so Jason always
// remembers to pull that business's placement. No more watching Stripe emails.
//
// Runs as a Vercel serverless function at /api/stripe-webhook (no framework, no
// dependencies — built-in crypto + global fetch only).
//
// Needs two Vercel env vars (Jason sets these; never in the code):
//   STRIPE_WEBHOOK_SECRET  - the signing secret from the Stripe webhook
//   NOTION_TOKEN           - an internal Notion integration token (shared with the task DB)

const crypto = require('crypto');

const NOTION_TASKS_DB = 'da7cdc5f5c6e492094403dfc3b775cc4'; // Master Task List (not secret)
const NOTION_VERSION = '2022-06-28';

// Read the raw request body (Stripe signature check needs the exact bytes).
async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  return Buffer.concat(chunks).toString('utf8');
}

// Verify the request really came from Stripe.
function verifyStripe(rawBody, sigHeader, secret) {
  try {
    const parts = Object.fromEntries(String(sigHeader || '').split(',').map((p) => p.split('=')));
    if (!parts.t || !parts.v1) return false;
    const expected = crypto.createHmac('sha256', secret).update(`${parts.t}.${rawBody}`).digest('hex');
    const a = Buffer.from(expected);
    const b = Buffer.from(parts.v1);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch (e) {
    return false;
  }
}

async function createNotionTask({ product, customerId }) {
  const custLink = customerId ? `https://dashboard.stripe.com/customers/${customerId}` : 'Stripe dashboard';
  const res = await fetch('https://api.notion.com/v1/pages', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.NOTION_TOKEN}`,
      'Notion-Version': NOTION_VERSION,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      parent: { database_id: NOTION_TASKS_DB },
      properties: {
        Task: { title: [{ text: { content: `Remove a placement, ${product} subscription canceled` } }] },
        Status: { select: { name: 'To Do' } },
        Priority: { select: { name: 'High' } },
        Notes: {
          rich_text: [{ text: { content: `A ${product} subscription just canceled on San Mateo Local. Pull that business's placement in a session so they don't stay live for free. Find the customer here: ${custLink}` } }],
        },
      },
    }),
  });
  if (!res.ok) throw new Error(`Notion ${res.status}: ${await res.text()}`);
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') { res.status(405).send('POST only'); return; }

  const rawBody = await readRawBody(req);
  if (!verifyStripe(rawBody, req.headers['stripe-signature'], process.env.STRIPE_WEBHOOK_SECRET)) {
    res.status(400).send('bad signature');
    return;
  }

  let event;
  try { event = JSON.parse(rawBody); } catch (e) { res.status(400).send('bad json'); return; }

  // Only care about a subscription being canceled.
  if (event.type !== 'customer.subscription.deleted') { res.status(200).send('ignored'); return; }

  const sub = event.data && event.data.object ? event.data.object : {};
  const amount = sub.items && sub.items.data && sub.items.data[0] && sub.items.data[0].price
    ? sub.items.data[0].price.unit_amount : null;
  const product = amount === 3900 ? 'Featured ($39/mo)'
    : amount === 3500 ? 'Local Buzz ($35/mo)'
    : amount ? `$${(amount / 100).toFixed(0)}/mo` : 'a paid';

  try {
    await createNotionTask({ product, customerId: sub.customer });
    res.status(200).send('task created');
  } catch (e) {
    console.error('Notion task failed:', e.message);
    res.status(500).send('notion error'); // Stripe will retry
  }
};
