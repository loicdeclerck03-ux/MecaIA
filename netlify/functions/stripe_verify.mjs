// ============================================================
// STRIPE_VERIFY.MJS  (LECTURE SEULE)
// Appelée par la page de succès pour AFFICHER l'état du paiement
// et le solde courant. NE CRÉDITE PLUS RIEN : le crédit est fait
// exclusivement par le webhook signé (stripe_webhook.mjs).
// -> supprime la faille de rejeu (double crédit) de l'ancienne version.
// ============================================================

import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET);

export const handler = async (event) => {
  try {
    const { session_id } = JSON.parse(event.body || "{}");
    if (!session_id) {
      return { statusCode: 400, body: JSON.stringify({ error: "Missing session_id" }) };
    }

    const session = await stripe.checkout.sessions.retrieve(session_id);
    const paid = session.payment_status === "paid";
    const userId = session.metadata?.user_id;

    // Solde courant (en lecture seule). Peut être encore l'ancien solde
    // si le webhook n'a pas encore créé le crédit -> le front peut re-poller.
    let balance = null;
    if (paid && userId) {
      const { data } = await supabase.rpc("get_user_credits", { p_user_id: userId });
      if (data && data[0]) balance = data[0].credits_balance;
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        payment_status: session.payment_status, // 'paid' | 'unpaid' | 'no_payment_required'
        paid,
        balance, // peut être null le temps que le webhook traite
      }),
    };
  } catch (error) {
    return { statusCode: 500, body: JSON.stringify({ success: false, error: error.message }) };
  }
};
