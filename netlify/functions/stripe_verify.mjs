// ============================================================
// STRIPE_VERIFY.MJS — FILET DE SÉCURITÉ
// Appelée par la page de retour après un paiement.
// 1) Demande à STRIPE si la commande est réellement payée (source de vérité).
// 2) Si OUI -> crédite via apply_stripe_purchase.
//    -> idempotent : clé = session.id (LA MÊME que le webhook),
//       donc jamais de double crédit, quel que soit celui qui passe en 1er.
// 3) Si NON -> ne crédite rien (impossible d'avoir des crédits sans payer).
// ============================================================

import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
let _supa = null;
const getSupabase = () => _supa || (_supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET));

export const handler = async (event) => {
  try {
    const { session_id } = JSON.parse(event.body || "{}");
    if (!session_id) {
      return { statusCode: 400, body: JSON.stringify({ error: "Missing session_id" }) };
    }

    // 1) Source de vérité : on demande la commande À STRIPE (le client ne peut pas mentir)
    let session;
    try {
      session = await stripe.checkout.sessions.retrieve(session_id);
    } catch (stripeErr) {
      // session_id invalide ou inconnu → 400, pas 500
      return { statusCode: 400, body: JSON.stringify({ error: stripeErr.message, paid: false }) };
    }
    const paid = session.payment_status === "paid";
    const userId = session.metadata?.user_id;
    const credits = parseFloat(session.metadata?.credits || "0");
    const unlimitedDays = parseInt(session.metadata?.unlimited_days || "0", 10);

    let applied = false;

    // 2) On ne crédite QUE si Stripe confirme le paiement
    if (paid && userId && (credits > 0 || unlimitedDays > 0)) {
      const { data, error } = await getSupabase().rpc("apply_stripe_purchase", {
        p_event_id: session.id,        // clé = n° de commande (même que le webhook)
        p_session_id: session.id,
        p_user_id: userId,
        p_credits: credits,
        p_unlimited_days: unlimitedDays,
        p_description: `Achat ${session.metadata?.package || "credits"}`,
      });
      if (error) {
        console.error("[STRIPE_VERIFY] crédit échoué:", error.message);
      } else {
        const row = data && data[0];
        applied = !!(row && row.applied); // false si "déjà traité" (pas de double)
      }
    }

    // 3) On renvoie le solde à jour pour l'affichage
    let balance = null;
    if (paid && userId) {
      const { data } = await getSupabase().rpc("get_user_credits", { p_user_id: userId });
      if (data && data[0]) balance = data[0].credits_balance;
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        payment_status: session.payment_status,
        paid,
        applied,   // true = crédité à l'instant, false = déjà fait par le webhook
        balance,
      }),
    };
  } catch (error) {
    console.error("[STRIPE_VERIFY] erreur:", error.message);
    return { statusCode: 500, body: JSON.stringify({ success: false, error: error.message }) };
  }
};
