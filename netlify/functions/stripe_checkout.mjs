// ============================================================
// STRIPE_CHECKOUT.MJS  — v3 (17/06/2026)
// Nouvelle grille tarifaire :
//   4,99€ / 8 cr (Starter)
//   9,99€ / 30 cr (Standard)
//   19,99€ / 80 cr (Expert)
//   7,99€/mois / 20 cr/mois (Mensuel)
// Ancienne grille toujours supportée via alias (rétro-compat).
// ============================================================

import Stripe from "stripe";
import { getUser, serviceClient, json, preflight } from "../lib/auth.mjs";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Price IDs : env var en priorité, fallback hardcodé
const pid = (envKey, fallback) => process.env[envKey] || fallback;

const PACKAGES = {

  // ─── NOUVELLE GRILLE (v3) ────────────────────────────────────────────────
  "starter": {
    priceId      : pid("STRIPE_PRICE_STARTER",   "price_1TjIGWQ1QuRc9MT3SoG56OBO"),
    credits      : 8,
    unlimitedDays: 0,
    mode         : "payment",
    label        : "Pack Starter — 8 crédits · 4,99 €",
  },
  "standard": {
    priceId      : pid("STRIPE_PRICE_25CREDITS",  "price_1TheRtQ1QuRc9MT3lVQUbgts"),
    credits      : 30,          // 9,99€ mais 30 crédits (vs 20 avant)
    unlimitedDays: 0,
    mode         : "payment",
    label        : "Pack Standard — 30 crédits · 9,99 €",
  },
  "expert": {
    priceId      : pid("STRIPE_PRICE_60CREDITS",  "price_1TheRxQ1QuRc9MT3SlOYvBHj"),
    credits      : 80,          // 19,99€ mais 80 crédits (vs 50 avant)
    unlimitedDays: 0,
    mode         : "payment",
    label        : "Pack Expert — 80 crédits · 19,99 €",
  },
  "monthly": {
    priceId      : pid("STRIPE_PRICE_MONTHLY",    "price_1TjIGeQ1QuRc9MT3ZaerD2EJ"),
    credits      : 20,          // 20 crédits ajoutés chaque mois
    unlimitedDays: 0,
    mode         : "subscription",
    label        : "MecaIA Mensuel — 20 crédits/mois · 7,99 €/mois",
  },

  // ─── ALIAS RÉTRO-COMPAT (anciens appels frontend) ────────────────────────
  "20credits"  : null,  // remplacé par "standard"
  "25credits"  : null,
  "50credits"  : null,
  "60credits"  : null,
  "1credit"    : null,
  "unlimited"  : null,
};

// Résoudre les alias null vers leur équivalent v3
const resolvePackage = (key) => {
  if (key === "20credits" || key === "25credits") return PACKAGES["standard"];
  if (key === "50credits" || key === "60credits") return PACKAGES["expert"];
  if (key === "1credit")    return PACKAGES["starter"];
  if (key === "unlimited")  return PACKAGES["monthly"];
  return PACKAGES[key] || null;
};

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return preflight();
  if (event.httpMethod !== "POST")
    return json(405, { error: "POST only" });

  // Vérification JWT obligatoire
  const auth = await getUser(event);
  if (!auth) return json(401, { error: "Unauthorized" });
  const user_id = auth.userId;

  try {
    const { package: packageKey, promo_code } = JSON.parse(event.body || "{}");

    const pkg = resolvePackage(packageKey);
    if (!pkg)
      return json(400, { error: "Unknown package", allowed: Object.keys(PACKAGES).filter(k => PACKAGES[k]) });
    if (!pkg.priceId)
      return json(500, { error: `Price ID manquant pour ${packageKey}` });

    const base = (process.env.FRONTEND_URL || "https://mecaiaauto.com").replace(/\/$/, "");

    // Code promo % optionnel → coupon Stripe à la volée
    let discounts;
    let bumpId = null;
    if (promo_code && pkg.mode === "payment") {
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
        return json(400, { success: false, error: "Code promo invalide ou expiré" });
      }
    }

    // Paramètres communs Checkout
    const sessionParams = {
      mode      : pkg.mode,
      line_items: [{ price: pkg.priceId, quantity: 1 }],
      ...(discounts ? { discounts } : {}),
      success_url: `${base}?payment=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url : `${base}?payment=cancel`,
      // Métadonnées session (one-time)
      metadata   : {
        user_id,
        package      : packageKey,
        credits      : String(pkg.credits),
        unlimited_days: String(pkg.unlimitedDays),
      },
    };

    // Pour les abonnements : attacher aussi les métadonnées à la subscription
    // pour que les renouvellements mensuels puissent créditer l'utilisateur
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

    return json(200, {
      success     : true,
      checkout_url: session.url,
      session_id  : session.id,
    });

  } catch (error) {
    console.error("[STRIPE_CHECKOUT] error:", error.message);
    return json(500, { success: false, error: error.message });
  }
};
