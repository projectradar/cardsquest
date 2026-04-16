// CardsQuest — grade.js v3
// Compresses images to reduce API cost + prevent timeouts

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
    console.error('MISSING: ANTHROPIC_API_KEY not set in Netlify environment variables');
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'API key not configured' }) };
  }

  let body;
  try { body = JSON.parse(event.body); }
  catch { return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid request body' }) }; }

  const { image, mimeType, prompt } = body;
  if (!image || !prompt) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing image or prompt' }) };

  // ── IMAGE COMPRESSION via sharp ──
  let finalImage = image;
  const finalMime = 'image/jpeg';

  try {
    const sharp = require('sharp');
    const inputBuffer = Buffer.from(image, 'base64');
    const originalSize = inputBuffer.length;

    const compressed = await sharp(inputBuffer)
      .resize(800, 1100, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 80 })
      .toBuffer();

    finalImage = compressed.toString('base64');
    console.log(`Compressed: ${(originalSize/1024).toFixed(0)}KB → ${(compressed.length/1024).toFixed(0)}KB (${Math.round((1-compressed.length/originalSize)*100)}% saved)`);
  } catch (e) {
    // sharp not available — use original but warn
    console.warn('sharp unavailable, using original image:', e.message);
    finalImage = image;
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
            {
              type: 'image',
              source: { type: 'base64', media_type: finalMime, data: finalImage }
            },
            { type: 'text', text: prompt }
          ]
        }]
      })
    });

    const raw = await res.text();
    console.log('Anthropic status:', res.status);

    if (!res.ok) {
      let msg = `API error ${res.status}`;
      try { msg = JSON.parse(raw)?.error?.message || msg; } catch {}
      console.error('Anthropic error:', res.status, raw.slice(0, 300));
      return { statusCode: 502, headers, body: JSON.stringify({ error: msg }) };
    }

    const data = JSON.parse(raw);
    const text = data.content?.find(c => c.type === 'text')?.text || '';

    if (!text) {
      console.error('No text content in response:', raw.slice(0, 300));
      return { statusCode: 502, headers, body: JSON.stringify({ error: 'No response from AI' }) };
    }

    return { statusCode: 200, headers, body: JSON.stringify({ content: text }) };

  } catch (err) {
    console.error('Fatal error in grade function:', err.message, err.stack);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Server error: ' + err.message }) };
  }
};
