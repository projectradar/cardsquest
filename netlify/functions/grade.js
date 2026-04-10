// netlify/functions/grade.js
// CardsQuest — AI card grading proxy (hardened)

// Simple in-memory rate limiter — resets when function cold-starts
const rateLimits = new Map();
const RATE_LIMIT = 10;     // max 10 requests per IP per minute
const RATE_WINDOW = 60000; // 1 minute

function checkRateLimit(ip) {
  const now = Date.now();
  const entry = rateLimits.get(ip);
  if (!entry || now - entry.windowStart > RATE_WINDOW) {
    rateLimits.set(ip, { count: 1, windowStart: now });
    return true;
  }
  if (entry.count >= RATE_LIMIT) return false;
  entry.count++;
  return true;
}

function cleanRateLimits() {
  const now = Date.now();
  for (const [ip, entry] of rateLimits.entries()) {
    if (now - entry.windowStart > RATE_WINDOW * 2) rateLimits.delete(ip);
  }
}

exports.handler = async (event) => {
  const ip = event.headers['x-forwarded-for']?.split(',')[0]?.trim()
           || event.headers['client-ip']
           || 'unknown';

  // Lock CORS to your real domain
  const allowedOrigins = [
    'https://cardsquest.pro',
    'https://www.cardsquest.pro',
    'http://localhost:8888',
    'http://localhost:3000',
  ];
  const origin = event.headers.origin || event.headers.Origin || '';
  const isAllowed = allowedOrigins.includes(origin)
                 || /^https:\/\/[a-z0-9-]+\.netlify\.app$/.test(origin)
                 || origin === '';

  const headers = {
    'Access-Control-Allow-Origin': isAllowed ? (origin || '*') : 'null',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
  };

  if (!isAllowed) return { statusCode: 403, headers, body: JSON.stringify({ error: 'Forbidden' }) };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  // Rate limit
  cleanRateLimits();
  if (!checkRateLimit(ip)) {
    return { statusCode: 429, headers: { ...headers, 'Retry-After': '60' }, body: JSON.stringify({ error: 'Too many requests — try again in a minute' }) };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { statusCode: 500, headers, body: JSON.stringify({ error: 'Service not configured' }) };

  let body;
  try { body = JSON.parse(event.body); }
  catch { return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid request' }) }; }

  const { image, mimeType, prompt } = body;
  if (!image || !prompt) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing fields' }) };
  if (image.length > 14_000_000) return { statusCode: 413, headers, body: JSON.stringify({ error: 'Image too large' }) };

  const safeMime = ['image/jpeg','image/png','image/webp','image/gif'].includes(mimeType) ? mimeType : 'image/jpeg';

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-opus-4-5',
        max_tokens: 800,
        messages: [{ role: 'user', content: [
          { type: 'image', source: { type: 'base64', media_type: safeMime, data: image } },
          { type: 'text', text: prompt }
        ]}]
      })
    });

    if (!res.ok) {
      console.error('Anthropic error:', res.status);
      return { statusCode: 502, headers, body: JSON.stringify({ error: 'Grading service unavailable' }) };
    }

    const data = await res.json();
    const text = data.content?.find(c => c.type === 'text')?.text || '';
    return { statusCode: 200, headers, body: JSON.stringify({ content: text }) };

  } catch (err) {
    console.error('Grade error:', err.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Internal error' }) };
  }
};
