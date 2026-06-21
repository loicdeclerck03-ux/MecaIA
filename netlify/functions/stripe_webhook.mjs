// ============================================================
// STRIPE_WEBHOOK.MJS — v2 (17/06/2026)
// Gère :
//   checkout.session.completed  → paiements one-time (crédits immédiats)
//   invoice.payment_succeeded   → renouvellements abonnement mensuel
// Idempotence : clé unique par event Stripe (event.id ou invoice.id)
// ============================================================

import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
let _supa = null;
const getSupabase = () => _supa || (_supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET));

export const handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method not allowed" };
  }

  const sig    = event.headers["stripe-signature"] || event.headers["Stripe-Signature"];
  const secret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!sig || !secret) {
    return { statusCode: 400, body: "Missing signature or webhook secret" };
  }

  // Stripe exige le corps RAW pour vérifier la signature
  const rawBody = event.isBase64Encoded
    ? Buffer.from(event.body, "base64")
    : event.body;

  let stripeEvent;
  try {
    stripeEvent = stripe.webhooks.constructEvent(rawBody, sig, secret);
  } catch (err) {
    console.error("[STRIPE_WEBHOOK] signature invalide:", err.message);
    return { statusCode: 400, body: "Webhook signature verification failed" };
  }

  try {

    // ── CAS 1 : Paiement one-time complété ────────────────────────────────
    if (stripeEvent.type === "checkout.session.completed") {
      const session = stripeEvent.data.object;

      // Ignorer les sessions d'abonnement (traitées par invoice.payment_succeeded)
      if (session.mode === "subscription") {
        console.log("[STRIPE_WEBHOOK] checkout subscription → handled by invoice event");
        return { statusCode: 200, body: JSON.stringify({ received: true }) };
      }

      if (session.payment_status !== "paid") {
        return { statusCode: 200, body: "ignored: not paid" };
      }

      // ── CAS CT CHECK (9,99€ one-shot) ────────────────────────────────
      if (session.metadata?.product === 'ct_check') {
        const ctUserId = session.metadata?.user_id;
        const ctVehicleId = session.metadata?.vehicle_id || null;
        if (ctUserId) {
          await getSupabase().from('stripe_payments').update({
            status: 'succeeded',
            updated_at: new Date().toISOString()
          }).eq('stripe_session_id', session.id);
          // Marquer le CT check comme payé pour cet utilisateur
          await getSupabase().from('user_credits').upsert({
            user_id: ctUserId,
            ct_checks_available: getSupabase().rpc('increment', { x: 1, row_id: ctUserId })
          }, { onConflict: 'user_id' }).select();
          console.log('[STRIPE_WEBHOOK] CT Check payé user=' + ctUserId);
        }
        return { statusCode: 200, body: JSON.stringify({ received: true, product: 'ct_check' }) };
      }

      const userId       = session.metadata?.user_id;
      const credits      = parseFloat(session.metadata?.credits      || "0");
      const unlimitedDays = parseInt(session.metadata?.unlimited_days || "0", 10);

      if (!userId || (!(credits > 0) && !(unlimitedDays > 0))) {
        console.error("[STRIPE_WEBHOOK] metadata incomplet:", session.metadata);
        return { statusCode: 200, body: "ignored: bad metadata" };
      }

      const { data, error } = await getSupabase().rpc("apply_stripe_purchase", {
        p_event_id    : session.id,
        p_session_id  : session.id,
        p_user_id     : userId,
        p_credits     : credits,
        p_unlimited_days: unlimitedDays,
        p_description : `Achat ${session.metadata?.package || "credits"}`,
      });

      if (error) {
        console.error("[STRIPE_WEBHOOK] application échouée:", error.message);
        return { statusCode: 500, body: "apply failed" };
      }

      const row = data && data[0];
      console.log(`[STRIPE_WEBHOOK] one-time ${row?.message} (${row?.kind}) user=${userId} credits=${credits}`);
    }

    // ── CAS 2 : Renouvellement abonnement mensuel ────────────────────────
    else if (stripeEvent.type === "invoice.payment_succeeded") {
      const invoice = stripeEvent.data.object;

      // On ne traite que les factures liées à un abonnement
      if (!invoice.subscription) {
        return { statusCode: 200, body: "ignored: no subscription" };
      }

      // Récupérer la subscription pour obtenir les métadonnées user_id/credits
      const subscription = await stripe.subscriptions.retrieve(invoice.subscription);
      const meta = subscription.metadata || {};

      const userId  = meta.user_id;
      const credits = parseFloat(meta.credits || "0");

      if (!userId || !(credits > 0)) {
        console.error("[STRIPE_WEBHOOK] subscription metadata manquante:", meta);
        return { statusCode: 200, body: "ignored: bad subscription metadata" };
      }

      // Clé d'idempotence = invoice.id (unique par facture Stripe)
      const { data, error } = await getSupabase().rpc("apply_stripe_purchase", {
        p_event_id    : invoice.id,
        p_session_id  : invoice.id,
        p_user_id     : userId,
        p_credits     : credits,
        p_unlimited_days: 0,
        p_description : `Abonnement mensuel MecaIA (${invoice.id.slice(-8)})`,
      });

      if (error) {
        console.error("[STRIPE_WEBHOOK] abonnement application échouée:", error.message);
        return { statusCode: 500, body: "apply failed" };
      }

      const row = data && data[0];
      console.log(`[STRIPE_WEBHOOK] subscription renewal ${row?.message} user=${userId} +${credits}cr`);
    }

    return { statusCode: 200, body: JSON.stringify({ received: true }) };

  } catch (err) {
    console.error("[STRIPE_WEBHOOK] erreur:", err.message);
    return { statusCode: 500, body: "handler error" };
  }
};
