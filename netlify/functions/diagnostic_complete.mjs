// diagnostic_complete.mjs — MecaIA
// Envoi email récap après un diagnostic Dylan complet (phase CONCLUSION)
// POST { user_id, vehicle_id, diagnostic_id, summary, hypotheses, action_plan, dtcs }
import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';

const SUPA_URL  = process.env.SUPABASE_URL;
const SUPA_KEY  = process.env.SUPABASE_SERVICE_KEY;
const RESEND_KEY = process.env.RESEND_API_KEY;

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };

  const authHeader = event.headers?.authorization || '';
  const token = authHeader.replace('Bearer ', '').trim();
  if (!token) return { statusCode: 401, body: JSON.stringify({ error: 'Auth requise' }) };

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { body = {}; }

  const { vehicle_id, summary, hypotheses = [], action_plan = [], dtcs = [] } = body;

  const supa = createClient(SUPA_URL, SUPA_KEY, { auth: { persistSession: false } });
  const { data: _ad, error: _ae } = await supa.auth.getUser(token);
  if (_ae || !_ad?.user) return { statusCode: 401, body: JSON.stringify({ error: 'Token invalide' }) };
  const user = _ad.user;
  if (!user) return { statusCode: 401, body: JSON.stringify({ error: 'Token invalide' }) };

  // Récupérer le véhicule
  let vehicleName = 'votre véhicule';
  if (vehicle_id) {
    const { data: v } = await supa
      .from('user_vehicles').select('marque,modele,annee').eq('id', vehicle_id).single();
    if (v) vehicleName = `${v.marque} ${v.modele} ${v.annee}`;
  }

  const hypothesesHtml = hypotheses.length ? hypotheses.map(h => {
    const icon = h.statut === 'confirmee' ? '✅' : h.statut === 'eliminee' ? '❌' : '🔵';
    const style = h.statut === 'eliminee' ? 'text-decoration:line-through;opacity:.5' : '';
    return `<li style="${style};color:#b0bec5;margin-bottom:6px;font-size:13px">${icon} ${h.libelle || h}</li>`;
  }).join('') : '<li style="color:#b0bec5;font-size:13px">Analyse en cours</li>';

  const actionHtml = action_plan.length ? action_plan.map((a, i) =>
    `<li style="color:#b0bec5;margin-bottom:8px;font-size:13px"><strong style="color:#e8a000">${i+1}.</strong> ${a}</li>`
  ).join('') : '<li style="color:#b0bec5;font-size:13px">Voir la conversation Dylan</li>';

  const dtcHtml = dtcs.length ? dtcs.map(d =>
    `<span style="background:#1a0a0a;border:1px solid #e8a000;color:#e8a000;padding:3px 9px;border-radius:4px;font-size:12px;font-family:monospace;margin:2px 3px;display:inline-block">${d}</span>`
  ).join('') : '<span style="color:#4a5568;font-size:12px">Aucun code actif</span>';

  const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:'DM Sans',Arial,sans-serif;background:#060809;color:#eef4fa;margin:0;padding:0">
<div style="max-width:560px;margin:0 auto;padding:24px 16px">
  <!-- Header -->
  <div style="text-align:center;margin-bottom:28px">
    <div style="font-family:'Rajdhani',sans-serif;font-size:26px;font-weight:700;letter-spacing:3px">
      MECA<span style="color:#e8a000">IA</span>
    </div>
    <p style="font-size:12px;color:#4a5568;margin:4px 0 0">Rapport de diagnostic · ${vehicleName}</p>
  </div>

  <!-- Summary card -->
  <div style="background:#0d1f35;border-radius:12px;padding:20px;margin-bottom:16px;border:1px solid #1a2b3d">
    <p style="font-size:11px;color:#4a5568;text-transform:uppercase;letter-spacing:1.2px;margin-bottom:10px">Résumé du diagnostic</p>
    <p style="font-size:14px;color:#eef4fa;line-height:1.7">${summary || 'Diagnostic complété par Dylan.'}</p>
  </div>

  <!-- DTC codes -->
  ${dtcs.length ? `<div style="background:#0a0e12;border-radius:10px;padding:16px;margin-bottom:14px;border:1px solid #1a2430">
    <p style="font-size:11px;color:#4a5568;text-transform:uppercase;letter-spacing:1px;margin-bottom:10px">Codes défaut identifiés</p>
    ${dtcHtml}
  </div>` : ''}

  <!-- Hypothèses -->
  <div style="background:#0a0e12;border-radius:10px;padding:16px;margin-bottom:14px;border:1px solid #1a2430">
    <p style="font-size:11px;color:#4a5568;text-transform:uppercase;letter-spacing:1px;margin-bottom:10px">Hypothèses diagnostiques</p>
    <ul style="margin:0;padding-left:14px">${hypothesesHtml}</ul>
  </div>

  <!-- Plan d'action -->
  <div style="background:#0a0e12;border-radius:10px;padding:16px;margin-bottom:20px;border:1px solid #1a2430">
    <p style="font-size:11px;color:#4a5568;text-transform:uppercase;letter-spacing:1px;margin-bottom:10px">Plan d'action recommandé</p>
    <ol style="margin:0;padding-left:18px">${actionHtml}</ol>
  </div>

  <!-- CTA -->
  <div style="text-align:center;margin-bottom:24px">
    <a href="https://mecaiaauto.com" style="display:inline-block;background:#e8a000;color:#000;font-weight:700;font-size:13px;padding:12px 28px;border-radius:8px;text-decoration:none">
      Continuer avec Dylan →
    </a>
  </div>

  <p style="font-size:11px;color:#3d4f5f;text-align:center">
    MecaIA · mecaiaauto.com<br>
    Ce rapport est informatif. Consultez un mécanicien pour toute intervention.
  </p>
</div>
</body></html>`;

  const resend = new Resend(RESEND_KEY);
  try {
    await resend.emails.send({
      from: 'MecaIA Dylan <noreply@mecaiaauto.com>',
      to: [user.email],
      subject: `🔧 Diagnostic ${vehicleName} — Rapport Dylan MecaIA`,
      html,
    });
    return { statusCode: 200, body: JSON.stringify({ sent: true }) };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
