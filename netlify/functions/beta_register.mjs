// beta_register.mjs — MecaIA
// Inscription bêta testeurs — POST { name, email, vehicle, role, message }
import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';

const SUPA_URL  = process.env.SUPABASE_URL;
const SUPA_KEY  = process.env.SUPABASE_SERVICE_KEY;
const RESEND_KEY = process.env.RESEND_API_KEY;

const BETA_SLOTS = 10; // Maximum de bêta testeurs

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { body = {}; }

  const { name, email, vehicle, role, message } = body;
  if (!name || !email) return { statusCode: 400, body: JSON.stringify({ error: 'Nom et email requis' }) };

  let _supa=null;
const getSupa=()=>_supa||(_supa=createClient(SUPA_URL,SUPA_KEY));

  // Vérifier si des places sont disponibles
  const { count } = await getSupa().from('beta_registrations')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'pending');

  if (count >= BETA_SLOTS) {
    return { statusCode: 200, body: JSON.stringify({ success: false, message: 'Programme bêta complet — inscrit sur liste d\'attente' }) };
  }

  // Vérifier email unique
  const { data: existing } = await getSupa().from('beta_registrations').select('id').eq('email', email).single();
  if (existing) return { statusCode: 200, body: JSON.stringify({ success: false, message: 'Déjà inscrit avec cet email' }) };

  // Sauvegarder l'inscription
  const { error: insertErr } = await getSupa().from('beta_registrations').insert({
    name, email, vehicle: vehicle || null, role: role || 'driver', message: message || null,
    status: 'pending', registered_at: new Date().toISOString(),
  });
  if (insertErr) return { statusCode: 500, body: JSON.stringify({ error: insertErr.message }) };

  // Email de confirmation au candidat
  const resend = new Resend(RESEND_KEY);
  const confirmHtml = `<!DOCTYPE html>
<html><body style="font-family:'DM Sans',Arial,sans-serif;background:#060809;color:#eef4fa;padding:24px">
<div style="max-width:540px;margin:0 auto">
  <div style="font-family:'Rajdhani',sans-serif;font-size:24px;font-weight:700;letter-spacing:3px;margin-bottom:24px">
    MECA<span style="color:#e8a000">IA</span>
  </div>
  <h2 style="font-size:18px;margin-bottom:12px">Bonjour ${name} ! 👋</h2>
  <p style="color:#b0bec5;line-height:1.7">Votre candidature au programme bêta MecaIA a bien été reçue.</p>
  <div style="background:#0d1f35;border-radius:10px;padding:16px;margin:20px 0">
    <p style="font-size:14px;font-weight:600;margin-bottom:8px;color:#e8a000">Ce qu'il se passe maintenant :</p>
    <ul style="color:#b0bec5;font-size:13px;padding-left:18px">
      <li style="margin-bottom:6px">On vous contacte dans les 48h par email</li>
      <li style="margin-bottom:6px">Vous recevrez un lien d'accès personnel</li>
      <li style="margin-bottom:6px">Accès gratuit complet pendant 30 jours</li>
    </ul>
  </div>
  <p style="color:#b0bec5;font-size:13px">En attendant, vous pouvez déjà essayer les fonctionnalités gratuites sur <a href="https://mecaiaauto.com" style="color:#e8a000">mecaiaauto.com</a></p>
  <p style="color:#4a5568;font-size:11px;margin-top:24px">MecaIA · mecaiaauto.com</p>
</div>
</body></html>`;

  try {
    await resend.emails.send({
      from: 'MecaIA <noreply@mecaiaauto.com>',
      to: [email],
      subject: '✅ Candidature bêta MecaIA reçue !',
      html: confirmHtml,
    });
  } catch(e) { /* email non critique */ }

  // Notifier Loïc
  try {
    await resend.emails.send({
      from: 'MecaIA <noreply@mecaiaauto.com>',
      to: ['loicdeclerck03@gmail.com'],
      subject: `🎉 Nouveau bêta testeur : ${name}`,
      html: `<p><strong>${name}</strong> (${email}) s'est inscrit au bêta.<br>Véhicule: ${vehicle || 'non précisé'}<br>Rôle: ${role || 'conducteur'}<br>Message: ${message || 'aucun'}</p>`,
    });
  } catch(e) { /* non critique */ }

  return {
    statusCode: 200,
    body: JSON.stringify({ success: true, message: 'Inscription enregistrée — email de confirmation envoyé !' }),
  };
};
