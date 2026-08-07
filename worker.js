/**
 * Maqtomate AI — Multi-Tenant WhatsApp AI Bot Worker
 * Single Cloudflare Worker that powers ALL clients.
 *
 * BINDINGS REQUIRED (set in Worker → Settings → Bindings):
 *   MAQVORA_DB    — D1 database (run backend/d1-schema.sql first)
 *   MAQVORA_KV    — KV namespace (for conversation memory + rate limit + dedup)
 *
 * SECRETS REQUIRED (set as encrypted secrets in Worker → Settings → Variables):
 *   GEMINI_API_KEY    — Google AI Studio key (shared fallback; clients can override via gemini_api_key column)
 *   ADMIN_API_KEY     — bearer token for /api/* and /admin
 *   MASTER_VERIFY_TOKEN — shared Meta webhook verify token (or per-client via DB)
 *   APP_SECRET        — Meta App Secret; used to verify X-Hub-Signature-256 on every incoming POST
 *
 * SECURITY MODEL:
 *   - Webhook POSTs are verified against Meta's HMAC-SHA256 signature (if APP_SECRET set)
 *   - Rate limited: 20 msgs/60s/number/client via KV counter
 *   - Duplicate-protected: Meta msg IDs are deduped for 24h via KV
 *   - Admin endpoints: bearer-token gated with constant-time compare
 *   - Audit log: every admin mutation goes to D1.audit_logs
 */

export default {
  async fetch(request, env, ctx) {
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS, PUT, DELETE',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    // ── 1. META WEBHOOK VERIFICATION (GET /) ──
    if (request.method === 'GET' && path === '/') {
      const mode = url.searchParams.get('hub.mode');
      const token = url.searchParams.get('hub.verify_token');
      const challenge = url.searchParams.get('hub.challenge');

      // Accept a master token OR any per-client token in the DB
      if (mode === 'subscribe' && token === env.MASTER_VERIFY_TOKEN) {
        return new Response(challenge, { status: 200 });
      }
      if (mode === 'subscribe' && token && env.MAQVORA_DB) {
        const client = await env.MAQVORA_DB.prepare(
          'SELECT id FROM clients WHERE verify_token = ?'
        ).bind(token).first();
        if (client) return new Response(challenge, { status: 200 });
      }
      return new Response('Forbidden', { status: 403 });
    }

    // ── 2. INCOMING WHATSAPP MESSAGES (POST /) ──
    if (request.method === 'POST' && path === '/') {
      try {
        // Verify request actually came from Meta (HMAC-SHA256).
        // Without this, anyone who knows your worker URL can POST fake
        // WhatsApp payloads and burn Gemini quota or spoof messages.
        const rawBody = await request.text();
        if (env.APP_SECRET) {
          const signatureHeader = request.headers.get('x-hub-signature-256') || '';
          const valid = await verifyMetaSignature(rawBody, signatureHeader, env.APP_SECRET);
          if (!valid) {
            console.error('[SECURITY] Invalid or missing webhook signature');
            return new Response('Forbidden', { status: 403 });
          }
        } else {
          console.error('[SECURITY WARNING] APP_SECRET not set — webhook signature is NOT being verified. Set APP_SECRET (Meta App Secret) as a Worker secret.');
        }

        const body = JSON.parse(rawBody);
        const entry = body.entry?.[0];
        const change = entry?.changes?.[0];
        const value = change?.value;
        const msgObj = value?.messages?.[0];
        const phoneNumberId = value?.metadata?.phone_number_id;

        if (!msgObj || !phoneNumberId) return new Response('OK', { status: 200 });
        if (!env.MAQVORA_DB) {
          console.error('[ERROR] D1 database not bound');
          return new Response('OK', { status: 200 });
        }

        // Route to the right client
        const client = await env.MAQVORA_DB.prepare(
          `SELECT * FROM clients WHERE phone_number_id = ? AND active = 1`
        ).bind(phoneNumberId).first();
        if (!client) {
          console.error('[ERROR] No client found for phone_number_id:', phoneNumberId);
          return new Response('OK', { status: 200 });
        }

        const fromNumber = msgObj.from;
        const msgId = msgObj.id;
        const msgType = msgObj.type;

        // Duplicate protection
        const dupKey = `dup:${client.id}:${msgId}`;
        const exists = await env.MAQVORA_KV?.get(dupKey);
        if (exists) return new Response('OK', { status: 200 });
        await env.MAQVORA_KV?.put(dupKey, '1', { expirationTtl: 86400 });

        // Rate limit (real cost control, not just abuse prevention)
        const rateLimited = await checkRateLimit(env, client.id, fromNumber);
        if (rateLimited) {
          console.error('[RATE LIMIT]', client.id, fromNumber);
          return new Response('OK', { status: 200 });
        }

        // Conversation history
        let history = [];
        const histRaw = await env.MAQVORA_KV?.get(`conv:${client.id}:${fromNumber}`);
        if (histRaw) { try { history = JSON.parse(histRaw); } catch (e) { history = []; } }

        // Parse message
        let userQuery = '';
        let mediaBase64 = null;
        let mediaMimeType = null;

        if (msgType === 'text' && msgObj.text?.body) {
          userQuery = msgObj.text.body;
        } else if (msgType === 'audio' && msgObj.audio) {
          const media = await downloadWhatsAppMedia(msgObj.audio.id, client.whatsapp_token);
          if (media) {
            mediaBase64 = media.base64;
            mediaMimeType = media.mimeType || 'audio/ogg';
            userQuery = '[User sent a voice note. Please listen and respond to their query.]';
          } else {
            userQuery = '[Voice note received but could not be processed. Ask user to re-send or type.]';
          }
        } else if (msgType === 'image' && msgObj.image) {
          const media = await downloadWhatsAppMedia(msgObj.image.id, client.whatsapp_token);
          if (media) {
            mediaBase64 = media.base64;
            mediaMimeType = media.mimeType || 'image/jpeg';
            userQuery = msgObj.image.caption || '[User sent an image. Please analyze and respond appropriately.]';
          }
        } else {
          await sendWhatsAppText(fromNumber,
            client.unsupported_msg || "I can only handle text, voice notes, and images. Please type your message.",
            client.whatsapp_token, client.phone_number_id);
          return new Response('OK', { status: 200 });
        }

        // Human handoff detection (per-client configurable triggers)
        const handoffTriggers = (client.handoff_triggers || 'human,manager,agent,bande se baat,insan,representative,support team,baat karo').split(',');
        const lowerQuery = userQuery.toLowerCase();
        if (handoffTriggers.some(t => lowerQuery.includes(t.trim()))) {
          await sendWhatsAppText(fromNumber,
            `Bilkul, main aapko ${client.business_name} ke representative se connect karwa raha hoon. Thora wait karein, unka contact: ${client.contact_number || 'soon available'}.`,
            client.whatsapp_token, client.phone_number_id);
          return new Response('OK', { status: 200 });
        }

        // Build prompt + call Gemini (Mode 1 BYOK respected)
        const systemPrompt = buildSystemPrompt(client);
        const geminiKey = client.gemini_api_key || env.GEMINI_API_KEY;
        const aiResponse = await callGemini(userQuery, systemPrompt, history, mediaBase64, mediaMimeType, geminiKey, client.gemini_model);

        // Update history (last 24 messages = ~12 exchanges)
        history.push({ role: 'user', content: userQuery });
        history.push({ role: 'model', content: aiResponse });
        if (history.length > 24) history = history.slice(-24);
        await env.MAQVORA_KV?.put(`conv:${client.id}:${fromNumber}`, JSON.stringify(history), { expirationTtl: 604800 });

        // Reply + log
        await sendWhatsAppText(fromNumber, aiResponse, client.whatsapp_token, client.phone_number_id);
        await logToD1(env, client.id, fromNumber, msgType, userQuery, aiResponse);

        return new Response('OK', { status: 200 });
      } catch (err) {
        console.error('[WORKER ERROR]', err);
        return new Response('Error: ' + err.message, { status: 500 });
      }
    }

    // ── 3. ADMIN API (/api/*) ──
    if (path.startsWith('/api/')) {
      const authHeader = request.headers.get('Authorization') || '';
      const expectedAuth = `Bearer ${env.ADMIN_API_KEY}`;
      if (!env.ADMIN_API_KEY || !timingSafeEqual(authHeader, expectedAuth)) {
        return jsonResponse({ error: 'Unauthorized' }, 401, corsHeaders);
      }

      // GET /api/clients — list all
      if (request.method === 'GET' && path === '/api/clients') {
        const clients = await env.MAQVORA_DB.prepare(
          `SELECT id, business_name, niche, country, plan, client_mode, monthly_fee,
                  active, created_at, phone_number_id, contact_number
           FROM clients ORDER BY created_at DESC`
        ).all();
        return jsonResponse({ clients: clients.results }, 200, corsHeaders);
      }

      // GET /api/clients/:id — single
      if (request.method === 'GET' && path.match(/^\/api\/clients\/\d+$/)) {
        const id = path.split('/').pop();
        const client = await env.MAQVORA_DB.prepare(
          `SELECT * FROM clients WHERE id = ?`
        ).bind(id).first();
        if (!client) return jsonResponse({ error: 'Not found' }, 404, corsHeaders);
        return jsonResponse({ client }, 200, corsHeaders);
      }

      // POST /api/clients — create
      if (request.method === 'POST' && path === '/api/clients') {
        const data = await request.json();
        // Server-side validation — HTML `required` only protects the UI
        const requiredFields = ['business_name', 'phone_number_id', 'whatsapp_token'];
        const missing = requiredFields.filter(f => !data[f] || !String(data[f]).trim());
        if (missing.length > 0) {
          return jsonResponse({ error: `Missing required field(s): ${missing.join(', ')}` }, 400, corsHeaders);
        }

        const result = await env.MAQVORA_DB.prepare(`
          INSERT INTO clients (
            business_name, niche, country, plan, monthly_fee,
            phone_number_id, whatsapp_token, verify_token,
            working_hours, location, services, pricing, contact_number,
            ai_name, system_prompt_extra, handoff_triggers,
            unsupported_msg, fallback_msg, gemini_model, active,
            gemini_api_key, client_mode
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
          data.business_name, data.niche || 'general', data.country || 'PK',
          data.plan || 'standard', data.monthly_fee || 1500,
          data.phone_number_id, data.whatsapp_token, data.verify_token || generateToken(),
          data.working_hours, data.location, data.services, data.pricing, data.contact_number,
          data.ai_name || `AI Assistant for ${data.business_name}`,
          data.system_prompt_extra || '',
          data.handoff_triggers || 'human,manager,agent,bande se baat,insan',
          data.unsupported_msg || '', data.fallback_msg || '',
          data.gemini_model || 'gemini-1.5-flash', 1,
          data.gemini_api_key || null, data.client_mode || 3
        ).run();

        const newClientId = result.meta.last_row_id;
        await writeAuditLog(env, request, 'client.create', newClientId, { business_name: data.business_name, client_mode: data.client_mode || 3 });

        return jsonResponse({
          success: true,
          client_id: newClientId,
          webhook_url: `https://${url.hostname}/`,
          verify_token: data.verify_token
        }, 201, corsHeaders);
      }

      // PUT /api/clients/:id — partial update
      if (request.method === 'PUT' && path.match(/^\/api\/clients\/\d+$/)) {
        const id = path.split('/').pop();
        const data = await request.json();

        const allowedFields = [
          'business_name', 'niche', 'country', 'plan', 'monthly_fee',
          'phone_number_id', 'whatsapp_token', 'verify_token',
          'working_hours', 'location', 'services', 'pricing', 'contact_number',
          'ai_name', 'system_prompt_extra', 'handoff_triggers',
          'unsupported_msg', 'fallback_msg', 'gemini_model', 'active',
          'gemini_api_key', 'client_mode'
        ];
        const fields = [];
        const values = [];
        for (const key of allowedFields) {
          if (data[key] !== undefined) {
            fields.push(`${key} = ?`);
            values.push(data[key]);
          }
        }
        if (fields.length === 0) {
          return jsonResponse({ error: 'No fields to update' }, 400, corsHeaders);
        }
        values.push(id);
        await env.MAQVORA_DB.prepare(
          `UPDATE clients SET ${fields.join(', ')}, updated_at = datetime('now') WHERE id = ?`
        ).bind(...values).run();
        await writeAuditLog(env, request, 'client.update', id, { fields_changed: Object.keys(data) });
        return jsonResponse({ success: true }, 200, corsHeaders);
      }

      // DELETE /api/clients/:id — soft delete
      if (request.method === 'DELETE' && path.match(/^\/api\/clients\/\d+$/)) {
        const id = path.split('/').pop();
        await env.MAQVORA_DB.prepare(
          `UPDATE clients SET active = 0, updated_at = datetime('now') WHERE id = ?`
        ).bind(id).run();
        await writeAuditLog(env, request, 'client.deactivate', id, null);
        return jsonResponse({ success: true }, 200, corsHeaders);
      }

      // GET /api/stats — dashboard counters
      if (request.method === 'GET' && path === '/api/stats') {
        const totalClients = await env.MAQVORA_DB.prepare(
          `SELECT COUNT(*) as count FROM clients WHERE active = 1`
        ).first();
        const totalMrr = await env.MAQVORA_DB.prepare(
          `SELECT SUM(monthly_fee) as mrr FROM clients WHERE active = 1`
        ).first();
        const nicheBreakdown = await env.MAQVORA_DB.prepare(
          `SELECT niche, COUNT(*) as count FROM clients WHERE active = 1 GROUP BY niche`
        ).all();
        const countryBreakdown = await env.MAQVORA_DB.prepare(
          `SELECT country, COUNT(*) as count FROM clients WHERE active = 1 GROUP BY country`
        ).all();
        const modeBreakdown = await env.MAQVORA_DB.prepare(
          `SELECT client_mode, COUNT(*) as count, SUM(monthly_fee) as mrr
           FROM clients WHERE active = 1 GROUP BY client_mode`
        ).all();
        return jsonResponse({
          total_clients: totalClients?.count || 0,
          total_mrr: totalMrr?.mrr || 0,
          niches: nicheBreakdown.results,
          countries: countryBreakdown.results,
          modes: modeBreakdown.results
        }, 200, corsHeaders);
      }

      // GET /api/audit — audit log
      if (request.method === 'GET' && path === '/api/audit') {
        const limit = Math.min(parseInt(url.searchParams.get('limit') || '100', 10), 500);
        const rows = await env.MAQVORA_DB.prepare(
          `SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT ?`
        ).bind(limit).all();
        return jsonResponse({ audit: rows.results }, 200, corsHeaders);
      }

      return jsonResponse({ error: 'Not found' }, 404, corsHeaders);
    }

    // ── 4. ADMIN DASHBOARD (/admin) ──
    if (path === '/admin') {
      return new Response(adminDashboardHTML(), {
        headers: { 'Content-Type': 'text/html', ...corsHeaders }
      });
    }

    return new Response('Not Found', { status: 404 });
  }
};

// ════════════════════════════════════════════════════════════════
// SECURITY HELPERS
// ════════════════════════════════════════════════════════════════

async function verifyMetaSignature(rawBody, signatureHeader, appSecret) {
  if (!signatureHeader || !signatureHeader.startsWith('sha256=')) return false;
  const expectedHex = signatureHeader.slice('sha256='.length).trim();
  if (!expectedHex) return false;

  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(appSecret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sigBuffer = await crypto.subtle.sign('HMAC', key, enc.encode(rawBody));
  const computedHex = [...new Uint8Array(sigBuffer)]
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
  return timingSafeEqual(computedHex, expectedHex);
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return result === 0;
}

// ════════════════════════════════════════════════════════════════
// HTTP HELPERS
// ════════════════════════════════════════════════════════════════

function jsonResponse(data, status, corsHeaders) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders }
  });
}

function generateToken() {
  return 'mv_' + Math.random().toString(36).substring(2, 10) + Math.random().toString(36).substring(2, 10);
}

// ════════════════════════════════════════════════════════════════
// META / GEMINI INTEGRATION
// ════════════════════════════════════════════════════════════════

async function downloadWhatsAppMedia(mediaId, token) {
  try {
    const metaRes = await fetch(`https://graph.facebook.com/v19.0/${mediaId}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const metaData = await metaRes.json();
    if (!metaData.url) return null;
    const mediaRes = await fetch(metaData.url, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const arrayBuffer = await mediaRes.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
    return { base64: btoa(binary), mimeType: metaData.mime_type || 'application/octet-stream' };
  } catch (err) {
    console.error('[MEDIA ERROR]', err);
    return null;
  }
}

function buildSystemPrompt(client) {
  return `You are ${client.ai_name || 'an AI Customer Service Assistant'} for ${client.business_name}.

BUSINESS INFORMATION:
- Working Hours: ${client.working_hours || 'Not specified'}
- Location: ${client.location || 'Not specified'}
- Services/Products: ${client.services || 'Not specified'}
- Pricing: ${client.pricing || 'Not specified'}
- Contact/Escalation: ${client.contact_number || 'Not specified'}
${client.system_prompt_extra ? '- Additional Notes: ' + client.system_prompt_extra : ''}

STRICT RULES:
1. Be extremely polite, professional, and concise. Use short paragraphs (1-3 sentences max per bubble).
2. Answer ONLY based on the provided business information. Never hallucinate.
3. If asked about pricing, provide exact prices listed above.
4. If customer wants to book an appointment or asks something outside your knowledge, say: "Main aapki details lekar ${client.business_name} ko inform kar deta hoon. Aapka naam aur contact number kya hai?"
5. Do NOT entertain off-topic questions (politics, coding, other businesses, general knowledge). Politely refuse: "Mujhe maaf kijiye, main sirf ${client.business_name} se related sawalon ka jawab de sakta hoon."
6. Respond in the SAME LANGUAGE the user is typing in (English, Roman Urdu, Urdu, Hindi, Arabic, Spanish, etc.).
7. If user sends a voice note, acknowledge naturally: "Aapki awaaz sun li, yeh raha jawab..."
8. Never make up discounts, offers, or policies not listed above.
9. Always end with a helpful closing like "Aur koi madad chahiye toh batain." or "Anything else I can help you with?"`;
}

async function callGemini(userQuery, systemPrompt, history, mediaBase64, mediaMimeType, apiKey, model) {
  const contents = [];
  contents.push({ role: 'user', parts: [{ text: systemPrompt }] });
  contents.push({ role: 'model', parts: [{ text: 'Understood. I will assist customers based strictly on the provided business information.' }] });
  for (const msg of history) {
    contents.push({ role: msg.role === 'user' ? 'user' : 'model', parts: [{ text: msg.content }] });
  }
  const currentParts = [{ text: userQuery }];
  if (mediaBase64 && mediaMimeType) {
    currentParts.push({ inlineData: { mimeType: mediaMimeType, data: mediaBase64 } });
  }
  contents.push({ role: 'user', parts: currentParts });

  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model || 'gemini-1.5-flash'}:generateContent?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents,
      generationConfig: { temperature: 0.65, maxOutputTokens: 350, topP: 0.9, topK: 40 },
      safetySettings: [
        { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
        { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
        { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
        { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' }
      ]
    })
  });

  const data = await res.json();
  if (data.error) {
    console.error('[GEMINI ERROR]', data.error);
    return 'Mujhe maaf kijiye, is waqt jawab dene mein masla ho gaya hai. Bara e meharbani thori dair baad dobara try karein.';
  }
  if (!data.candidates || data.candidates.length === 0) {
    return 'Mujhe maaf kijiye, is waqt jawab dene mein masla ho gaya hai. Bara e meharbani thori dair baad dobara try karein.';
  }
  return data.candidates[0].content.parts[0].text;
}

async function sendWhatsAppText(to, text, token, phoneId) {
  const res = await fetch(`https://graph.facebook.com/v19.0/${phoneId}/messages`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: to,
      type: 'text',
      text: { body: text, preview_url: false }
    })
  });
  if (!res.ok) {
    const err = await res.text();
    console.error('[WHATSAPP SEND ERROR]', err);
  }
}

// ════════════════════════════════════════════════════════════════
// STORAGE / RATE LIMIT / AUDIT
// ════════════════════════════════════════════════════════════════

async function logToD1(env, clientId, fromNumber, msgType, query, response) {
  try {
    await env.MAQVORA_DB.prepare(`
      INSERT INTO logs (client_id, from_number, msg_type, query, response, created_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'))
    `).bind(clientId, fromNumber, msgType, query.substring(0, 500), response.substring(0, 500)).run();
  } catch (e) {
    console.error('[LOG ERROR]', e);
  }
}

// Sliding-ish window rate limit (KV isn't built for counters but good enough
// to stop runaway cost). 20 msgs / 60s / number / client.
async function checkRateLimit(env, clientId, fromNumber) {
  if (!env.MAQVORA_KV) return false; // no KV = no limit, fail open
  const key = `rl:${clientId}:${fromNumber}`;
  const raw = await env.MAQVORA_KV.get(key);
  const count = raw ? parseInt(raw, 10) : 0;
  if (count >= 20) return true;
  await env.MAQVORA_KV.put(key, String(count + 1), { expirationTtl: 60 });
  return false;
}

async function writeAuditLog(env, request, action, clientId, detail) {
  try {
    if (!env.MAQVORA_DB) return;
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    await env.MAQVORA_DB.prepare(`
      INSERT INTO audit_logs (actor, action, client_id, detail, ip, created_at)
      VALUES ('admin', ?, ?, ?, ?, datetime('now'))
    `).bind(action, clientId ?? null, detail ? JSON.stringify(detail) : null, ip).run();
  } catch (e) {
    console.error('[AUDIT LOG ERROR]', e);
  }
}

// ════════════════════════════════════════════════════════════════
// ADMIN DASHBOARD HTML
// ════════════════════════════════════════════════════════════════

function adminDashboardHTML() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Maqtomate AI — Admin Dashboard</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>body{font-family:'Inter',sans-serif;}</style>
</head>
<body class="bg-gray-950 text-white min-h-screen">
  <div class="max-w-7xl mx-auto px-4 py-8">
    <div class="flex items-center justify-between mb-8">
      <div>
        <h1 class="text-3xl font-bold text-blue-400">Maqtomate AI Dashboard</h1>
        <p class="text-gray-400">Multi-Tenant WhatsApp Bot Management</p>
      </div>
      <div class="text-right">
        <div class="text-sm text-gray-400">Total MRR</div>
        <div class="text-2xl font-bold text-emerald-400" id="mrr">Loading...</div>
      </div>
    </div>

    <div class="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
      <div class="bg-gray-900 rounded-xl p-6 border border-gray-800">
        <div class="text-sm text-gray-400 mb-1">Active Clients</div>
        <div class="text-3xl font-bold" id="totalClients">-</div>
      </div>
      <div class="bg-gray-900 rounded-xl p-6 border border-gray-800">
        <div class="text-sm text-gray-400 mb-1">Countries</div>
        <div class="text-3xl font-bold" id="totalCountries">-</div>
      </div>
      <div class="bg-gray-900 rounded-xl p-6 border border-gray-800">
        <div class="text-sm text-gray-400 mb-1">Niches</div>
        <div class="text-3xl font-bold" id="totalNiches">-</div>
      </div>
      <div class="bg-gray-900 rounded-xl p-6 border border-gray-800">
        <div class="text-sm text-gray-400 mb-1">Modes</div>
        <div class="text-3xl font-bold text-purple-400" id="totalModes">-</div>
      </div>
    </div>

    <div class="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden mb-8">
      <div class="px-6 py-4 border-b border-gray-800 flex justify-between items-center">
        <h2 class="text-xl font-bold">Clients</h2>
        <button onclick="showAddForm()" class="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg text-sm font-semibold transition">+ Add Client</button>
      </div>
      <div class="overflow-x-auto">
        <table class="w-full text-left">
          <thead class="bg-gray-800 text-gray-400 text-sm">
            <tr>
              <th class="px-6 py-3">ID</th>
              <th class="px-6 py-3">Business</th>
              <th class="px-6 py-3">Niche</th>
              <th class="px-6 py-3">Country</th>
              <th class="px-6 py-3">Mode</th>
              <th class="px-6 py-3">Monthly</th>
              <th class="px-6 py-3">Status</th>
              <th class="px-6 py-3">Actions</th>
            </tr>
          </thead>
          <tbody id="clientsTable" class="text-sm">
            <tr><td colspan="8" class="px-6 py-8 text-center text-gray-500">Loading...</td></tr>
          </tbody>
        </table>
      </div>
    </div>

    <div id="addModal" class="hidden fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div class="bg-gray-900 rounded-2xl border border-gray-700 max-w-2xl w-full max-h-[90vh] overflow-y-auto p-6">
        <div class="flex justify-between items-center mb-6">
          <h2 class="text-xl font-bold">Add New Client</h2>
          <button onclick="hideAddForm()" class="text-gray-400 hover:text-white text-2xl">&times;</button>
        </div>
        <form id="addForm" class="space-y-4">
          <div class="grid grid-cols-2 gap-4">
            <div><label class="block text-sm text-gray-400 mb-1">Business Name *</label><input name="business_name" required class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white"></div>
            <div><label class="block text-sm text-gray-400 mb-1">Niche *</label><input name="niche" required placeholder="dental, salon, real_estate, restaurant..." class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white"></div>
          </div>
          <div class="grid grid-cols-2 gap-4">
            <div><label class="block text-sm text-gray-400 mb-1">Country *</label><input name="country" required value="PK" class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white"></div>
            <div>
              <label class="block text-sm text-gray-400 mb-1">Mode *</label>
              <select name="client_mode" required class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white">
                <option value="1">1 — DIY BYOK (client brings all keys; highest margin)</option>
                <option value="2">2 — Smart Pro (we manage AI; client owns Meta)</option>
                <option value="3" selected>3 — VIP Managed (we handle everything)</option>
              </select>
            </div>
          </div>
          <div class="grid grid-cols-2 gap-4">
            <div><label class="block text-sm text-gray-400 mb-1">Monthly Fee (Rs)</label><input name="monthly_fee" type="number" value="2500" class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white"></div>
            <div><label class="block text-sm text-gray-400 mb-1">Phone Number ID *</label><input name="phone_number_id" required placeholder="Meta Phone Number ID" class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white"></div>
          </div>
          <div><label class="block text-sm text-gray-400 mb-1">WhatsApp Token *</label><input name="whatsapp_token" required class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white"></div>
          <div><label class="block text-sm text-gray-400 mb-1">Gemini API Key (Mode 1 only — leave blank to use shared key)</label><input name="gemini_api_key" placeholder="AIza..." class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white"></div>
          <div><label class="block text-sm text-gray-400 mb-1">Working Hours</label><input name="working_hours" placeholder="e.g., 4PM-9PM Mon-Sat" class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white"></div>
          <div><label class="block text-sm text-gray-400 mb-1">Location</label><input name="location" class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white"></div>
          <div><label class="block text-sm text-gray-400 mb-1">Services</label><textarea name="services" rows="2" class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white"></textarea></div>
          <div><label class="block text-sm text-gray-400 mb-1">Pricing</label><textarea name="pricing" rows="3" class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white"></textarea></div>
          <div><label class="block text-sm text-gray-400 mb-1">Contact Number (for handoff)</label><input name="contact_number" class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white"></div>
          <div class="flex justify-end space-x-3 pt-4">
            <button type="button" onclick="hideAddForm()" class="px-4 py-2 text-gray-400 hover:text-white transition">Cancel</button>
            <button type="submit" class="bg-blue-600 hover:bg-blue-500 text-white px-6 py-2 rounded-lg font-semibold transition">Create Client</button>
          </div>
        </form>
      </div>
    </div>
  </div>

  <script>
    const API_KEY = prompt('Enter Admin API Key:');
    if (!API_KEY) document.body.innerHTML = '<div class="text-center py-20 text-red-400">API Key required</div>';

    const MODE_LABELS = { 1: 'DIY', 2: 'Smart Pro', 3: 'VIP' };
    const MODE_COLORS = { 1: 'text-emerald-400', 2: 'text-blue-400', 3: 'text-purple-400' };

    async function loadStats() {
      const res = await fetch('/api/stats', { headers: { 'Authorization': 'Bearer ' + API_KEY } });
      const data = await res.json();
      document.getElementById('totalClients').textContent = data.total_clients;
      document.getElementById('totalCountries').textContent = data.countries ? data.countries.length : 0;
      document.getElementById('totalNiches').textContent = data.niches ? data.niches.length : 0;
      document.getElementById('totalModes').textContent = data.modes ? data.modes.length : 0;
      document.getElementById('mrr').textContent = 'Rs ' + (data.total_mrr || 0).toLocaleString();
    }

    async function loadClients() {
      const res = await fetch('/api/clients', { headers: { 'Authorization': 'Bearer ' + API_KEY } });
      const data = await res.json();
      const tbody = document.getElementById('clientsTable');
      if (!data.clients || data.clients.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" class="px-6 py-8 text-center text-gray-500">No clients yet</td></tr>';
        return;
      }
      tbody.innerHTML = data.clients.map(function(c) {
        const mode = c.client_mode || 3;
        return '<tr class="border-t border-gray-800 hover:bg-gray-800/50 transition">' +
          '<td class="px-6 py-4">#' + c.id + '</td>' +
          '<td class="px-6 py-4 font-medium">' + c.business_name + '</td>' +
          '<td class="px-6 py-4"><span class="bg-gray-800 px-2 py-1 rounded text-xs">' + c.niche + '</span></td>' +
          '<td class="px-6 py-4">' + c.country + '</td>' +
          '<td class="px-6 py-4"><span class="' + (MODE_COLORS[mode] || 'text-gray-400') + '">M' + mode + ' ' + (MODE_LABELS[mode] || '') + '</span></td>' +
          '<td class="px-6 py-4">Rs ' + c.monthly_fee + '</td>' +
          '<td class="px-6 py-4"><span class="' + (c.active ? 'text-emerald-400' : 'text-red-400') + '">' + (c.active ? 'Active' : 'Inactive') + '</span></td>' +
          '<td class="px-6 py-4"><button onclick="deleteClient(' + c.id + ')" class="text-red-400 hover:text-red-300 text-sm">Delete</button></td>' +
        '</tr>';
      }).join('');
    }

    function showAddForm() { document.getElementById('addModal').classList.remove('hidden'); }
    function hideAddForm() { document.getElementById('addModal').classList.add('hidden'); }

    document.getElementById('addForm').onsubmit = async function(e) {
      e.preventDefault();
      const formData = new FormData(e.target);
      const data = {};
      formData.forEach(function(v, k) {
        // Coerce client_mode to number
        data[k] = (k === 'client_mode' || k === 'monthly_fee') ? Number(v) : v;
      });
      const res = await fetch('/api/clients', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      const result = await res.json();
      if (result.success) {
        alert('Client created! Webhook URL: ' + result.webhook_url);
        hideAddForm();
        loadClients();
        loadStats();
      } else {
        alert('Error: ' + (result.error || 'Unknown'));
      }
    };

    async function deleteClient(id) {
      if (!confirm('Deactivate client #' + id + '?')) return;
      await fetch('/api/clients/' + id, { method: 'DELETE', headers: { 'Authorization': 'Bearer ' + API_KEY } });
      loadClients();
      loadStats();
    }

    loadStats();
    loadClients();
  </script>
</body>
</html>`;
}
