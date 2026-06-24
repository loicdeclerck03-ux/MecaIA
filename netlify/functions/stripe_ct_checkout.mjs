// stripe_ct_checkout.mjs — MecaIA
// Crée une session Stripe Checkout pour le Certificat CT (9,99€ one-shot)
// POST { vehicle_id, vehicle_name, success_url, cancel_url }
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const SUPA_URL = process.env.SUPABASE_URL;
const SUPA_KEY = process.env.SUPABASE_SERVICE_KEY;
// Price ID CT Check 9,99€ — produit créé le 21/06/2026 dans Stripe Live
const PRICE_CT = process.env.STRIPE_PRICE_CT || 'price_1TkiXpQ1QuRc9MT3TmKpKy35';

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };

  const authHeader = event.headers?.authorization || '';
  const token = authHeader.replace('Bearer ', '').trim();
  if (!token) return { statusCode: 401, body: JSON.stringify({ error: 'Auth requise' }) };

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { body = {}; }

  const { vehicle_id, vehicle_name, success_url, cancel_url } = body;

  let _supa=null;
const getSupa=()=>_supa||(_supa=createClient(SUPA_URL,SUPA_KEY,{auth:{persistSession:false}}));
  const { data: _ad, error: _ae } = await getSupa().auth.getUser(token);
  if (_ae || !_ad?.user) return { statusCode: 401, body: JSON.stringify({ error: 'Token invalide' }) };
  const user = _ad.user;
  if (!user) return { statusCode: 401, body: JSON.stringify({ error: 'Token invalide' }) };

  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'payment',
      customer_email: user.email,
      line_items: [{ price: PRICE_CT, quantity: 1 }],
      success_url: (success_url || 'https://mecaiaauto.com') + '?ct_success=1&session_id={CHECKOUT_SESSION_ID}',
      cancel_url: cancel_url || 'https://mecaiaauto.com',
      metadata: {
        user_id: user.id,
        vehicle_id: vehicle_id || '',
        vehicle_name: vehicle_name || '',
        product: 'ct_check',
      },
    });

    // Sauvegarder en attente
    await getSupa().from('stripe_payments').insert({
      user_id: user.id,
      stripe_session_id: session.id,
      amount_eur: 9.99,
      status: 'pending',
      product: 'ct_check',
      vehicle_id: vehicle_id || null,
      created_at: new Date().toISOString(),
    });

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: session.url, session_id: session.id }),
    };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
