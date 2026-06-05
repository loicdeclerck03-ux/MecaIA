// ============================================================
// STRIPE_CHECKOUT.MJS
// Prix via Price IDs serveur (non falsifiable). Code promo % optionnel
// -> coupon Stripe créé à la volée. Le client n'envoie que la clé du package.
// ============================================================

import Stripe from "stripe";
import { serviceClient } from "../lib/auth.mjs";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const PACKAGES = {
  "1credit":   { priceId: process.env.STRIPE_PRICE_1CREDIT,   credits: 1,  unlimitedDays: 0,  mode: "payment" },
  "25credits": { priceId: process.env.STRIPE_PRICE_25CREDITS, credits: 25, unlimitedDays: 0,  mode: "payment" },
  "60credits": { priceId: process.env.STRIPE_PRICE_60CREDITS, credits: 60, unlimitedDays: 0,  mode: "payment" },
  "unlimited": { priceId: process.env.STRIPE_PRICE_UNLIMITED, credits: 0,  unlimitedDays: 30, mode: "payment" },
};

export const handler = async (event) => {
  if (event.httpMethod !== "POST") return { statusCode: 405, body: JSON.stringify({ error: "POST only" }) };

  try {
    const { user_id, package: packageKey, promo_code } = JSON.parse(event.body || "{}");
    if (!user_id) return { statusCode: 400, body: JSON.stringify({ error: "Missing user_id" }) };

    const pkg = PACKAGES[packageKey];
    if (!pkg) return { statusCode: 400, body: JSON.stringify({ error: "Unknown package", allowed: Object.keys(PACKAGES) }) };
    if (!pkg.priceId) return { statusCode: 500, body: JSON.stringify({ error: `Price ID manquant pour ${packageKey}` }) };

    const base = process.env.FRONTEND_URL;
    if (!base) return { statusCode: 500, body: JSON.stringify({ error: "FRONTEND_URL non définie" }) };

    // Code promo % optionnel -> coupon Stripe à la volée
    let discounts;
    let bumpId = null;
    if (promo_code) {
      const supabase = serviceClient();
      const { data: pv } = await supabase.rpc("validate_percent_promo", { p_code: promo_code });
      const v = pv && pv[0];
      if (v && v.valid) {
        const coupon = await stripe.coupons.create({ percent_off: Number(v.percent), duration: "once" });
        discounts = [{ coupon: coupon.id }];
        bumpId = v.code_id;
      } else {
        return { statusCode: 400, body: JSON.stringify({ success: false, error: "Code promo invalide ou expiré" }) };
      }
    }

    const session = await stripe.checkout.sessions.create({
      mode: pkg.mode,
      line_items: [{ price: pkg.priceId, quantity: 1 }],
      ...(discounts ? { discounts } : {}),
      success_url: `${base}/credits?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${base}/credits`,
      metadata: {
        user_id,
        package: packageKey,
        credits: String(pkg.credits),
        unlimited_days: String(pkg.unlimitedDays),
      },
    });

    if (bumpId) {
      const supabase = serviceClient();
      await supabase.rpc("bump_percent_promo", { p_id: bumpId });
    }

    return { statusCode: 200, body: JSON.stringify({ success: true, checkout_url: session.url, session_id: session.id }) };
  } catch (error) {
    console.error("[STRIPE_CHECKOUT] error:", error.message);
    return { statusCode: 500, body: JSON.stringify({ success: false, error: error.message }) };
  }
};
