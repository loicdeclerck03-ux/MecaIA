// push_notify.mjs — MecaIA — Notifications push Expo
// Auth : JWT utilisateur (push vers soi-même) OU clé interne (fonctions scheduled)
// v2 : authentification obligatoire — audit sécurité 24/06/2026
import { getUser, serviceClient, json, preflight } from '../lib/auth.mjs';

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return preflight();
  if (event.httpMethod !== 'POST') return json(405, { error: 'POST only' });

  // Auth duale : JWT utilisateur OU clé interne pour fonctions scheduled
  const authHeader = event.headers?.authorization || '';
  const internalKey = process.env.INTERNAL_API_KEY;
  const isInternal = !!(internalKey &&
    authHeader.startsWith('Internal ') &&
    authHeader.slice(9).trim() === internalKey);

  let jwtUserId = null;
  if (!isInternal) {
    const auth = await getUser(event);
    if (!auth) return json(401, { error: 'Unauthorized — JWT ou clé interne requis' });
    jwtUserId = auth.userId;
  }

  let b;
  try { b = JSON.parse(event.body || '{}'); } catch { b = {}; }
  const { user_id, title, message, data = {}, type = 'alert' } = b;

  if (!user_id || !title || !message) {
    return json(400, { error: 'user_id, title et message requis' });
  }

  // Sécurité : un utilisateur JWT ne peut notifier que lui-même
  if (jwtUserId && jwtUserId !== user_id) {
    return json(403, { error: 'Forbidden — vous ne pouvez notifier que votre propre compte' });
  }

  const supa = serviceClient();

  let profile = null;
  try {
    const r = await supa
      .from('user_profiles')
      .select('expo_push_token, push_enabled')
      .eq('user_id', user_id)
      .single();
    profile = r.data;
  } catch {}

  if (!profile?.expo_push_token || profile.push_enabled === false) {
    return json(200, { sent: false, reason: 'no_token' });
  }

  try {
    const r = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        to: profile.expo_push_token,
        title,
        body: message,
        data: { type, ...data },
        sound: 'default',
        priority: 'high',
      }),
    });
    const res = await r.json();
    try {
      await supa.from('email_logs').insert({
        user_id, type: 'push_notification', subject: title,
        status: 'sent', sent_at: new Date().toISOString(),
      });
    } catch {}
    return json(200, { sent: true, result: res.data });
  } catch (e) {
    console.error('[PUSH_NOTIFY]', e.message);
    return json(500, { error: e.message });
  }
};
