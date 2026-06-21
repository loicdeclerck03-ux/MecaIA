// stripe_ct_checkout.mjs — MecaIA
// Crée une session Stripe Checkout pour le Certificat CT (9,99€ one-shot)
// POST { user_id, vehicle_id, success_url, cancel_url }
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const SUPA_URL = process.env.SUPABASE_URL;
const SUPA_KEY = process.env.SUPABASE_SERVICE_KEY;
const PRICE_CT = process.env.STRIPE_PRICE_CT || null; // Price ID Stripe à créer

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };

  const authHeader = event.headers?.authorization || '';
  const token = authHeader.replace('Bearer ', '').trim();
  if (!token) return { statusCode: 401, body: JSON.stringify({ error: 'Auth requise' }) };

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { body = {}; }

  const { vehicle_id, vehicle_name, success_url, cancel_url } = body;

  const supa = createClient(SUPA_URL, SUPA_KEY, { auth: { persistSession: false } });
  const { data: { user } } = await supa.auth.getUser(token);
  if (!user) return { statusCode: 401, body: JSON.stringify({ error: 'Token invalide' }) };

  try {
    // Créer la session Checkout
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'payment',
      customer_email: user.email,
      line_items: [{
        price_data: {
          currency: 'eur',
          unit_amount: 999, // 9,99€ en centimes
          product_data: {
            name: 'Certificat Prêt pour le CT — MecaIA',
            description: `Analyse OBD2 complète + rapport IA${vehicle_name ? ' pour ' + vehicle_name : ''}`,
            images: ['https://mecaiaauto.com/og-image.png'],
          },
        },
        quantity: 1,
      }],
      success_url: (success_url || 'https://mecaiaauto.com') + '?ct_success=1&session_id={CHECKOUT_SESSION_ID}',
      cancel_url: cancel_url || 'https://mecaiaauto.com',
      metadata: {
        user_id: user.id,
        vehicle_id: vehicle_id || '',
        product: 'ct_check',
      },
    });

    // Sauvegarder la session en attente
    await supa.from('stripe_payments').insert({
      user_id: user.id,
      stripe_session_id: session.id,
      amount_eur: 9.99,
      status: 'pending',
      product: 'ct_check',
      vehicle_id: vehicle_id || null,
      created_at: new Date().toISOString(),
    }).select();

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: session.url, session_id: session.id }),
    };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
