// scheduled_weekly_health.mjs — MecaIA
// Rapport hebdomadaire santé véhicule — chaque lundi 8h00
// Trigger: cron Netlify "0 8 * * 1"
import { createClient } from '@supabase/supabase-js';

const SUPA_URL   = process.env.SUPABASE_URL;
const SUPA_KEY   = process.env.SUPABASE_SERVICE_KEY;
const RESEND_KEY = process.env.RESEND_API_KEY;

async function sendHealthEmail(user, score, vehicle, alerts) {
  const alertHtml = alerts.length
    ? alerts.map(a => `<li style="color:#e74c3c;margin:4px 0">${a}</li>`).join('')
    : '<li style="color:#22c55e">Aucune alerte — tout va bien ✅</li>';

  const scoreColor = score >= 80 ? '#22c55e' : score >= 60 ? '#e8a000' : '#ef4444';
  const scoreLabel = score >= 80 ? 'Excellente condition' : score >= 60 ? 'Entretien conseillé' : 'Intervention requise';

  const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:'DM Sans',Arial,sans-serif;background:#060809;color:#eef4fa;margin:0;padding:0">
<div style="max-width:560px;margin:0 auto;padding:24px 16px">
  <div style="text-align:center;margin-bottom:24px">
    <div style="display:inline-block;background:#e8a000;border-radius:8px;width:36px;height:36px;line-height:36px;font-size:18px;font-weight:900;color:#000;margin-bottom:8px">M</div>
    <h1 style="font-size:18px;font-weight:700;letter-spacing:2px;margin:0;color:#eef4fa">MECAIA</h1>
    <p style="font-size:12px;color:#6b7a89;margin:4px 0 0">Rapport santé hebdomadaire</p>
  </div>
  
  <div style="background:#0d1f35;border-radius:12px;padding:24px;text-align:center;margin-bottom:16px">
    <p style="font-size:11px;letter-spacing:1.5px;color:rgba(255,255,255,.4);margin:0 0 8px">INDICE DE SANTÉ — ${vehicle}</p>
    <div style="font-size:64px;font-weight:700;color:${scoreColor};line-height:1;margin:8px 0">${score}</div>
    <div style="font-size:14px;color:${scoreColor};margin-top:4px">${scoreLabel}</div>
  </div>

  <div style="background:#0a1018;border:1px solid #1e2b38;border-radius:10px;padding:16px;margin-bottom:16px">
    <h3 style="font-size:12px;letter-spacing:1px;color:#6b7a89;margin:0 0 10px;text-transform:uppercase">Alertes de la semaine</h3>
    <ul style="margin:0;padding:0 0 0 16px;font-size:13px;line-height:1.6">${alertHtml}</ul>
  </div>

  <div style="text-align:center;margin-bottom:24px">
    <a href="https://mecaiaauto.com" style="display:inline-block;background:#e8a000;color:#000;font-weight:700;font-size:13px;padding:12px 28px;border-radius:8px;text-decoration:none;letter-spacing:.5px">Lancer un diagnostic complet →</a>
  </div>

  <p style="font-size:11px;color:#3d4f5f;text-align:center;margin:0">
    MecaIA · Votre expert automobile IA · mecaiaauto.com<br>
    <a href="https://mecaiaauto.com/unsubscribe?email=${user.email}" style="color:#3d4f5f">Se désabonner</a>
  </p>
</div>
</body></html>`;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: 'MecaIA <noreply@mecaiaauto.com>',
      to: [user.email],
      subject: `🚗 Santé de votre ${vehicle} — Score ${score}/100`,
      html
    })
  });
  return res.ok;
}

export const handler = async (event) => {
  if (!SUPA_URL || !SUPA_KEY || !RESEND_KEY) {
    return { statusCode: 500, body: 'Config manquante' };
  }

  const supa = createClient(SUPA_URL, SUPA_KEY);
  let sent = 0, errors = 0;

  try {
    // Récupérer tous les utilisateurs avec abonnement actif
    const { data: subs } = await supa
      .from('subscriptions')
      .select('user_id, plan')
      .eq('status', 'active');

    if (!subs?.length) return { statusCode: 200, body: 'Aucun abonné actif' };

    for (const sub of subs) {
      try {
        // Récupérer email utilisateur
        const { data: userRow } = await supa.auth.admin.getUserById(sub.user_id);
        if (!userRow?.user?.email) continue;
        const email = userRow.user.email;

        // Récupérer véhicule principal
        const { data: veh } = await supa
          .from('user_vehicles')
          .select('marque, modele, annee')
          .eq('user_id', sub.user_id)
          .eq('is_primary', true)
          .single();
        const vehName = veh ? `${veh.marque} ${veh.modele} ${veh.annee}` : 'votre véhicule';

        // Récupérer dernière session OBD pour alertes
        const { data: obd } = await supa
          .from('obd_sessions')
          .select('fuel_trim_st, fuel_trim_lt, battery_voltage, dtcs')
          .eq('user_id', sub.user_id)
          .order('created_at', { ascending: false })
          .limit(1)
          .single();

        // Calculer alertes
        const alerts = [];
        if (obd) {
          if (obd.fuel_trim_lt > 10 || obd.fuel_trim_lt < -10)
            alerts.push(`Correction carburant LT : ${obd.fuel_trim_lt > 0 ? '+' : ''}${obd.fuel_trim_lt?.toFixed(1)}% — vérifiez l'admission`);
          if (obd.battery_voltage && obd.battery_voltage < 12.2)
            alerts.push(`Batterie faible : ${obd.battery_voltage?.toFixed(1)}V — contrôle recommandé`);
          if (obd.dtcs?.length > 0)
            alerts.push(`${obd.dtcs.length} code(s) défaut actif(s) : ${obd.dtcs.slice(0,3).join(', ')}`);
        }

        // Score simple : base 70 + ajustements
        const score = Math.max(20, Math.min(100,
          70 + (obd ? (
            (Math.abs(obd.fuel_trim_lt || 0) < 5 ? 10 : Math.abs(obd.fuel_trim_lt || 0) < 10 ? 0 : -15) +
            ((obd.battery_voltage || 12.5) > 12.4 ? 5 : -10) +
            (obd.dtcs?.length > 0 ? -obd.dtcs.length * 10 : 15)
          ) : 0)
        ));

        const ok = await sendHealthEmail({ email }, score, vehName, alerts);
        if (ok) sent++; else errors++;
      } catch(e) { errors++; }
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ sent, errors, total: subs.length })
    };
  } catch(e) {
    return { statusCode: 500, body: e.message };
  }
};
