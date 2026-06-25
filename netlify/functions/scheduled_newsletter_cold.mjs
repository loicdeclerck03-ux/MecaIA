// SCHEDULED_NEWSLETTER_COLD.MJS — MecaIA
// Cron: tous les jours à 10h UTC (1h après scheduled_relance)
// Mission: séquence email cold prospects newsletter
//   J+4  (seq_step 1→2): cold_proof — 3 exemples réels clients
//   J+10 (seq_step 2→3): dernière chance — offre découverte 1€
// Cible: table newsletter_leads où status='active'
//
// ADR: séparé de scheduled_relance pour blast radius zéro

import { serviceClient, json } from "../lib/auth.mjs";

const RESEND_KEY = process.env.RESEND_API_KEY;
const FROM       = "Loïc de MecaIA <noreply@mecaiaauto.com>";
const SITE       = (process.env.FRONTEND_URL || "https://mecaiaauto.com").replace(/\/$/, "");

// ─── TEMPLATES ────────────────────────────────────────────────────────────────

function htmlBase(content) {
  return `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;background:#060809;margin:0;padding:0">
<div style="max-width:560px;margin:28px auto;background:#0d1520;border-radius:12px;overflow:hidden">
  <div style="background:#0d1520;border-bottom:3px solid #e8a000;padding:20px 28px">
    <span style="font-family:'Arial Black',Arial,sans-serif;font-size:20px;font-weight:900;letter-spacing:3px;color:#e8a000">MECA</span>
    <span style="font-family:'Arial Black',Arial,sans-serif;font-size:20px;font-weight:900;letter-spacing:3px;color:#fff">IA</span>
  </div>
  <div style="padding:26px 28px;font-size:15px;color:#b0bec5;line-height:1.7">
    ${content}
    <p style="color:#4a5568;font-size:12px;margin-top:20px;border-top:1px solid #1a2430;padding-top:14px">
      MecaIA &middot; mecaiaauto.com &middot; Belgique
    </p>
  </div>
</div></body></html>`;
}

const TEMPLATES = {

  // J+4 — cold_proof: exemples réels clients belges
  cold_proof: {
    subject: "Ce que MecaIA a trouvé pour 3 conducteurs cette semaine",
    html: () => htmlBase(`
      <p>Des exemples concrets de cette semaine&thinsp;:</p>

      <div style="background:#1a2430;border-radius:8px;padding:14px 18px;margin:12px 0;border-left:3px solid #e8a000">
        <strong style="color:#e8a000">Renault Clio IV 2016 &mdash; Li&egrave;ge</strong>
        <p style="color:#b0bec5;margin:8px 0 0;font-size:14px">
          Sympt&ocirc;me&thinsp;: surconsommation +16%. Dylan&thinsp;: sonde lambda amont HS.
          R&eacute;paration DIY&thinsp;: 85&euro; de pi&egrave;ce. &Eacute;conomie vs garage&thinsp;: 180&euro;.
        </p>
      </div>

      <div style="background:#1a2430;border-radius:8px;padding:14px 18px;margin:12px 0;border-left:3px solid #e8a000">
        <strong style="color:#e8a000">Peugeot 308 SW 2018 &mdash; Namur</strong>
        <p style="color:#b0bec5;margin:8px 0 0;font-size:14px">
          Sympt&ocirc;me&thinsp;: voyant moteur + perte de puissance. Dylan&thinsp;: vanne EGR encrassée.
          Nettoyage&thinsp;: 30&euro; d&apos;additif. &Eacute;vit&eacute;&thinsp;: 420&euro; de remplacement inutile.
        </p>
      </div>

      <div style="background:#1a2430;border-radius:8px;padding:14px 18px;margin:12px 0;border-left:3px solid #e8a000">
        <strong style="color:#e8a000">BMW E46 320d 2003 &mdash; Charleroi</strong>
        <p style="color:#b0bec5;margin:8px 0 0;font-size:14px">
          Sympt&ocirc;me&thinsp;: vibrations au ralenti. Dylan&thinsp;: injecteur 3 d&eacute;faillant.
          Remplacement cibl&eacute;&thinsp;: 280&euro;. Diagnostic garage estim&eacute;&thinsp;: 650&euro;.
        </p>
      </div>

      <p>Dylan fait &ccedil;a pour chaque voiture, en quelques messages, gratuitement.</p>

      <a href="${SITE}/?utm_source=newsletter&utm_medium=email&utm_campaign=cold_proof"
         style="display:block;background:#e8a000;color:#000;text-align:center;padding:14px;border-radius:8px;font-weight:700;font-size:15px;text-decoration:none;margin:20px 0">
        Diagnostiquer ma voiture maintenant &rarr;
      </a>
    `),
  },

  // J+10 — last_chance: offre découverte 1€
  last_chance: {
    subject: "Dernier message — offre pour d\u00e9couvrir MecaIA (1\u20ac)",
    html: () => htmlBase(`
      <p>C&apos;est mon dernier email &mdash; promis.</p>
      <p>Si tu n&apos;as pas encore essay&eacute; MecaIA, voici une offre simple&thinsp;:</p>

      <div style="background:#1a2430;border:2px solid #e8a000;border-radius:10px;padding:18px;text-align:center;margin:20px 0">
        <div style="color:#e8a000;font-size:26px;font-weight:700">1 diagnostic complet</div>
        <div style="color:#eef4fa;font-size:22px;margin:6px 0;font-weight:700">1&euro; seulement</div>
        <div style="color:#7a9ab5;font-size:13px">Sans abonnement &middot; Sans engagement</div>
      </div>

      <a href="${SITE}/tarifs?utm_source=newsletter&utm_medium=email&utm_campaign=last_chance"
         style="display:block;background:#e8a000;color:#000;text-align:center;padding:14px;border-radius:8px;font-weight:700;font-size:15px;text-decoration:none;margin:16px 0">
        Essayer pour 1&euro; &rarr;
      </a>

      <p style="font-size:13px;color:#4a5568">
        Apr&egrave;s &ccedil;a, si &ccedil;a ne t&apos;int&eacute;resse pas, pas de probl&egrave;me &mdash; je ne t&apos;enverrai plus rien.
      </p>
    `),
  },
};

// ─── HANDLER ──────────────────────────────────────────────────────────────────

export default async (req) => {
  // Auth: scheduled Netlify ou x-cron-secret
  let isScheduled = false;
  try {
    const body = await req.json();
    isScheduled = !!(body && body.next_run);
  } catch { /* pas de body */ }

  if (!isScheduled) {
    const secret = req.headers.get("x-cron-secret") || req.headers.get("x-netlify-token");
    if (!process.env.INTERNAL_API_KEY || secret !== process.env.INTERNAL_API_KEY) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
    }
  }

  if (!RESEND_KEY) {
    return new Response(JSON.stringify({ error: "RESEND_API_KEY manquante" }), { status: 500 });
  }

  const supabase = serviceClient();
  const now      = new Date();
  const cutoff_j4  = new Date(now - 4  * 86_400_000).toISOString(); // J+4
  const cutoff_j10 = new Date(now - 10 * 86_400_000).toISOString(); // J+10
  let envoyes = 0, erreurs = 0;

  // ── Étape 1 : J+4 → cold_proof (seq_step=1 depuis ≥4j) ────────────────────
  const { data: j4Leads, error: e1 } = await supabase
    .from("newsletter_leads")
    .select("email, source_code")
    .eq("status", "active")
    .eq("seq_step", 1)
    .lt("last_email_at", cutoff_j4);

  if (e1) console.error("[NL_COLD] J+4 query error:", e1.message);

  for (const lead of j4Leads || []) {
    try {
      const tmpl = TEMPLATES.cold_proof;
      const resp = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${RESEND_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from: FROM, to: [lead.email], subject: tmpl.subject, html: tmpl.html() }),
      });
      if (!resp.ok) throw new Error((await resp.json()).message);

      await supabase.from("newsletter_leads")
        .update({ seq_step: 2, last_email_at: now.toISOString() })
        .eq("email", lead.email);

      console.log(`[NL_COLD] J+4 cold_proof → ${lead.email}`);
      envoyes++;
    } catch (err) {
      console.error(`[NL_COLD] Erreur J+4 ${lead.email}:`, err.message);
      erreurs++;
    }
  }

  // ── Étape 2 : J+10 → last_chance (seq_step=2 depuis ≥10j) ────────────────
  const { data: j10Leads, error: e2 } = await supabase
    .from("newsletter_leads")
    .select("email")
    .eq("status", "active")
    .eq("seq_step", 2)
    .lt("last_email_at", cutoff_j10);

  if (e2) console.error("[NL_COLD] J+10 query error:", e2.message);

  for (const lead of j10Leads || []) {
    try {
      const tmpl = TEMPLATES.last_chance;
      const resp = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${RESEND_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from: FROM, to: [lead.email], subject: tmpl.subject, html: tmpl.html() }),
      });
      if (!resp.ok) throw new Error((await resp.json()).message);

      await supabase.from("newsletter_leads")
        .update({ seq_step: 3, last_email_at: now.toISOString(), status: "active" })
        .eq("email", lead.email);

      console.log(`[NL_COLD] J+10 last_chance → ${lead.email}`);
      envoyes++;
    } catch (err) {
      console.error(`[NL_COLD] Erreur J+10 ${lead.email}:`, err.message);
      erreurs++;
    }
  }

  console.log(`[NL_COLD] Terminé — j4:${(j4Leads||[]).length} j10:${(j10Leads||[]).length} envoyés:${envoyes} erreurs:${erreurs}`);
  return new Response(JSON.stringify({ success: true, envoyes, erreurs }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};

export const config = {
  schedule: "0 10 * * *",   // 10h UTC chaque jour (1h après scheduled_relance)
};
