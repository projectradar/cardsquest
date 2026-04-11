// netlify/functions/checkout.js
// CardsQuest — Stripe checkout (uses Stripe via CDN fetch, no npm needed)

const allowedOrigins = [
  'https://cardsquest.pro',
  'https://www.cardsquest.pro',
  'http://localhost:8888',
  'http://localhost:3000',
];

exports.handler = async (event) => {
  const origin = event.headers.origin || event.headers.Origin || '';
  const isAllowed = allowedOrigins.includes(origin)
                 || /^https:\/\/[a-z0-9-]+\.netlify\.app$/.test(origin)
                 || origin === '';

  const headers = {
    'Access-Control-Allow-Origin': isAllowed ? (origin || '*') : 'null',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
  };

  if (!isAllowed) return { statusCode: 403, headers, body: JSON.stringify({ error: 'Forbidden' }) };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  let body;
  try { body = JSON.parse(event.body); }
  catch { return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid request' }) }; }

  const { plan, email } = body;
  const secretKey = process.env.STRIPE_SECRET_KEY;

  const PLANS = {
    starter:  process.env.STRIPE_STARTER_PRICE_ID,
    pro:      process.env.STRIPE_PRO_PRICE_ID,
    lifetime: process.env.STRIPE_LIFETIME_PRICE_ID,
  };

  if (!plan || !PLANS[plan]) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid plan' }) };
  if (!secretKey) return { statusCode: 500, headers, body: JSON.stringify({ error: 'Not configured' }) };

  const isLifetime = plan === 'lifetime';

  // Call Stripe API directly via fetch — no npm package needed
  const params = new URLSearchParams();
  params.append('payment_method_types[]', 'card');
  params.append('mode', isLifetime ? 'payment' : 'subscription');
  params.append('line_items[0][price]', PLANS[plan]);
  params.append('line_items[0][quantity]', '1');
  params.append('success_url', `https://cardsquest.pro?plan=${plan}&upgraded=1`);
  params.append('cancel_url', 'https://cardsquest.pro?cancelled=1');
  params.append('metadata[plan]', plan);
  if (email) {
    params.append('customer_email', email);
    params.append('metadata[email]', email);
  }

  try {
    const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${secretKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });

    const data = await res.json();

    if (!res.ok) {
      console.error('Stripe error:', data.error?.message);
      return { statusCode: 400, headers, body: JSON.stringify({ error: data.error?.message || 'Stripe error' }) };
    }

    return { statusCode: 200, headers, body: JSON.stringify({ url: data.url }) };

  } catch (err) {
    console.error('Checkout error:', err.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Internal error' }) };
  }
};
