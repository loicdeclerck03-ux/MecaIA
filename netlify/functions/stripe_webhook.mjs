// ============================================================
// STRIPE_WEBHOOK.MJS
// Source de vérité du paiement : Stripe appelle cette fonction.
// - Vérifie la SIGNATURE (STRIPE_WEBHOOK_SECRET) -> non spoofable
// - Crédite de façon IDEMPOTENTE (un événement = un crédit max)
// - Utilise la clé SERVICE (SUPABASE_SECRET) car il n'y a pas
//   d'utilisateur connecté dans un webhook.
// ============================================================

import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET);

export const handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method not allowed" };
  }

  const sig =
    event.headers["stripe-signature"] || event.headers["Stripe-Signature"];
  const secret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!sig || !secret) {
    return { statusCode: 400, body: "Missing signature or webhook secret" };
  }

  // IMPORTANT : Stripe exige le corps BRUT pour vérifier la signature.
  // Netlify peut encoder le body en base64 -> on le restitue tel quel.
  const rawBody = event.isBase64Encoded
    ? Buffer.from(event.body, "base64")
    : event.body;

  let stripeEvent;
  try {
    stripeEvent = stripe.webhooks.constructEvent(rawBody, sig, secret);
  } catch (err) {
    console.error("[STRIPE_WEBHOOK] signature invalide:", err.message);
    return { statusCode: 400, body: `Webhook signature verification failed` };
  }

  try {
    if (stripeEvent.type === "checkout.session.completed") {
      const session = stripeEvent.data.object;

      // Sécurité : on ne crédite que si le paiement est bien réglé.
      if (session.payment_status !== "paid") {
        return { statusCode: 200, body: "ignored: not paid" };
      }

      const userId = session.metadata?.user_id;
      const credits = parseFloat(session.metadata?.credits || "0");
      const unlimitedDays = parseInt(session.metadata?.unlimited_days || "0", 10);

      // Il faut un utilisateur ET soit des crédits, soit un pass illimité.
      if (!userId || (!(credits > 0) && !(unlimitedDays > 0))) {
        console.error("[STRIPE_WEBHOOK] metadata incomplet:", session.metadata);
        // 200 pour éviter que Stripe ne réessaie en boucle un event inexploitable.
        return { statusCode: 200, body: "ignored: bad metadata" };
      }

      const { data, error } = await supabase.rpc("apply_stripe_purchase", {
        p_event_id: stripeEvent.id,
        p_session_id: session.id,
        p_user_id: userId,
        p_credits: credits,
        p_unlimited_days: unlimitedDays,
        p_description: `Achat ${session.metadata?.package || "credits"}`,
      });

      if (error) {
        console.error("[STRIPE_WEBHOOK] application échouée:", error.message);
        // 500 -> Stripe réessaiera ; l'idempotence empêche le double traitement.
        return { statusCode: 500, body: "apply failed" };
      }

      const row = data && data[0];
      console.log(
        `[STRIPE_WEBHOOK] ${row?.message} (${row?.kind}) user=${userId} credits=${credits} unlimitedDays=${unlimitedDays}`
      );
    }

    // Toujours 200 sur les events qu'on ne traite pas (sinon Stripe réessaie).
    return { statusCode: 200, body: JSON.stringify({ received: true }) };
  } catch (err) {
    console.error("[STRIPE_WEBHOOK] erreur:", err.message);
    return { statusCode: 500, body: "handler error" };
  }
};
