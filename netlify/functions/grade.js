// CardsQuest grade.js v5 — clean, no sharp dependency
// Server-side IP scan enforcement for guests

const GUEST_SCAN_LIMIT = 2;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

async function sbFetch(path, method = 'GET', body = null) {
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
  const txt = await res.text();
  if (!res.ok) throw new Error(`Supabase ${method} ${path}: ${res.status} ${txt}`);
  try { return JSON.parse(txt); } catch { return txt; }
}

async function getGuestScans(ip) {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const rows = await sbFetch(`guest_scans?ip=eq.${encodeURIComponent(ip)}&scan_date=eq.${today}&select=scan_count`);
    return Array.isArray(rows) && rows.length > 0 ? rows[0].scan_count : 0;
  } catch (e) {
    console.warn('getGuestScans error:', e.message);
    return 0;
  }
}

async function incrementGuestScans(ip) {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const rows = await sbFetch(`guest_scans?ip=eq.${encodeURIComponent(ip)}&scan_date=eq.${today}&select=scan_count`);
    if (rows.length > 0) {
      await sbFetch(`guest_scans?ip=eq.${encodeURIComponent(ip)}&scan_date=eq.${today}`, 'PATCH', {
        scan_count: rows[0].scan_count + 1,
        updated_at: new Date().toISOString()
      });
    } else {
      await sbFetch('guest_scans', 'POST', {
        ip,
        scan_date: today,
        scan_count: 1,
        updated_at: new Date().toISOString()
      });
    }
  } catch (e) {
    console.warn('incrementGuestScans error:', e.message);
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
  if (!apiKey) return { statusCode: 500, headers, body: JSON.stringify({ error: 'API key not configured on server' }) };

  let body;
  try { body = JSON.parse(event.body); }
  catch { return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON body' }) }; }

  const { image, mimeType, prompt, userEmail } = body;
  if (!image) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing image' }) };
  if (!prompt) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing prompt' }) };

  // ── GUEST SCAN ENFORCEMENT ──
  if (!userEmail && SUPABASE_URL && SUPABASE_KEY) {
    const ip = (event.headers['x-forwarded-for'] || '').split(',')[0].trim()
      || event.headers['client-ip']
      || 'unknown';

    const used = await getGuestScans(ip);
    if (used >= GUEST_SCAN_LIMIT) {
      return {
        statusCode: 403,
        headers,
        body: JSON.stringify({
          error: 'scan_limit_reached',
          message: 'Free scans used up. Sign up free to keep grading.',
          scansUsed: used,
          limit: GUEST_SCAN_LIMIT
        })
      };
    }
  }

  // ── CALL CLAUDE ──
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 600,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: mimeType || 'image/jpeg',
                data: image
              }
            },
            { type: 'text', text: prompt }
          ]
        }]
      })
    });

    const raw = await response.text();
    console.log('Anthropic status:', response.status);

    if (!response.ok) {
      let errMsg = `API error ${response.status}`;
      try { errMsg = JSON.parse(raw)?.error?.message || errMsg; } catch {}
      console.error('Anthropic error:', errMsg);
      return { statusCode: 502, headers, body: JSON.stringify({ error: errMsg }) };
    }

    const data = JSON.parse(raw);
    const text = data.content?.find(c => c.type === 'text')?.text || '';

    if (!text) return { statusCode: 502, headers, body: JSON.stringify({ error: 'No response from AI' }) };

    // Record guest scan after successful grade
    if (!userEmail && SUPABASE_URL && SUPABASE_KEY) {
      const ip = (event.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
      await incrementGuestScans(ip);
    }

    return { statusCode: 200, headers, body: JSON.stringify({ content: text }) };

  } catch (err) {
    console.error('Grade function error:', err.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Server error: ' + err.message }) };
  }
};
