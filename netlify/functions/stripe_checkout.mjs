// ============================================================
// STRIPE_CHECKOUT.MJS  — v2 (13/06/2026)
// Nouveaux prix Loïc : 1€/1cr · 9,99€/20cr · 19,99€/50cr · 29,99€/illim30j
// Price IDs en dur (fallback) + env vars (priorité).
// Code promo % optionnel -> coupon Stripe à la volée.
// ============================================================

import Stripe from "stripe";
import { getUser, serviceClient, json, preflight } from "../lib/auth.mjs";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Price IDs : env var en priorité, fallback hardcodé si var absente/vide
const pid = (envKey, fallback) => process.env[envKey] || fallback;

const PACKAGES = {
  "1credit": {
    priceId      : pid("STRIPE_PRICE_1CREDIT",   "price_1TbQghQ1QuRc9MT37T4MItNy"),
    credits      : 1,
    unlimitedDays: 0,
    mode         : "payment",
    label        : "Pack Découverte — 1 crédit · 1 €",
  },
  "20credits": {
    priceId      : pid("STRIPE_PRICE_25CREDITS",  "price_1TheRtQ1QuRc9MT3lVQUbgts"),
    credits      : 20,
    unlimitedDays: 0,
    mode         : "payment",
    label        : "Pack Standard — 20 crédits · 9,99 €",
  },
  "50credits": {
    priceId      : pid("STRIPE_PRICE_60CREDITS",  "price_1TheRxQ1QuRc9MT3SlOYvBHj"),
    credits      : 50,
    unlimitedDays: 0,
    mode         : "payment",
    label        : "Pack Expert — 50 crédits · 19,99 €",
  },
  "unlimited": {
    priceId      : pid("STRIPE_PRICE_UNLIMITED",  "price_1TheS1Q1QuRc9MT3xIGMtPRp"),
    credits      : 0,
    unlimitedDays: 30,
    mode         : "payment",
    label        : "Pack Garage — Illimité 30 jours · 29,99 €",
  },
};

// Alias rétro-compatibilité (anciens appels frontend "25credits"/"60credits")
PACKAGES["25credits"] = PACKAGES["20credits"];
PACKAGES["60credits"] = PACKAGES["50credits"];

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return preflight();
  if (event.httpMethod !== "POST")
    return json(405, { error: "POST only" });

  // Vérification JWT obligatoire — user_id extrait du token, jamais du body
  const auth = await getUser(event);
  if (!auth) return json(401, { error: "Unauthorized" });
  const user_id = auth.userId;

  try {
    const { package: packageKey, promo_code } = JSON.parse(event.body || "{}");

    const pkg = PACKAGES[packageKey];
    if (!pkg)
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Unknown package", allowed: Object.keys(PACKAGES) }),
      };
    if (!pkg.priceId)
      return {
        statusCode: 500,
        body: JSON.stringify({ error: `Price ID manquant pour ${packageKey}` }),
      };

    const base = (process.env.FRONTEND_URL || "https://mecaiaauto.com").replace(/\/$/, "");

    // Code promo % optionnel → coupon Stripe à la volée
    let discounts;
    let bumpId = null;
    if (promo_code) {
      const supabase = serviceClient();
      const { data: pv } = await supabase.rpc("validate_percent_promo", { p_code: promo_code });
      const v = pv && pv[0];
      if (v && v.valid) {
        const coupon = await stripe.coupons.create({
          percent_off: Number(v.percent),
          duration   : "once",
        });
        discounts = [{ coupon: coupon.id }];
        bumpId = v.code_id;
      } else {
        return {
          statusCode: 400,
          body: JSON.stringify({ success: false, error: "Code promo invalide ou expiré" }),
        };
      }
    }

    const session = await stripe.checkout.sessions.create({
      mode      : pkg.mode,
      line_items: [{ price: pkg.priceId, quantity: 1 }],
      ...(discounts ? { discounts } : {}),
      success_url: `${base}?payment=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url : `${base}?payment=cancel`,
      metadata   : {
        user_id,
        package      : packageKey,
        credits      : String(pkg.credits),
        unlimited_days: String(pkg.unlimitedDays),
      },
    });

    if (bumpId) {
      const supabase = serviceClient();
      await supabase.rpc("bump_percent_promo", { p_id: bumpId });
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        success     : true,
        checkout_url: session.url,
        session_id  : session.id,
      }),
    };
  } catch (error) {
    console.error("[STRIPE_CHECKOUT] error:", error.message);
    return {
      statusCode: 500,
      body: JSON.stringify({ success: false, error: error.message }),
    };
  }
};
