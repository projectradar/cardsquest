// netlify/functions/supabase-auth.js
// Handles all auth + data operations server-side with service key

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

const allowedOrigins = [
  'https://cardsquest.pro',
  'https://www.cardsquest.pro',
  'http://localhost:8888',
  'http://localhost:3000',
];

async function supabase(method, path, body) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: {
      'apikey': SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': method === 'POST' ? 'return=representation' : 'return=minimal',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  try { return { ok: res.ok, status: res.status, data: JSON.parse(text) }; }
  catch { return { ok: res.ok, status: res.status, data: text }; }
}

exports.handler = async (event) => {
  const origin = event.headers.origin || '';
  const isAllowed = allowedOrigins.includes(origin) || /^https:\/\/[a-z0-9-]+\.netlify\.app$/.test(origin) || origin === '';
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

  const { action } = body;

  // ── LOGIN ──
  if (action === 'login') {
    const { email, passwordHash } = body;
    if (!email || !passwordHash) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing fields' }) };

    const r = await supabase('GET', `users?email=eq.${encodeURIComponent(email)}&select=*`);
    if (!r.ok || !r.data.length) return { statusCode: 401, headers, body: JSON.stringify({ error: 'No account found' }) };

    const user = r.data[0];
    // Support both hashed and legacy plain passwords
    if (user.password_hash !== passwordHash && user.password_hash !== body.plainPassword) {
      return { statusCode: 401, headers, body: JSON.stringify({ error: 'Incorrect password' }) };
    }

    // Auto-upgrade plain password to hash
    if (user.password_hash === body.plainPassword) {
      await supabase('PATCH', `users?email=eq.${encodeURIComponent(email)}`, { password_hash: passwordHash });
    }

    // Get collection
    const cr = await supabase('GET', `collections?user_email=eq.${encodeURIComponent(email)}&select=*&order=date_added.desc`);
    const collection = cr.ok ? cr.data : [];

    return { statusCode: 200, headers, body: JSON.stringify({
      success: true,
      user: { email: user.email, name: user.name, plan: user.plan, scansUsed: user.scans_used, scansResetDate: user.scans_reset_date, streak: user.streak, streakLastDate: user.streak_last_date },
      collection
    })};
  }

  // ── SIGNUP ──
  if (action === 'signup') {
    const { email, passwordHash, name } = body;
    if (!email || !passwordHash || !name) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing fields' }) };

    // Check exists
    const check = await supabase('GET', `users?email=eq.${encodeURIComponent(email)}&select=email`);
    if (check.ok && check.data.length) return { statusCode: 409, headers, body: JSON.stringify({ error: 'Account already exists' }) };

    const r = await supabase('POST', 'users', { email, password_hash: passwordHash, name, plan: 'free', scans_used: 0 });
    if (!r.ok) return { statusCode: 500, headers, body: JSON.stringify({ error: 'Could not create account' }) };

    return { statusCode: 200, headers, body: JSON.stringify({ success: true, user: { email, name, plan: 'free', scansUsed: 0 } }) };
  }

  // ── SAVE CARD ──
  if (action === 'save_card') {
    const { email, card } = body;
    if (!email || !card) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing fields' }) };

    const r = await supabase('POST', 'collections', {
      user_email: email,
      card_id: card.id || Date.now(),
      name: card.name,
      grade: card.grade,
      value: card.value,
      confidence: card.confidence || 0,
      centering: card.centering || 0,
      corners: card.corners || 0,
      edges: card.edges || 0,
      surface: card.surface || 0,
      grade_label: card.gradeLabel || '',
      notes: card.notes || '',
      type: card.type || 'normal',
      set_name: card.setName || '',
      rarity: card.rarity || '',
      tcg_img: card.tcgImg || '',
      art_url: card.artUrl || '',
      img_src: card.imgSrc || '',
      live_price: card.livePrice || false,
      emoji: card.emoji || '🃏',
      date_added: card.dateAdded || Date.now(),
    });

    if (!r.ok) return { statusCode: 500, headers, body: JSON.stringify({ error: 'Could not save card' }) };
    return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
  }

  // ── DELETE CARD ──
  if (action === 'delete_card') {
    const { email, cardId } = body;
    await supabase('DELETE', `collections?user_email=eq.${encodeURIComponent(email)}&card_id=eq.${cardId}`);
    return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
  }

  // ── UPDATE SCANS ──
  if (action === 'update_scans') {
    const { email, scansUsed, scansResetDate } = body;
    await supabase('PATCH', `users?email=eq.${encodeURIComponent(email)}`, { scans_used: scansUsed, scans_reset_date: scansResetDate });
    return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
  }

  // ── UPDATE PLAN ──
  if (action === 'update_plan') {
    const { email, plan } = body;
    await supabase('PATCH', `users?email=eq.${encodeURIComponent(email)}`, { plan });
    return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
  }

  // ── UPDATE STREAK ──
  if (action === 'update_streak') {
    const { email, streak, streakLastDate } = body;
    await supabase('PATCH', `users?email=eq.${encodeURIComponent(email)}`, { streak, streak_last_date: streakLastDate });
    return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
  }

  return { statusCode: 400, headers, body: JSON.stringify({ error: 'Unknown action' }) };
};
