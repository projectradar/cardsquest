// netlify/functions/checkout.js
// CardsQuest — Stripe checkout session creator

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const PLANS = {
  starter: process.env.STRIPE_STARTER_PRICE_ID,
  pro:     process.env.STRIPE_PRO_PRICE_ID,
  lifetime: process.env.STRIPE_LIFETIME_PRICE_ID,
};

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

  if (!plan || !PLANS[plan]) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid plan' }) };
  }

  if (!process.env.STRIPE_SECRET_KEY) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Stripe not configured' }) };
  }

  try {
    const isLifetime = plan === 'lifetime';

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: isLifetime ? 'payment' : 'subscription',
      line_items: [{
        price: PLANS[plan],
        quantity: 1,
      }],
      customer_email: email || undefined,
      success_url: `https://cardsquest.pro?plan=${plan}&session_id={CHECKOUT_SESSION_ID}&upgraded=1`,
      cancel_url: `https://cardsquest.pro?cancelled=1`,
      metadata: { plan, email: email || '' },
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ url: session.url, sessionId: session.id }),
    };

  } catch (err) {
    console.error('Stripe checkout error:', err.message);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Could not create checkout session' }),
    };
  }
};
