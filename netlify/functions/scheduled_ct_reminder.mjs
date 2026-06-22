// ============================================================
// SCHEDULED_CT_REMINDER.MJS — Cron Netlify
// Tourne : tous les jours à 8h UTC
// Mission : email de rappel CT 45j et 15j avant date CT
// Table   : user_vehicles.date_ct + ct_reminder_sent
// ============================================================

import { serviceClient } from "../lib/auth.mjs";

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM = "MecaIA <noreply@mecaiaauto.com>";

function htmlEmail(prenom, marque, modele, annee, immat, joursRestants, dateCtStr) {
  const urgenceColor = joursRestants <= 15 ? "#ef4444" : "#f97316";
  const urgenceLabel = joursRestants <= 15 ? "🔴 URGENT" : "🟡 Dans 45 jours";
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="margin:0;padding:0;background:#060809;font-family:Arial,sans-serif">
<div style="max-width:600px;margin:0 auto;background:#0d1520">
  <div style="background:#0d1520;border-bottom:3px solid #e8a000;padding:24px 28px">
    <h1 style="margin:0;color:#e8a000;font-size:20px;letter-spacing:2px">MecaIA</h1>
    <p style="color:#7a9ab5;font-size:12px;margin:6px 0 0">Votre assistant automobile IA</p>
  </div>
  <div style="padding:24px 28px;color:#eef4fa">
    <p style="font-size:15px">Bonjour${prenom ? ' ' + prenom : ''},</p>
    <div style="background:rgba(${joursRestants<=15?'239,68,68':'249,115,22'},0.08);border:1px solid ${urgenceColor};border-radius:10px;padding:16px 20px;margin:20px 0">
      <div style="font-weight:700;color:${urgenceColor};font-size:14px;margin-bottom:8px">${urgenceLabel} — Contrôle Technique</div>
      <div style="font-size:15px;color:#eef4fa;font-weight:600">${marque} ${modele}${annee ? ' ' + annee : ''}${immat ? ' · ' + immat : ''}</div>
      <div style="font-size:13px;color:#7a9ab5;margin-top:4px">Date CT : <strong style="color:#eef4fa">${dateCtStr}</strong> (${joursRestants} jour${joursRestants > 1 ? 's' : ''})</div>
    </div>
    <p style="font-size:13px;color:#7a9ab5;line-height:1.6">Avant votre contrôle technique, MecaIA peut <strong style="color:#eef4fa">vérifier l'état de votre véhicule</strong> et détecter les problèmes qui pourraient faire échouer le CT : codes défauts, moniteurs non prêts, batterie faible...</p>
    <div style="text-align:center;margin:28px 0">
      <a href="https://mecaiaauto.com?utm_source=ct_reminder&utm_medium=email&utm_campaign=ct_j${joursRestants}" 
         style="display:inline-block;background:#e8a000;color:#0a0a0a;text-decoration:none;padding:13px 32px;border-radius:8px;font-weight:700;font-size:14px">
        🔍 Préparer mon CT avec Dylan
      </a>
    </div>
    <p style="font-size:11px;color:#4a5a6e;text-align:center">MecaIA · mecaiaauto.com · <a href="https://mecaiaauto.com/unsubscribe?type=ct" style="color:#4a5a6e">Se désabonner</a></p>
  </div>
</div></body></html>`;
}

async function sendEmail(to, subject, html) {
  if (!RESEND_API_KEY) { console.warn("[CT] RESEND_API_KEY manquant"); return false; }
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: FROM, to: [to], subject, html }),
  });
  return r.ok;
}

export const handler = async (event) => {
  const supabase = serviceClient();
  const today = new Date();

  // Chercher les véhicules dont le CT est dans 44-46j (J-45) ou 14-16j (J-15)
  // On cherche dans une fenêtre de 2 jours pour robustesse
  const targets45 = new Date(today); targets45.setDate(today.getDate() + 45);
  const targets15 = new Date(today); targets15.setDate(today.getDate() + 15);

  const window = (d, days) => {
    const lo = new Date(d); lo.setDate(d.getDate() - 1);
    const hi = new Date(d); hi.setDate(d.getDate() + 1);
    return { lo: lo.toISOString().slice(0,10), hi: hi.toISOString().slice(0,10) };
  };

  const w45 = window(targets45);
  const w15 = window(targets15);

  // Requête : véhicules avec date_ct dans les fenêtres ET pas encore notifiés
  const { data: vehicles, error } = await supabase
    .from("user_vehicles")
    .select("id, user_id, marque, modele, annee, immatriculation, date_ct, ct_reminder_sent")
    .not("date_ct", "is", null)
    .eq("is_active", true)
    .or(`date_ct.gte.${w45.lo},date_ct.lte.${w45.hi},date_ct.gte.${w15.lo},date_ct.lte.${w15.hi}`);

  if (error) { console.error("[CT]", error.message); return { statusCode: 500, body: error.message }; }

  let sent = 0, skipped = 0;

  for (const v of vehicles || []) {
    const dateCT = new Date(v.date_ct);
    const joursRestants = Math.round((dateCT - today) / (1000 * 60 * 60 * 24));

    // Fenêtre J-45 ou J-15 ?
    const isJ45 = joursRestants >= 43 && joursRestants <= 47;
    const isJ15 = joursRestants >= 13 && joursRestants <= 17;
    if (!isJ45 && !isJ15) { skipped++; continue; }

    // Vérifier si déjà notifié pour ce cycle
    const { data: alreadySent } = await supabase
      .from("ct_reminders_log")
      .select("id")
      .eq("vehicle_id", v.id)
      .eq("jours_avant", isJ45 ? 45 : 15)
      .maybeSingle();
    if (alreadySent) { skipped++; continue; }

    // Récupérer l'email de l'utilisateur
    const { data: profile } = await supabase
      .from("user_profiles")
      .select("email, prenom")
      .eq("user_id", v.user_id)
      .maybeSingle();
    if (!profile?.email) { skipped++; continue; }

    const dateCtStr = dateCT.toLocaleDateString("fr-BE", { day: "numeric", month: "long", year: "numeric" });
    const subject = `${isJ15 ? "🔴 Urgent — " : ""}Votre CT approche (${joursRestants}j) — ${v.marque} ${v.modele}`;
    const html = htmlEmail(profile.prenom, v.marque, v.modele, v.annee, v.immatriculation, joursRestants, dateCtStr);

    const ok = await sendEmail(profile.email, subject, html);
    if (ok) {
      // Logger l'envoi
      await supabase.from("ct_reminders_log").insert({
        vehicle_id: v.id, user_id: v.user_id,
        jours_avant: isJ45 ? 45 : 15, sent_at: new Date().toISOString(),
      });
      sent++;
      console.log(`[CT] Email envoyé: ${profile.email} → ${v.marque} ${v.modele} (J-${joursRestants})`);
    }
  }

  console.log(`[CT] Fin: ${sent} envoyés · ${skipped} ignorés`);
  return { statusCode: 200, body: JSON.stringify({ sent, skipped }) };
};
