// scheduled_onboarding.mjs — MecaIA
// Cron: quotidien 9h UTC — envoie la sequence email onboarding J+1/J+3/J+7
// Objectif : convertir beta testeurs en abonnes payants
import { serviceClient, preflight } from "../lib/auth.mjs";

const RESEND_KEY = process.env.RESEND_API_KEY;
const FROM = "Dylan MecaIA <noreply@mecaiaauto.com>";
const SITE = (process.env.FRONTEND_URL || "https://mecaiaauto.com").replace(/\/$/, "");

const EMAILS = {
  j1: {
    subject: "Votre premier diagnostic avec MecaIA — 2 minutes suffisent",
    html: (name) => `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;background:#060809;color:#eef4fa;padding:0;margin:0">
<div style="max-width:600px;margin:0 auto;background:#0d1520;border-radius:12px;overflow:hidden">
<div style="background:#0d1520;border-bottom:3px solid #e8a000;padding:24px 28px">
  <h1 style="color:#e8a000;font-size:22px;margin:0;font-family:Georgia,serif">MecaIA</h1>
  <p style="color:#7a9ab5;font-size:12px;margin:6px 0 0">Votre expert automobile IA</p>
</div>
<div style="padding:28px">
  <h2 style="color:#eef4fa;font-size:18px;margin:0 0 16px">Bonjour ${name || ""},</h2>
  <p style="color:#b0bec5;line-height:1.7">Vous venez de rejoindre MecaIA — bienvenue dans la beta !</p>
  <p style="color:#b0bec5;line-height:1.7">Voici comment faire votre <strong style="color:#eef4fa">premier diagnostic en 2 minutes</strong> :</p>
  <ol style="color:#b0bec5;line-height:2;padding-left:20px">
    <li>Ajoutez votre voiture dans <strong style="color:#e8a000">Mon Garage</strong></li>
    <li>Cliquez sur <strong style="color:#e8a000">Dylan IA</strong></li>
    <li>Décrivez votre problème en langage naturel (ex: "mon moteur vibre au ralenti")</li>
  </ol>
  <a href="${SITE}/?utm_source=email&utm_medium=onboarding&utm_campaign=j1" style="display:block;background:#e8a000;color:#000;text-align:center;padding:14px;border-radius:8px;font-weight:700;font-size:15px;text-decoration:none;margin:24px 0">Lancer mon premier diagnostic →</a>
  <p style="color:#4a5568;font-size:12px;line-height:1.5">Vous recevez cet email car vous vous êtes inscrit(e) sur MecaIA beta. <a href="${SITE}/unsubscribe" style="color:#4a5568">Se désabonner</a></p>
</div></div></body></html>`,
  },
  j3: {
    subject: "Ce que MecaIA a trouvé pour les autres utilisateurs cette semaine",
    html: (name) => `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;background:#060809;color:#eef4fa;padding:0;margin:0">
<div style="max-width:600px;margin:0 auto;background:#0d1520;border-radius:12px;overflow:hidden">
<div style="background:#0d1520;border-bottom:3px solid #e8a000;padding:24px 28px">
  <h1 style="color:#e8a000;font-size:22px;margin:0;font-family:Georgia,serif">MecaIA</h1>
</div>
<div style="padding:28px">
  <h2 style="color:#eef4fa;font-size:18px;margin:0 0 16px">Bonjour ${name || ""},</h2>
  <p style="color:#b0bec5;line-height:1.7">Voici 3 diagnostics que Dylan a résolus cette semaine :</p>
  <div style="background:#1a2430;border-radius:8px;padding:16px;margin:12px 0;border-left:3px solid #e8a000">
    <strong style="color:#e8a000">Peugeot 308 2014</strong>
    <p style="color:#b0bec5;margin:6px 0 0;font-size:14px">"Vibrations au ralenti" → EGR colmaté (réparation : 280€ chez un indépendant au lieu de 450€ en concession)</p>
  </div>
  <div style="background:#1a2430;border-radius:8px;padding:16px;margin:12px 0;border-left:3px solid #e8a000">
    <strong style="color:#e8a000">BMW 320d E46 2003</strong>
    <p style="color:#b0bec5;margin:6px 0 0;font-size:14px">"Voyant jaune moteur" → Code P0401, vanne EGR bloquée (DIY possible : 45€ de pièce)</p>
  </div>
  <div style="background:#1a2430;border-radius:8px;padding:16px;margin:12px 0;border-left:3px solid #e8a000">
    <strong style="color:#e8a000">Renault Clio 4 2016</strong>
    <p style="color:#b0bec5;margin:6px 0 0;font-size:14px">"Surconsommation essence" → Sonde lambda amont HS (85€ + 30 min de DIY)</p>
  </div>
  <a href="${SITE}/?utm_source=email&utm_medium=onboarding&utm_campaign=j3" style="display:block;background:#e8a000;color:#000;text-align:center;padding:14px;border-radius:8px;font-weight:700;font-size:15px;text-decoration:none;margin:24px 0">Diagnostiquer ma voiture →</a>
  <p style="color:#4a5568;font-size:12px">MecaIA beta · <a href="${SITE}/unsubscribe" style="color:#4a5568">Se désabonner</a></p>
</div></div></body></html>`,
  },
  j7: {
    subject: "Offre beta exclusive : -30% sur votre premier pack (48h)",
    html: (name) => `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;background:#060809;color:#eef4fa;padding:0;margin:0">
<div style="max-width:600px;margin:0 auto;background:#0d1520;border-radius:12px;overflow:hidden">
<div style="background:#0d1520;border-bottom:3px solid #e8a000;padding:24px 28px">
  <h1 style="color:#e8a000;font-size:22px;margin:0;font-family:Georgia,serif">MecaIA</h1>
  <p style="color:#e8a000;font-size:11px;margin:4px 0 0;font-weight:700;letter-spacing:2px">OFFRE BETA EXCLUSIVE</p>
</div>
<div style="padding:28px">
  <h2 style="color:#eef4fa;font-size:18px;margin:0 0 16px">Bonjour ${name || ""},</h2>
  <p style="color:#b0bec5;line-height:1.7">Ça fait 7 jours que vous êtes dans la beta MecaIA. Pour vous remercier d'avoir testé le produit :</p>
  <div style="background:#1a2430;border:2px solid #e8a000;border-radius:10px;padding:20px;margin:20px 0;text-align:center">
    <div style="color:#e8a000;font-size:32px;font-weight:700;font-family:Georgia,serif">-30%</div>
    <div style="color:#eef4fa;font-size:16px;margin:8px 0">sur votre premier pack de crédits</div>
    <div style="color:#b0bec5;font-size:13px;margin-bottom:16px">Code : <strong style="color:#e8a000;font-family:monospace">BETA30</strong> · Valable 48h</div>
    <a href="${SITE}/tarifs?promo=BETA30&utm_source=email&utm_medium=onboarding&utm_campaign=j7" style="display:inline-block;background:#e8a000;color:#000;padding:12px 28px;border-radius:8px;font-weight:700;font-size:14px;text-decoration:none">Activer mon offre beta →</a>
  </div>
  <p style="color:#4a5568;font-size:12px;text-align:center">Pack Expert (50 crédits) : <s style="color:#4a5568">19.99€</s> → <strong style="color:#eef4fa">13.99€</strong> avec BETA30</p>
  <p style="color:#4a5568;font-size:12px">MecaIA beta · <a href="${SITE}/unsubscribe" style="color:#4a5568">Se désabonner</a></p>
</div></div></body></html>`,
  },
};

export default async (req, context) => {
  let scheduled = false;
  try { const b = await req.json(); scheduled = !!(b && b.next_run); } catch {}

  if (!scheduled) {
    const secret = req.headers.get("x-cron-secret") || req.headers.get("x-netlify-token");
    if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET)
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }

  if (!RESEND_KEY) return new Response(JSON.stringify({ error: "RESEND_API_KEY manquante" }), { status: 500 });

  const supa = serviceClient();

  // Récupérer les emails à envoyer (send_after <= maintenant, pas encore envoyés)
  const { data: pending, error } = await supa
    .from("onboarding_emails")
    .select("id, user_id, email, step, send_after")
    .is("sent_at", null)
    .lte("send_after", new Date().toISOString())
    .limit(50);

  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  if (!pending || pending.length === 0)
    return new Response(JSON.stringify({ sent: 0, message: "Rien à envoyer" }), { status: 200 });

  let sent = 0, failed = 0;

  for (const item of pending) {
    const tmpl = EMAILS[item.step];
    if (!tmpl) continue;

    // Récupérer le prénom de l'utilisateur
    const { data: profile } = await supa
      .from("profiles")
      .select("name")
      .eq("id", item.user_id)
      .single();
    const name = profile?.name?.split(" ")[0] || "";

    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: FROM, to: [item.email], subject: tmpl.subject, html: tmpl.html(name) }),
    });

    const now = new Date().toISOString();
    if (resp.ok) {
      await supa.from("onboarding_emails").update({ sent_at: now }).eq("id", item.id);
      sent++;
    } else {
      const errData = await resp.json().catch(() => ({}));
      await supa.from("onboarding_emails").update({ error: errData.message || "send_failed" }).eq("id", item.id);
      failed++;
    }
  }

  return new Response(JSON.stringify({ sent, failed, total: pending.length }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};