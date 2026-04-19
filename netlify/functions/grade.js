// CardsQuest — grade.js v4
// Server-side scan enforcement — bypasses localStorage completely
// Guest scans tracked by IP in Supabase — cannot be bypassed by refresh/incognito

const GUEST_SCAN_LIMIT = 2;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

async function sbFetch(path, method='GET', body=null) {
  const opts = {
    method,
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Prefer': method === 'POST' ? 'return=representation' : ''
    }
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, opts);
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Supabase ${method} ${path}: ${res.status} ${txt}`);
  }
  return res.json();
}

async function getGuestScans(ip) {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const rows = await sbFetch(`guest_scans?ip=eq.${encodeURIComponent(ip)}&scan_date=eq.${today}&select=scan_count`);
    return rows.length > 0 ? rows[0].scan_count : 0;
  } catch (e) {
    console.warn('getGuestScans error:', e.message);
    return 0; // fail open so grading still works if Supabase is down
  }
}

async function incrementGuestScans(ip) {
  try {
    const today = new Date().toISOString().slice(0, 10);
    // Upsert — create or increment
    await sbFetch('guest_scans', 'POST', {
      ip,
      scan_date: today,
      scan_count: 1,
      updated_at: new Date().toISOString()
    });
  } catch (e) {
    // If row exists, increment it
    try {
      const today = new Date().toISOString().slice(0, 10);
      const rows = await sbFetch(`guest_scans?ip=eq.${encodeURIComponent(ip)}&scan_date=eq.${today}&select=scan_count,id`);
      if (rows.length > 0) {
        const newCount = rows[0].scan_count + 1;
        await sbFetch(`guest_scans?ip=eq.${encodeURIComponent(ip)}&scan_date=eq.${today}`, 'PATCH', {
          scan_count: newCount,
          updated_at: new Date().toISOString()
        });
      }
    } catch (e2) {
      console.warn('incrementGuestScans error:', e2.message);
    }
  }
}

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error('MISSING: ANTHROPIC_API_KEY not set');
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'API key not configured' }) };
  }

  let body;
  try { body = JSON.parse(event.body); }
  catch { return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid request body' }) }; }

  const { image, mimeType, prompt, userEmail } = body;
  if (!image || !prompt) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing image or prompt' }) };

  // ── SERVER-SIDE SCAN LIMIT ENFORCEMENT ──
  const ip = event.headers['x-forwarded-for']?.split(',')[0]?.trim()
           || event.headers['client-ip']
           || 'unknown';

  // Only enforce for guests (no email) or check logged-in user scans via Supabase
  if (!userEmail && SUPABASE_URL && SUPABASE_KEY) {
    const scansUsed = await getGuestScans(ip);
    if (scansUsed >= GUEST_SCAN_LIMIT) {
      return {
        statusCode: 403,
        headers,
        body: JSON.stringify({
          error: 'scan_limit_reached',
          message: 'Free scans used. Create a free account to continue grading.',
          scansUsed,
          limit: GUEST_SCAN_LIMIT
        })
      };
    }
  }

  // ── IMAGE COMPRESSION ──
  let finalImage = image;
  const finalMime = 'image/jpeg';

  try {
    const sharp = require('sharp');
    const inputBuffer = Buffer.from(image, 'base64');
    const compressed = await sharp(inputBuffer)
      .resize(800, 1100, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 80 })
      .toBuffer();
    finalImage = compressed.toString('base64');
    console.log(`Compressed: ${(inputBuffer.length/1024).toFixed(0)}KB → ${(compressed.length/1024).toFixed(0)}KB`);
  } catch (e) {
    console.warn('sharp unavailable, using original:', e.message);
  }

  // ── CALL ANTHROPIC ──
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 500,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: finalMime, data: finalImage } },
            { type: 'text', text: prompt }
          ]
        }]
      })
    });

    const raw = await res.text();

    if (!res.ok) {
      let msg = `API error ${res.status}`;
      try { msg = JSON.parse(raw)?.error?.message || msg; } catch {}
      console.error('Anthropic error:', res.status, raw.slice(0, 300));
      return { statusCode: 502, headers, body: JSON.stringify({ error: msg }) };
    }

    const data = JSON.parse(raw);
    const text = data.content?.find(c => c.type === 'text')?.text || '';

    if (!text) {
      return { statusCode: 502, headers, body: JSON.stringify({ error: 'No response from AI' }) };
    }

    // ── RECORD SCAN AFTER SUCCESSFUL GRADE ──
    if (!userEmail && SUPABASE_URL && SUPABASE_KEY) {
      await incrementGuestScans(ip);
    }

    return { statusCode: 200, headers, body: JSON.stringify({ content: text }) };

  } catch (err) {
    console.error('Fatal error:', err.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Server error: ' + err.message }) };
  }
};
