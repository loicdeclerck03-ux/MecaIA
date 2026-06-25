// EMAIL_MARKETING_SEQUENCE.mjs — MecaIA
// Séquence marketing 5 emails pour acquisition/activation
// Déclencheur: manuel (admin) ou via cron selon segment
// Segments: cold_prospect, inactive_user, first_diag_done
//
// USAGE: POST /.netlify/functions/email_marketing_sequence
// Body: { segment: "cold_prospect"|"inactive_user"|"first_diag_done", email, name }

import { json, preflight } from "../lib/auth.mjs";

const RESEND_KEY = process.env.RESEND_API_KEY;
const FROM = "Loïc de MecaIA <noreply@mecaiaauto.com>";
const SITE = (process.env.FRONTEND_URL || "https://mecaiaauto.com").replace(/\/$/, "");

// ─── TEMPLATES ────────────────────────────────────────────────────────────────

const TEMPLATES = {

  // === Séquence 1: Prospect froid (visite site sans inscription) ===
  cold_welcome: {
    subject: "Votre voiture a peut-être un code erreur silencieux",
    html: (n) => emailBase(n || "Automobiliste", `
      <p>80% des voitures roulent avec un code erreur stocké que le propriétaire ne connaît pas.</p>
      <p>Ces codes peuvent indiquer une panne en cours de formation — souvent réparable à 50€ maintenant, mais à 500€ dans 3 mois si ignorée.</p>
      <p>En 2 minutes et sans aucun équipement, Dylan IA peut commencer le diagnostic de votre voiture par simple description des symptômes.</p>
      <cta href="${SITE}/?utm_source=email&utm_medium=marketing&utm_campaign=cold_welcome">Essayer le diagnostic gratuit →</cta>
    `)
  },

  cold_proof: {
    subject: "Ce que MecaIA a trouvé pour 3 conducteurs cette semaine",
    html: (n) => emailBase(n || "", `
      <p>Trois exemples réels de cette semaine :</p>
      <div style="background:#1a2430;border-radius:8px;padding:16px;margin:12px 0;border-left:3px solid #e8a000">
        <strong style="color:#e8a000">Renault Clio IV 2016 — Liège</strong>
        <p style="color:#b0bec5;margin:8px 0 0;font-size:14px">Symptôme: surconsommation +2L/100. Dylan: sonde lambda amont HS. Réparation DIY: 85€ de pièce, 30 min. Économie vs garage: 180€.</p>
      </div>
      <div style="background:#1a2430;border-radius:8px;padding:16px;margin:12px 0;border-left:3px solid #e8a000">
        <strong style="color:#e8a000">Peugeot 308 SW 2018 — Namur</strong>
        <p style="color:#b0bec5;margin:8px 0 0;font-size:14px">Symptôme: voyant moteur + perte de puissance. Dylan: vanne EGR encrassée. Nettoyage: 30€ d'additif. Évité: 420€ de remplacement inutile.</p>
      </div>
      <div style="background:#1a2430;border-radius:8px;padding:16px;margin:12px 0;border-left:3px solid #e8a000">
        <strong style="color:#e8a000">BMW E46 320d 2003 — Charleroi</strong>
        <p style="color:#b0bec5;margin:8px 0 0;font-size:14px">Symptôme: vibrations ralenti. Dylan: injecteur 3 défaillant (débit 85cc/min vs max 40). Remplacement ciblé: 280€. Diagnostic garage: 650€.</p>
      </div>
      <cta href="${SITE}/?utm_source=email&utm_medium=marketing&utm_campaign=cold_proof">Diagnostiquer ma voiture →</cta>
    `)
  },

  // === Séquence 2: Utilisateur inactif (inscrit mais pas de diagnostic depuis 14j) ===
  inactive_nudge: {
    subject: "Dylan attend votre première question — 2 min suffisent",
    html: (n) => emailBase(n || "", `
      <p>Vous vous êtes inscrit(e) il y a quelques jours mais Dylan n'a pas encore eu l'occasion de vous aider.</p>
      <p>Pas de panne ? Parfait. Mais avez-vous déjà demandé à Dylan d'analyser vos données moteur en temps réel ?</p>
      <p>Connectez simplement votre boîtier OBD2 et posez : <em style="color:#e8a000">"Tout est normal sur ma voiture ?"</em></p>
      <cta href="${SITE}/?utm_source=email&utm_medium=marketing&utm_campaign=inactive_nudge">Ouvrir Dylan IA →</cta>
    `)
  },

  inactive_offer: {
    subject: "5 diagnostics offerts — valable jusqu'à vendredi",
    html: (n) => emailBase(n || "", `
      <p>Pour que vous puissiez tester MecaIA sur une vraie panne (ou juste par curiosité), voici 5 diagnostics supplémentaires offerts.</p>
      <div style="background:#1a2430;border:2px solid #e8a000;border-radius:10px;padding:20px;text-align:center;margin:20px 0">
        <div style="color:#e8a000;font-size:28px;font-weight:700">+5 diagnostics</div>
        <div style="color:#eef4fa;margin:8px 0">Code: <strong style="font-family:monospace;color:#e8a000">ACTIF5</strong></div>
        <div style="color:#b0bec5;font-size:13px">Valable jusqu'à vendredi 23h59</div>
      </div>
      <cta href="${SITE}/tarifs?promo=ACTIF5&utm_source=email&utm_medium=marketing&utm_campaign=inactive_offer">Activer mes 5 diagnostics →</cta>
    `)
  },

  // === Séquence 3: Après premier diagnostic réussi ===
  post_diag_upgrade: {
    subject: "Votre diagnostic était ✓ — voici ce que Dylan peut faire de plus",
    html: (n) => emailBase(n || "", `
      <p>Votre premier diagnostic avec Dylan s'est bien passé. Voici les fonctionnalités que vous n'avez peut-être pas encore utilisées :</p>
      <ul style="color:#b0bec5;padding-left:20px;line-height:2">
        <li><strong style="color:#eef4fa">Analyse Freeze Frame</strong> — "Pourquoi ce code s'est déclenché exactement ?"</li>
        <li><strong style="color:#eef4fa">Fuel Trims</strong> — "Mes corrections carburant sont-elles normales ?"</li>
        <li><strong style="color:#eef4fa">Surveillance continue</strong> — Dylan surveille vos PIDs et alerte si quelque chose change</li>
        <li><strong style="color:#eef4fa">Rapport PDF</strong> — Diagnostic complet à partager avec votre garagiste</li>
      </ul>
      <cta href="${SITE}/?utm_source=email&utm_medium=marketing&utm_campaign=post_diag_upgrade">Explorer les fonctionnalités →</cta>
    `)
  },
};

// ─── HELPER TEMPLATE HTML ─────────────────────────────────────────────────────

function emailBase(name, content) {
  const cta_html = content.replace(
    /<cta href="([^"]+)">(.+?)<\/cta>/g,
    (_, href, label) =>
      `<a href="${href}" style="display:block;background:#e8a000;color:#000;text-align:center;padding:14px;border-radius:8px;font-weight:700;font-size:15px;text-decoration:none;margin:24px 0">${label}</a>`
  );
  return `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;background:#060809;margin:0;padding:0">
<div style="max-width:600px;margin:0 auto;background:#0d1520;border-radius:12px;overflow:hidden;margin-top:20px">
  <div style="background:#0d1520;border-bottom:3px solid #e8a000;padding:24px 28px">
    <span style="font-family:'Arial Black',Arial,sans-serif;font-size:22px;font-weight:900;letter-spacing:3px;color:#e8a000">MECA</span>
    <span style="font-family:'Arial Black',Arial,sans-serif;font-size:22px;font-weight:900;letter-spacing:3px;color:#fff">IA</span>
  </div>
  <div style="padding:28px">
    ${name ? `<h2 style="color:#eef4fa;font-size:18px;margin:0 0 16px">Bonjour ${name}&thinsp;👋</h2>` : ''}
    <div style="color:#b0bec5;line-height:1.7;font-size:15px">${cta_html}</div>
    <p style="color:#4a5568;font-size:12px;margin-top:24px;border-top:1px solid #1a2430;padding-top:16px">
      MecaIA · mecaiaauto.com · Belgique<br>
      <a href="${SITE}/unsubscribe" style="color:#4a5568">Se désabonner</a>
    </p>
  </div>
</div></body></html>`;
}

// ─── HANDLER ──────────────────────────────────────────────────────────────────

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return preflight();
  if (event.httpMethod !== "POST") return json(405, { error: "POST only" });

  // Admin only - vérifie le token interne
  const secret = event.headers["x-admin-token"] || "";
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET)
    return json(401, { error: "Admin only" });

  let body;
  try { body = JSON.parse(event.body || "{}"); } catch { return json(400, { error: "JSON invalide" }); }

  const { segment, email, name } = body;
  if (!segment || !email) return json(400, { error: "segment + email requis" });
  if (!TEMPLATES[segment]) return json(400, { error: `Segment inconnu: ${segment}. Disponibles: ${Object.keys(TEMPLATES).join(", ")}` });
  if (!RESEND_KEY) return json(500, { error: "RESEND_API_KEY manquante" });

  const tmpl = TEMPLATES[segment];
  const resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: FROM, to: [email], subject: tmpl.subject, html: tmpl.html(name || "") }),
  });

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    return json(500, { error: err.message || "Resend error", details: err });
  }

  const data = await resp.json();
  return json(200, { success: true, email_id: data.id, segment, to: email });
};
