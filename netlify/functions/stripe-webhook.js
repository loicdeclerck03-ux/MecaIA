// netlify/functions/stripe-webhook.js
// ============================================================
// WEBHOOK STRIPE — Capture paiements + ajout crédits + email
// ============================================================

import { webcrypto as crypto } from 'node:crypto';

const STRIPE_SECRET         = process.env.STRIPE_SECRET_KEY;
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;
const SUPABASE_URL          = process.env.SUPABASE_URL;
const SUPABASE_SECRET_KEY   = process.env.SUPABASE_SECRET;

const headers = { 'Content-Type': 'application/json' };

/** Vérifier signature Stripe sans SDK (HMAC SHA256) */
async function verifyStripeSignature(payload, sigHeader, secret) {
  const parts   = sigHeader.split(',').reduce((acc, part) => {
    const [k, v] = part.split('=');
    acc[k] = v;
    return acc;
  }, {});

  const timestamp = parts['t'];
  const signature = parts['v1'];
  if (!timestamp || !signature) return false;

  const signedPayload = `${timestamp}.${payload}`;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sigBuffer = await crypto.subtle.sign('HMAC', key, encoder.encode(signedPayload));
  const expected  = Array.from(new Uint8Array(sigBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');

  // Protection replay attack : vérifier que timestamp < 5 minutes
  const tolerance = 300; // 5 minutes
  if (Math.abs(Date.now() / 1000 - parseInt(timestamp)) > tolerance) return false;

  return expected === signature;
}

/** Helper Supabase */
async function supaUpdate(table, id, data) {
  await fetch(`${SUPABASE_URL}/rest/v1/${table}?id=eq.${id}`, {
    method : 'PATCH',
    headers: {
      'Content-Type' : 'application/json',
      'apikey'       : SUPABASE_SECRET_KEY,
      'Authorization': `Bearer ${SUPABASE_SECRET_KEY}`,
      'Prefer'       : 'return=minimal'
    },
    body: JSON.stringify(data)
  });
}

async function supaInsert(table, data) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method : 'POST',
    headers: {
      'Content-Type' : 'application/json',
      'apikey'       : SUPABASE_SECRET_KEY,
      'Authorization': `Bearer ${SUPABASE_SECRET_KEY}`,
      'Prefer'       : 'return=representation'
    },
    body: JSON.stringify(data)
  });
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

async function supaGet(table, query) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, {
    headers: {
      'apikey'       : SUPABASE_SECRET_KEY,
      'Authorization': `Bearer ${SUPABASE_SECRET_KEY}`
    }
  });
  const text = await res.text();
  return text ? JSON.parse(text) : [];
}

async function incrementCredits(userId, amount) {
  await fetch(`${SUPABASE_URL}/rest/v1/rpc/increment_credits`, {
    method : 'POST',
    headers: {
      'Content-Type' : 'application/json',
      'apikey'       : SUPABASE_SECRET_KEY,
      'Authorization': `Bearer ${SUPABASE_SECRET_KEY}`
    },
    body: JSON.stringify({ user_id: userId, amount })
  });
}

/** Envoyer email via Resend */
async function sendEmail(to, subject, html) {
  try {
    await fetch('https://api.resend.com/emails', {
      method : 'POST',
      headers: {
        'Content-Type' : 'application/json',
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`
      },
      body: JSON.stringify({
        from   : 'MecaIA <noreply@mecaia.be>',
        to     : [to],
        subject: subject,
        html   : html
      })
    });
  } catch (e) { console.error('Email error:', e.message); }
}

/** Template email paiement reçu */
function emailPaymentSuccess(name, credits, amount) {
  return `
<!DOCTYPE html><html><body style="font-family:sans-serif;background:#080b0f;color:#c8d4e0;padding:30px">
<div style="max-width:500px;margin:0 auto;background:#0f1318;border:1px solid #1e2a3a;border-radius:12px;padding:30px">
  <div style="text-align:center;margin-bottom:20px">
    <div style="background:#f0a500;color:#000;display:inline-block;padding:10px 20px;border-radius:8px;font-weight:700;font-size:20px;letter-spacing:2px">MECAIA</div>
  </div>
  <h2 style="color:#fff;text-align:center">✅ Paiement confirmé !</h2>
  <p style="text-align:center;color:#4a5a6e">Bonjour <strong style="color:#fff">${name}</strong>,</p>
  <div style="background:#151a21;border:1px solid #1e2a3a;border-radius:8px;padding:20px;text-align:center;margin:20px 0">
    <div style="font-size:48px;font-weight:700;color:#f0a500">${credits === 999 ? '∞' : '+' + credits}</div>
    <div style="color:#4a5a6e;font-size:12px;margin-top:5px">crédits ajoutés · ${amount}€ payé</div>
  </div>
  <p style="color:#4a5a6e;font-size:13px;text-align:center">Tes crédits sont disponibles immédiatement.<br>Chaque diagnostic = 1 crédit. Le VIN reste gratuit.</p>
  <div style="text-align:center;margin-top:25px">
    <a href="https://euphonious-frangollo-da0cc1.netlify.app" style="background:#f0a500;color:#000;padding:12px 30px;border-radius:6px;text-decoration:none;font-weight:700">OUVRIR MECAIA →</a>
  </div>
  <p style="color:#2a3548;font-size:11px;text-align:center;margin-top:20px">MecaIA · Loïc Declerck · Belgique · loicdeclerck4020@gmail.com</p>
</div></body></html>`;
}

// ============================================================
// HANDLER
// ============================================================
export async function handler(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Méthode non autorisée' }) };
  }

  const sigHeader = event.headers['stripe-signature'];
  if (!sigHeader) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Signature manquante' }) };

  // Vérifier la signature Stripe
  const valid = await verifyStripeSignature(event.body, sigHeader, STRIPE_WEBHOOK_SECRET);
  if (!valid) {
    console.error('Signature Stripe invalide');
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Signature invalide' }) };
  }

  const stripeEvent = JSON.parse(event.body);
  console.log('Stripe event reçu:', stripeEvent.type);

  // ============================================================
  // checkout.session.completed → Ajouter crédits
  // ============================================================
  if (stripeEvent.type === 'checkout.session.completed') {
    const session  = stripeEvent.data.object;
    const { userId, credits, pack, amount } = session.metadata || {};

    if (!userId || !credits) {
      console.error('Métadonnées manquantes:', session.id);
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Métadonnées incomplètes' }) };
    }

    // Vérifier que la session n'a pas déjà été traitée
    const existing = await supaGet('transactions', `stripe_session_id=eq.${session.id}&select=id`);
    if (existing?.length > 0) {
      console.log('Session déjà traitée:', session.id);
      return { statusCode: 200, headers, body: JSON.stringify({ received: true }) };
    }

    const creditsNum = parseInt(credits);
    const isUnlimited = creditsNum === 999;

    // Ajouter crédits
    await incrementCredits(userId, creditsNum);

    // Si illimité : activer le flag
    if (isUnlimited) {
      const unlimitedUntil = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
      await fetch(`${SUPABASE_URL}/rest/v1/users?id=eq.${userId}`, {
        method : 'PATCH',
        headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_SECRET_KEY, 'Authorization': `Bearer ${SUPABASE_SECRET_KEY}`, 'Prefer': 'return=minimal' },
        body   : JSON.stringify({ is_unlimited: true, unlimited_until: unlimitedUntil })
      });
    }

    // Mettre à jour total_paid
    await fetch(`${SUPABASE_URL}/rest/v1/rpc/increment_paid`, {
      method : 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_SECRET_KEY, 'Authorization': `Bearer ${SUPABASE_SECRET_KEY}` },
      body   : JSON.stringify({ p_user_id: userId, p_amount: parseFloat(amount || 0) })
    });

    // Sauvegarder la transaction
    await supaInsert('transactions', {
      user_id          : userId,
      stripe_session_id: session.id,
      amount           : parseFloat(amount || 0),
      credits          : creditsNum,
      pack_name        : pack,
      status           : 'completed',
      created_at       : new Date().toISOString()
    });

    // Récupérer email pour envoyer la confirmation
    const users = await supaGet('users', `id=eq.${userId}&select=email,name`);
    const user  = users?.[0];
    if (user?.email) {
      await sendEmail(
        user.email,
        `✅ MecaIA — ${isUnlimited ? 'Accès illimité' : credits + ' crédits'} ajoutés !`,
        emailPaymentSuccess(user.name || 'ami', creditsNum, amount)
      );
    }

    console.log(`✅ Paiement OK: user=${userId} +${credits} crédits pack=${pack}`);
  }

  // ============================================================
  // charge.refunded → Retirer crédits + notifier
  // ============================================================
  if (stripeEvent.type === 'charge.refunded') {
    const charge = stripeEvent.data.object;
    console.log(`⚠️ Remboursement: ${charge.id} — ${charge.amount_refunded / 100}€`);

    // Trouver la transaction par session
    const transactions = await supaGet('transactions', `stripe_session_id=eq.${charge.payment_intent}&select=*`);
    const transaction  = transactions?.[0];

    if (transaction) {
      await supaUpdate('transactions', transaction.id, { status: 'refunded' });
      // Optionnel: retirer les crédits si voulu
    }
  }

  return { statusCode: 200, headers, body: JSON.stringify({ received: true }) };
}
