// ============================================================
// STRIPE_CHECKOUT.MJS  — v4 (17/06/2026)
// Grille complète MecaIA :
//   PACKS (one-time)  : starter 4,99€/8cr · standard 9,99€/30cr · expert 19,99€/80cr
//   ABONNEMENTS MOIS  : solo_monthly 7,99€/20cr · pro_monthly 12,99€/50cr
//   ABONNEMENTS ANNUELS : solo_annual 59,99€/240cr · pro_annual 99,99€/600cr
//   BOX hardware       : box 39,99€ (boitier OBD2 physique)
// ============================================================

import Stripe from "stripe";
import { getUser, serviceClient, json, preflight } from "../lib/auth.mjs";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const pid = (envKey, fallback) => process.env[envKey] || fallback;

const PACKAGES = {

  // ── PACKS CRÉDITS (sans engagement, crédits sans expiration) ──────────────
  "starter": {
    priceId      : pid("STRIPE_PRICE_STARTER",      "price_1TjIGWQ1QuRc9MT3SoG56OBO"),
    credits      : 8,
    unlimitedDays: 0,
    mode         : "payment",
    label        : "Pack Starter — 8 crédits · 4,99 €",
  },
  "standard": {
    priceId      : pid("STRIPE_PRICE_STANDARD",     "price_1TheRtQ1QuRc9MT3lVQUbgts"),
    credits      : 30,
    unlimitedDays: 0,
    mode         : "payment",
    label        : "Pack Standard — 30 crédits · 9,99 €",
  },
  "expert": {
    priceId      : pid("STRIPE_PRICE_EXPERT",       "price_1TheRxQ1QuRc9MT3SlOYvBHj"),
    credits      : 80,
    unlimitedDays: 0,
    mode         : "payment",
    label        : "Pack Expert — 80 crédits · 19,99 €",
  },

  // ── ABONNEMENTS MENSUELS (résiliables à tout moment) ─────────────────────
  "solo_monthly": {
    priceId      : pid("STRIPE_PRICE_SOLO_MONTHLY", "price_1TjIGeQ1QuRc9MT3ZaerD2EJ"),
    credits      : 20,
    unlimitedDays: 0,
    mode         : "subscription",
    label        : "Solo Mensuel — 20 crédits/mois · 7,99 €/mois",
  },
  "pro_monthly": {
    priceId      : pid("STRIPE_PRICE_PRO_MONTHLY",  "price_1TjIV9Q1QuRc9MT3OCIeA0VA"),
    credits      : 50,
    unlimitedDays: 0,
    mode         : "subscription",
    label        : "Pro Mensuel — 50 crédits/mois · 12,99 €/mois",
  },

  // ── ABONNEMENTS ANNUELS (renouvellement auto, résiliables) ────────────────
  "solo_annual": {
    priceId      : pid("STRIPE_PRICE_SOLO_ANNUAL",  "price_1TjIVFQ1QuRc9MT3OzIRvlnf"),
    credits      : 240,         // 240 crédits donnés d'un coup à chaque renouvellement
    unlimitedDays: 0,
    mode         : "subscription",
    label        : "Solo Annuel — 240 crédits · 59,99 €/an",
  },
  "pro_annual": {
    priceId      : pid("STRIPE_PRICE_PRO_ANNUAL",   "price_1TjIVLQ1QuRc9MT3d8dbP4dO"),
    credits      : 600,         // 600 crédits donnés d'un coup à chaque renouvellement
    unlimitedDays: 0,
    mode         : "subscription",
    label        : "Pro Annuel — 600 crédits · 99,99 €/an",
  },

  // ── BOX OBD2 (hardware physique, pré-commande) ────────────────────────────
  // Note : laisser en commentaire jusqu'à la mise en stock du boîtier V1
  // "box": {
  //   priceId      : pid("STRIPE_PRICE_BOX", "price_BOX_TODO"),
  //   credits      : 10,         // 10 crédits offerts avec le boîtier
  //   unlimitedDays: 0,
  //   mode         : "payment",
  //   label        : "MecaIA Box — Boîtier OBD2 + 10 crédits · 39,99 €",
  // },

  // ── ALIAS RÉTRO-COMPAT ────────────────────────────────────────────────────
  "monthly"   : null,   // → solo_monthly
  "20credits" : null,   // → standard
  "25credits" : null,
  "50credits" : null,   // → expert
  "60credits" : null,
  "1credit"   : null,   // → starter
  "unlimited" : null,   // → pro_monthly
};

const resolvePackage = (key) => {
  const direct = PACKAGES[key];
  if (direct !== undefined && direct !== null) return direct;
  // Résoudre les alias
  if (key === "monthly")    return PACKAGES["solo_monthly"];
  if (key === "20credits" || key === "25credits") return PACKAGES["standard"];
  if (key === "50credits" || key === "60credits") return PACKAGES["expert"];
  if (key === "1credit")    return PACKAGES["starter"];
  if (key === "unlimited")  return PACKAGES["pro_monthly"];
  return null;
};

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return preflight();
  if (event.httpMethod !== "POST")
    return json(405, { error: "POST only" });

  const auth = await getUser(event);
  if (!auth) return json(401, { error: "Unauthorized" });
  const user_id = auth.userId;

  try {
    const { package: packageKey, promo_code } = JSON.parse(event.body || "{}");

    const pkg = resolvePackage(packageKey);
    if (!pkg) {
      const allowed = Object.keys(PACKAGES).filter(k => PACKAGES[k] !== null && PACKAGES[k] !== undefined);
      return json(400, { error: "Unknown package", allowed });
    }
    if (!pkg.priceId)
      return json(500, { error: `Price ID manquant pour ${packageKey}` });

    const base = (process.env.FRONTEND_URL || "https://mecaiaauto.com").replace(/\/$/, "");

    // Code promo (uniquement sur les packs one-time)
    let discounts;
    let bumpId = null;
    if (promo_code && pkg.mode === "payment") {
      const supabase = serviceClient();
      const { data: pv } = await supabase.rpc("validate_percent_promo", { p_code: promo_code });
      const v = pv && pv[0];
      if (v && v.valid) {
        const coupon = await stripe.coupons.create({ percent_off: Number(v.percent), duration: "once" });
        discounts = [{ coupon: coupon.id }];
        bumpId = v.code_id;
      } else {
        return json(400, { success: false, error: "Code promo invalide ou expiré" });
      }
    }

    const sessionParams = {
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
    };

    // Pour les abonnements : attacher metadata à la subscription pour le webhook de renouvellement
    if (pkg.mode === "subscription") {
      sessionParams.subscription_data = {
        metadata: {
          user_id,
          package: packageKey,
          credits: String(pkg.credits),
        },
      };
    }

    const session = await stripe.checkout.sessions.create(sessionParams);

    if (bumpId) {
      const supabase = serviceClient();
      await supabase.rpc("bump_percent_promo", { p_id: bumpId });
    }

    return json(200, { success: true, checkout_url: session.url, session_id: session.id });

  } catch (error) {
    console.error("[STRIPE_CHECKOUT] error:", error.message);
    return json(500, { success: false, error: error.message });
  }
};
