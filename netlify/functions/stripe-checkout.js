// netlify/functions/stripe-checkout.js
// ============================================================
// CRÉATION SESSIONS STRIPE — MecaIA
// ============================================================

const STRIPE_SECRET  = process.env.STRIPE_SECRET_KEY;
const SUPABASE_URL   = process.env.SUPABASE_URL;
const SUPABASE_ANON  = process.env.SUPABASE_ANON;
const FRONTEND_URL   = process.env.FRONTEND_URL || 'https://euphonious-frangollo-da0cc1.netlify.app';

const headers = {
  'Content-Type'                : 'application/json',
  'Access-Control-Allow-Origin' : '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization'
};

// Packs disponibles (prix IDs Stripe)
const PACKS = {
  '1credit': {
    priceId : process.env.STRIPE_PRICE_1CREDIT || 'price_1TbQghQ1QuRc9MT37T4MItNy',
    credits : 1,
    name    : '1 crédit MecaIA',
    amount  : '1.00'
  },
  '25credits': {
    priceId : process.env.STRIPE_PRICE_25CREDITS || 'price_1TbQm9Q1QuRc9MT36U7QcAkg',
    credits : 25,
    name    : '25 crédits MecaIA',
    amount  : '5.00'
  },
  '60credits': {
    priceId : process.env.STRIPE_PRICE_60CREDITS || 'price_1TbQrVQ1QuRc9MT39l7sLfhS',
    credits : 60,
    name    : '60 crédits MecaIA',
    amount  : '10.00'
  },
  'unlimited': {
    priceId : process.env.STRIPE_PRICE_UNLIMITED || 'price_1TbQtTQ1QuRc9MT3PqoYzjW1',
    credits : 999,
    name    : 'Illimité 30 jours MecaIA',
    amount  : '15.00'
  }
};

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Méthode non autorisée' }) };

  // Récupérer l'utilisateur depuis le JWT
  const token = (event.headers.authorization || '').replace('Bearer ', '');
  if (!token) return { statusCode: 401, headers, body: JSON.stringify({ error: 'Non authentifié' }) };

  let authUser;
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { 'Authorization': `Bearer ${token}`, 'apikey': SUPABASE_ANON }
    });
    authUser = await res.json();
    if (!authUser?.id) throw new Error('Utilisateur introuvable');
  } catch (e) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'Session invalide' }) };
  }

  const { pack, discountPercent } = JSON.parse(event.body || '{}');
  const packData = PACKS[pack];
  if (!packData) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Pack invalide' }) };

  try {
    // Appel Stripe API REST (sans SDK pour éviter les dépendances)
    const sessionBody = new URLSearchParams({
      'mode'                    : 'payment',
      'payment_method_types[0]' : 'card',
      'line_items[0][price]'    : packData.priceId,
      'line_items[0][quantity]' : '1',
      'success_url'             : `${FRONTEND_URL}?payment=success&session_id={CHECKOUT_SESSION_ID}`,
      'cancel_url'              : `${FRONTEND_URL}?payment=cancel`,
      'metadata[userId]'        : authUser.id,
      'metadata[credits]'       : String(packData.credits),
      'metadata[pack]'          : pack,
      'metadata[amount]'        : packData.amount,
      'customer_email'          : authUser.email || ''
    });

    // Appliquer une réduction si code promo
    if (discountPercent > 0 && discountPercent <= 100) {
      // Note: pour une vraie réduction Stripe, il faut un coupon Stripe
      // Ici on le note dans les métadonnées, le webhook l'applique
      sessionBody.append('metadata[discount]', String(discountPercent));
    }

    const stripeRes = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method : 'POST',
      headers: {
        'Authorization': `Basic ${Buffer.from(STRIPE_SECRET + ':').toString('base64')}`,
        'Content-Type' : 'application/x-www-form-urlencoded'
      },
      body: sessionBody.toString()
    });

    const session = await stripeRes.json();
    if (session.error) throw new Error(session.error.message);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ url: session.url, sessionId: session.id })
    };

  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Erreur Stripe: ' + e.message }) };
  }
}
